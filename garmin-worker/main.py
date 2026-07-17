"""
Kadenz Garmin Worker

Thin FastAPI service that syncs with Garmin Connect via the garth library:
- creates/moves/deletes structured running workouts
- creates scheduled strength workouts
- pulls activities (list + detail with km splits)

Auth: Bearer token (WORKER_TOKEN env var) for inbound requests.
Garmin: garth session loaded from GARTH_HOME directory on startup; falls
back to GARMIN_EMAIL + GARMIN_PASSWORD credentials for initial login.
Payload builders and mappers live in workouts.py.
"""

import logging
import os
import warnings
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

# Suppress garth deprecation warning — we're intentionally using it
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    import garth

from workouts import (  # noqa: F401 — re-exported for tests/consumers
    CreateStrengthWorkoutRequest,
    CreateWorkoutRequest,
    MoveWorkoutRequest,
    StrengthExercise,
    WorkoutBlock,
    _build_step,
    _build_strength_step,
    _build_strength_workout_payload,
    _build_workout_payload,
    _map_activity_summary,
    _map_split,
    _pace_from_speed,
    _parse_garmin_ts,
    _parse_since,
    _resolve_exercise,
    _simplify_kind,
)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger("kadenz.garmin-worker")
logging.basicConfig(level=logging.INFO)

WORKER_TOKEN = os.getenv("WORKER_TOKEN", "")
GARTH_HOME = os.getenv("GARTH_HOME", os.path.expanduser("~/.garth"))
GARMIN_EMAIL = os.getenv("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD", "")


# ── Garth session management ─────────────────────────────────────────────────


def _init_garth() -> None:
    """Load persisted tokens or perform fresh login on startup."""
    oauth1_path = os.path.join(GARTH_HOME, "oauth1_token.json")
    if os.path.exists(oauth1_path):
        logger.info("Resuming garth session from %s", GARTH_HOME)
        garth.resume(GARTH_HOME)
    elif GARMIN_EMAIL and GARMIN_PASSWORD:
        logger.info("Logging in to Garmin Connect as %s", GARMIN_EMAIL)
        garth.login(GARMIN_EMAIL, GARMIN_PASSWORD)
        garth.save(GARTH_HOME)
        logger.info("Tokens saved to %s", GARTH_HOME)
    else:
        logger.warning(
            "No garth tokens found and no GARMIN_EMAIL/PASSWORD set. "
            "Garmin calls will fail until credentials are configured."
        )


class GarminAuthError(Exception):
    """Raised when Garmin authentication failed even after a session refresh."""


def _is_auth_error(exc: Exception) -> bool:
    """Heuristically detect an authentication/authorization failure from garth."""
    for candidate in (exc, getattr(exc, "error", None)):
        response = getattr(candidate, "response", None)
        status = getattr(response, "status_code", None)
        if status in (401, 403):
            return True
    msg = str(exc).lower()
    return "401" in msg or "403" in msg or "unauthorized" in msg or "forbidden" in msg


def _refresh_garth_session() -> None:
    """Re-resume tokens from disk, falling back to a fresh credential login."""
    try:
        garth.resume(GARTH_HOME)
        return
    except Exception as exc:
        logger.warning("garth.resume failed during refresh: %s", exc)
    if GARMIN_EMAIL and GARMIN_PASSWORD:
        garth.login(GARMIN_EMAIL, GARMIN_PASSWORD)
        garth.save(GARTH_HOME)
    else:
        raise GarminAuthError("No tokens and no credentials available")


def _garmin_call(path: str, **kwargs: Any) -> Any:
    """Call the Garmin Connect API with one retry after re-auth.

    Non-auth errors propagate unchanged. A persistent auth failure raises
    GarminAuthError, which the exception handler turns into a 503 so the
    web side can surface "reconnect Garmin".
    """
    try:
        return garth.connectapi(path, **kwargs)
    except Exception as exc:
        if not _is_auth_error(exc):
            raise
        logger.warning("Garmin auth error on %s, refreshing session", path)
        try:
            _refresh_garth_session()
            return garth.connectapi(path, **kwargs)
        except GarminAuthError:
            raise
        except Exception as exc2:
            if _is_auth_error(exc2):
                raise GarminAuthError(str(exc2)) from exc2
            raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_garth()
    yield


app = FastAPI(title="Kadenz Garmin Worker", lifespan=lifespan)


@app.exception_handler(GarminAuthError)
async def garmin_auth_error_handler(request, exc: GarminAuthError):
    return JSONResponse(status_code=503, content={"error": "garmin_auth"})


# ── Auth dependency ───────────────────────────────────────────────────────────


def verify_token(authorization: Annotated[str, Header()]) -> None:
    """Bearer token auth dependency."""
    if not WORKER_TOKEN:
        raise HTTPException(status_code=500, detail="WORKER_TOKEN not configured")
    expected = f"Bearer {WORKER_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


Auth = Annotated[None, Depends(verify_token)]


# ── Garmin Connect API helpers ────────────────────────────────────────────────


def _schedule_workout(garmin_workout_id: int, date: str) -> dict[str, Any]:
    """Schedule a workout to a specific date on Garmin Connect."""
    result = _garmin_call(
        f"/workout-service/schedule/{garmin_workout_id}",
        method="POST",
        json={"date": date},
    )
    return result or {}


def _get_scheduled_workout_id(garmin_workout_id: int, date: str) -> int | None:
    """Find the schedule ID for a workout on a given date."""
    result = _garmin_call(
        f"/workout-service/schedule/{garmin_workout_id}",
        method="GET",
    )
    if not result or not isinstance(result, list):
        return None
    for entry in result:
        if entry.get("date") == date:
            return entry.get("scheduleId")
    return None


# ── Routes ────────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/workouts", status_code=201)
def create_workout(body: CreateWorkoutRequest, _auth: Auth):
    """Create a structured workout on Garmin Connect and schedule it to a date."""
    payload = _build_workout_payload(body)

    try:
        created = _garmin_call(
            "/workout-service/workout",
            method="POST",
            json=payload,
        )
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to create workout: %s", exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    if not created or not isinstance(created, dict):
        raise HTTPException(status_code=502, detail="Unexpected response from Garmin")

    workout_id: int = created["workoutId"]

    try:
        schedule_result = _schedule_workout(workout_id, body.scheduled_date)
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Workout created (%s) but scheduling failed: %s", workout_id, exc)
        raise HTTPException(
            status_code=502,
            detail=f"Workout created (id={workout_id}) but scheduling failed: {exc}",
        )

    return {
        "garmin_workout_id": str(workout_id),
        "scheduled_date": body.scheduled_date,
        "schedule_result": schedule_result,
    }


@app.patch("/workouts/{workout_id}")
def move_workout(workout_id: str, body: MoveWorkoutRequest, _auth: Auth):
    """Reschedule a workout to a new date on Garmin Connect."""
    try:
        # Garmin's workout-service doesn't provide a direct "move" API.
        # We re-schedule by posting a new schedule entry; the old one is
        # overwritten if the workout was previously scheduled.
        result = _schedule_workout(int(workout_id), body.scheduled_date)
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to reschedule workout %s: %s", workout_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    return {
        "garmin_workout_id": workout_id,
        "scheduled_date": body.scheduled_date,
        "result": result,
    }


@app.delete("/workouts/{workout_id}", status_code=204)
def delete_workout(workout_id: str, _auth: Auth):
    """Remove a workout from Garmin Connect.

    Works for any sport type (running and strength alike) — the
    workout-service delete endpoint is sport-agnostic.
    """
    try:
        _garmin_call(
            f"/workout-service/workout/{workout_id}",
            method="DELETE",
        )
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to delete workout %s: %s", workout_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")


# ── Activity routes ──────────────────────────────────────────────────────────

_ACTIVITY_PAGE_SIZE = 50


@app.get("/activities")
def list_activities(
    _auth: Auth,
    since: str | None = None,
    limit: int = 20,
):
    """List recent activities from Garmin Connect, newest first.

    `since` is an ISO timestamp (UTC assumed if no offset); only activities
    with startTimeGMT >= since are returned. `limit` caps the result count.
    """
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be 1-200")
    since_dt: datetime | None = None
    if since:
        try:
            since_dt = _parse_since(since)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'since' timestamp")

    activities: list[dict[str, Any]] = []
    start = 0
    while len(activities) < limit:
        try:
            page = _garmin_call(
                "/activitylist-service/activities/search/activities",
                params={"start": start, "limit": _ACTIVITY_PAGE_SIZE},
            )
        except GarminAuthError:
            raise
        except Exception as exc:
            logger.error("Failed to list activities: %s", exc)
            raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

        if not page:
            break
        reached_since = False
        for raw in page:
            ts = _parse_garmin_ts(raw.get("startTimeGMT"))
            if since_dt is not None and ts is not None and ts < since_dt:
                # List is newest-first; everything after this is older.
                reached_since = True
                break
            activities.append(_map_activity_summary(raw))
            if len(activities) >= limit:
                break
        if reached_since or len(page) < _ACTIVITY_PAGE_SIZE:
            break
        start += _ACTIVITY_PAGE_SIZE

    return {"activities": activities}


@app.get("/activities/{garmin_id}")
def get_activity(garmin_id: int, _auth: Auth):
    """Activity detail incl. normalized km splits and lap count."""
    try:
        detail = _garmin_call(f"/activity-service/activity/{garmin_id}")
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to fetch activity %s: %s", garmin_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    if not detail or not isinstance(detail, dict):
        raise HTTPException(status_code=404, detail="Activity not found")

    summary = detail.get("summaryDTO") or {}
    type_key = (detail.get("activityTypeDTO") or {}).get("typeKey")
    kind = _simplify_kind(type_key)
    avg_pace = _pace_from_speed(summary.get("averageSpeed")) if kind == "run" else None

    splits: list[dict[str, Any]] = []
    try:
        splits_raw = _garmin_call(f"/activity-service/activity/{garmin_id}/splits")
        laps = (splits_raw or {}).get("lapDTOs") or []
        splits = [_map_split(lap) for lap in laps]
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.warning("Splits unavailable for activity %s: %s", garmin_id, exc)

    return {
        "garminId": detail.get("activityId", garmin_id),
        "name": detail.get("activityName"),
        "activityType": type_key,
        "kind": kind,
        "startTimeLocal": summary.get("startTimeLocal"),
        "startTimeGMT": summary.get("startTimeGMT"),
        "distanceMeters": summary.get("distance"),
        "durationSeconds": summary.get("duration"),
        "avgPaceSecPerKm": avg_pace,
        "avgHr": summary.get("averageHR"),
        "maxHr": summary.get("maxHR"),
        "elevationGain": summary.get("elevationGain"),
        "calories": summary.get("calories"),
        "splits": splits,
        "lapCount": len(splits),
    }


# ── Strength workout route ───────────────────────────────────────────────────


@app.post("/strength-workouts", status_code=201)
def create_strength_workout(body: CreateStrengthWorkoutRequest, _auth: Auth):
    """Create a Garmin strength workout and schedule it on a date.

    Delete via the existing DELETE /workouts/{id} (sport-agnostic).
    """
    payload = _build_strength_workout_payload(body)

    try:
        created = _garmin_call(
            "/workout-service/workout",
            method="POST",
            json=payload,
        )
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to create strength workout: %s", exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    if not created or not isinstance(created, dict):
        raise HTTPException(status_code=502, detail="Unexpected response from Garmin")

    workout_id: int = created["workoutId"]

    try:
        schedule_result = _schedule_workout(workout_id, body.date)
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error(
            "Strength workout created (%s) but scheduling failed: %s", workout_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail=f"Workout created (id={workout_id}) but scheduling failed: {exc}",
        )

    schedule_id = (
        schedule_result.get("workoutScheduleId")
        or schedule_result.get("scheduleId")
        or schedule_result.get("id")
    )
    return {
        "garminWorkoutId": str(workout_id),
        "scheduleId": str(schedule_id) if schedule_id is not None else None,
    }
