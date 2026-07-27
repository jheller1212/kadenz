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
from datetime import datetime, date as date_cls
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

# Suppress garth deprecation warning — we're intentionally using it
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    import garth

from workouts import (  # noqa: F401 — re-exported for tests/consumers
    KADENZ_TAG,
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


# Fresh-login attempts are spaced out: Garmin's SSO rate-limits aggressively
# (429) and every crash-looped retry makes it worse. One attempt per window.
LOGIN_COOLDOWN_SECONDS = 15 * 60
_last_login_attempt: float = 0.0


def _try_fresh_login() -> bool:
    """Attempt a credential login, at most once per cooldown window."""
    global _last_login_attempt
    import time as _time

    if not (GARMIN_EMAIL and GARMIN_PASSWORD):
        return False
    now = _time.monotonic()
    if _last_login_attempt and now - _last_login_attempt < LOGIN_COOLDOWN_SECONDS:
        logger.warning("Skipping Garmin login — inside cooldown window after a recent attempt")
        return False
    _last_login_attempt = now
    logger.info("Logging in to Garmin Connect as %s", GARMIN_EMAIL)
    garth.login(GARMIN_EMAIL, GARMIN_PASSWORD)
    garth.save(GARTH_HOME)
    logger.info("Tokens saved to %s", GARTH_HOME)
    return True


def _init_garth() -> None:
    """Load persisted tokens or perform fresh login on startup.

    MUST NOT raise: a failed login (rate-limit, wrong password, Garmin down)
    leaves the app serving 503s on Garmin routes instead of crash-looping —
    a crash loop re-attempts login on every boot and feeds the rate limit.
    """
    try:
        oauth1_path = os.path.join(GARTH_HOME, "oauth1_token.json")
        if os.path.exists(oauth1_path):
            logger.info("Resuming garth session from %s", GARTH_HOME)
            garth.resume(GARTH_HOME)
        elif GARMIN_EMAIL and GARMIN_PASSWORD:
            _try_fresh_login()
        else:
            logger.warning(
                "No garth tokens found and no GARMIN_EMAIL/PASSWORD set. "
                "Garmin calls will fail until credentials are configured."
            )
    except Exception as exc:
        logger.error("Garmin startup auth failed (continuing without session): %s", exc)


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
        if not _try_fresh_login():
            raise GarminAuthError("Login attempt suppressed by cooldown")
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


def _garmin_call_fn(fn, *args: Any, **kwargs: Any) -> Any:
    """Same retry-then-503 semantics as _garmin_call, for garth's typed Data
    helpers (DailySleepData.get, HRVData.get). Those call the module's default
    http client directly and bypass _garmin_call, so without this an expired
    session would raise a raw exception instead of the GarminAuthError the
    web side knows how to turn into "reconnect Garmin"."""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:
        if not _is_auth_error(exc):
            raise
        logger.warning("Garmin auth error on %s, refreshing session", getattr(fn, "__qualname__", fn))
        try:
            _refresh_garth_session()
            return fn(*args, **kwargs)
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
    for entry in _list_schedules(garmin_workout_id, date):
        if entry.get("date") == date:
            return entry.get("scheduleId")
    return None


def _months_to_scan(*hint_dates: str | None) -> list[tuple[int, int]]:
    """(year, month0) pairs to scan: a window around today plus around each
    hint date's month, so a workout scheduled far from today is still found.
    Months are 0-indexed, matching the calendar-service API."""
    months: set[tuple[int, int]] = set()

    def add_around(year: int, month1: int) -> None:  # month1 = 1-indexed
        base = year * 12 + (month1 - 1)
        for delta in (-1, 0, 1, 2):
            months.add(divmod(base + delta, 12))

    today = date_cls.today()
    add_around(today.year, today.month)
    for hint in hint_dates:
        if not hint:
            continue
        try:
            dt = date_cls.fromisoformat(hint[:10])
        except (ValueError, TypeError):
            continue
        add_around(dt.year, dt.month)
    return sorted(months)


def _list_schedules(
    garmin_workout_id: int, *hint_dates: str | None
) -> list[dict[str, Any]]:
    """Every calendar entry Garmin holds for this workout, as {scheduleId, date}.

    Garmin has NO GET on /workout-service/schedule/{workoutId} — it 403s (that
    path is POST-only for scheduling). A workout's scheduled dates live in the
    calendar service instead, where each scheduled-workout item carries its
    schedule id (the `id` field) and date. Scan a window around today AND around
    each hint date (the reschedule target) so a workout scheduled far ahead is
    still found. Without this, scheduling lookups always failed, so updates
    couldn't detect/prune stale dates and a workout could sit on the wrong day.
    """
    entries: list[dict[str, Any]] = []
    for year, month0 in _months_to_scan(*hint_dates):
        try:
            cal = _garmin_call(
                f"/calendar-service/year/{year}/month/{month0}", method="GET"
            )
        except Exception as exc:
            logger.warning(
                "Calendar scan %s-%02d failed for workout %s: %s",
                year, month0, garmin_workout_id, exc,
            )
            continue
        items = cal.get("calendarItems") if isinstance(cal, dict) else None
        for it in items or []:
            if not isinstance(it, dict):
                continue
            if it.get("workoutId") == garmin_workout_id and it.get("date") and it.get("id"):
                entries.append({"scheduleId": it["id"], "date": it["date"]})
    return entries


def _scheduled_dates_by_workout() -> dict[int, list[str]]:
    """workoutId -> its scheduled dates, from ONE calendar-window scan.

    Reconcile (list_workouts with_schedules) needs every workout's dates; doing
    a per-workout lookup was an N-call fan-out. Scanning the window once and
    bucketing by workoutId is O(months), not O(workouts x months).
    """
    by_id: dict[int, list[str]] = {}
    for year, month0 in _months_to_scan():
        try:
            cal = _garmin_call(
                f"/calendar-service/year/{year}/month/{month0}", method="GET"
            )
        except Exception as exc:
            logger.warning("Calendar scan %s-%02d failed: %s", year, month0, exc)
            continue
        items = cal.get("calendarItems") if isinstance(cal, dict) else None
        for it in items or []:
            if not isinstance(it, dict):
                continue
            wid, dt = it.get("workoutId"), it.get("date")
            if wid is not None and dt:
                dates = by_id.setdefault(int(wid), [])
                if dt not in dates:
                    dates.append(dt)
    return by_id


def _prune_schedules(
    garmin_workout_id: int, keep_schedule_id: int | None, keep_date: str
) -> int:
    """Drop every calendar entry for this workout except the one just created.

    Garmin has no move API and scheduling ADDS an entry, so without this a
    rescheduled run shows up on both the old and the new day. Runs AFTER the
    new entry exists and never raises: the worst outcome is a leftover
    duplicate, never a workout missing from the calendar.

    Falls back to keeping entries on `keep_date` when Garmin's response didn't
    include the new schedule id.
    """
    removed = 0
    try:
        entries = _list_schedules(garmin_workout_id, keep_date)
    except Exception as exc:
        logger.warning("Could not list schedules for workout %s: %s", garmin_workout_id, exc)
        return 0
    for entry in entries:
        schedule_id = entry.get("scheduleId")
        if not schedule_id:
            continue
        keep = (
            schedule_id == keep_schedule_id
            if keep_schedule_id is not None
            else entry.get("date") == keep_date
        )
        if keep:
            continue
        try:
            _garmin_call(f"/workout-service/schedule/{schedule_id}", method="DELETE")
            removed += 1
        except Exception as exc:
            logger.warning("Could not remove stale schedule %s: %s", schedule_id, exc)
    return removed


# ── Routes ────────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    """Liveness only — does not touch Garmin (kept cheap for the platform)."""
    return {"ok": True}


@app.get("/auth-status")
def auth_status():
    """Whether the Garmin session is actually usable, not just whether the
    worker is up. Cheap authenticated call; reports garmin_auth on failure so
    the app can say "reconnect" instead of a false "Connected"."""
    try:
        _garmin_call("/userprofile-service/socialProfile", method="GET")
        return {"authenticated": True}
    except GarminAuthError:
        return {"authenticated": False, "reason": "garmin_auth"}
    except Exception as exc:
        logger.warning("auth-status check failed: %s", exc)
        return {"authenticated": False, "reason": "error"}


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
        # Creation succeeded but scheduling didn't — from the caller's side
        # this whole operation must look atomic, otherwise every outbox retry
        # (MAX_ATTEMPTS = 3) creates yet another orphaned workout on Garmin
        # since the web side never learns garmin_workout_id until this call
        # resolves. Delete what we just created before surfacing the error.
        try:
            _garmin_call(
                f"/workout-service/workout/{workout_id}",
                method="DELETE",
            )
        except Exception as cleanup_exc:
            logger.error(
                "Workout %s created but scheduling failed (%s); cleanup delete ALSO "
                "failed (%s) — workout is orphaned on Garmin and needs manual/reconcile "
                "cleanup.",
                workout_id, exc, cleanup_exc,
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Workout created (id={workout_id}) but scheduling failed: {exc}. "
                    f"Cleanup delete also failed: {cleanup_exc}"
                ),
            )
        raise HTTPException(
            status_code=502,
            detail=f"Scheduling failed and the created workout was rolled back: {exc}",
        )

    return {
        "garmin_workout_id": str(workout_id),
        "scheduled_date": body.scheduled_date,
        "schedule_result": schedule_result,
    }


@app.put("/workouts/{workout_id}")
def update_workout(workout_id: str, body: CreateWorkoutRequest, _auth: Auth):
    """Replace an existing workout's contents, keeping its id and schedule.

    Editing in place is what the athlete expects when a plan changes: the same
    entry on the watch simply says 12 km instead of 10 km. Deleting and
    re-creating would churn the calendar and risks leaving duplicates behind.
    """
    payload = _build_workout_payload(body)
    payload["workoutId"] = int(workout_id)

    try:
        _garmin_call(
            f"/workout-service/workout/{workout_id}",
            method="PUT",
            json=payload,
        )
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to update workout %s: %s", workout_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    # Keep the calendar honest too — the date may have moved with the edit.
    removed = 0
    scheduled = None
    try:
        existing = _get_scheduled_workout_id(int(workout_id), body.scheduled_date)
        if existing is None:
            scheduled = _schedule_workout(int(workout_id), body.scheduled_date)
        removed = _prune_schedules(int(workout_id), existing, body.scheduled_date)
    except Exception as exc:
        # Best-effort: the content PUT already succeeded (a genuine auth failure
        # would have 503'd there). Garmin's GET /workout-service/schedule/{id}
        # returns 403 (POST-only) which _is_auth_error misreads as auth — that
        # must not 503 a successful update, and skipping leaves no duplicate.
        logger.warning("Updated workout %s but rescheduling failed: %s", workout_id, exc)

    return {
        "garmin_workout_id": workout_id,
        "scheduled_date": body.scheduled_date,
        "removed_stale_schedules": removed,
        "schedule_result": scheduled,
    }


@app.put("/strength-workouts/{workout_id}")
def update_strength_workout(
    workout_id: str, body: CreateStrengthWorkoutRequest, _auth: Auth
):
    """Replace a strength workout's exercises in place (see update_workout)."""
    payload = _build_strength_workout_payload(body)
    payload["workoutId"] = int(workout_id)

    try:
        _garmin_call(
            f"/workout-service/workout/{workout_id}",
            method="PUT",
            json=payload,
        )
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to update strength workout %s: %s", workout_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    removed = 0
    scheduled = None
    try:
        existing = _get_scheduled_workout_id(int(workout_id), body.date)
        if existing is None:
            scheduled = _schedule_workout(int(workout_id), body.date)
        removed = _prune_schedules(int(workout_id), existing, body.date)
    except Exception as exc:
        # The content PUT above already succeeded (a genuine auth failure would
        # have 503'd there), so scheduling is best-effort. Garmin returns 403 on
        # GET /workout-service/schedule/{id} — it's POST-only — which
        # _is_auth_error misreads as an auth error; that must NOT 503 an
        # otherwise-successful update. Skipping the reschedule leaves the
        # existing calendar entry intact, so no duplicate appears either.
        logger.warning("Updated strength workout %s but rescheduling failed: %s", workout_id, exc)

    return {
        "garmin_workout_id": workout_id,
        "scheduled_date": body.date,
        "removed_stale_schedules": removed,
        "schedule_result": scheduled,
    }


@app.patch("/workouts/{workout_id}")
def move_workout(workout_id: str, body: MoveWorkoutRequest, _auth: Auth):
    """Reschedule a workout to a new date on Garmin Connect."""
    try:
        # Schedule FIRST, prune second. Deleting first would blank the
        # workout off the calendar entirely if the new schedule then failed.
        result = _schedule_workout(int(workout_id), body.scheduled_date)
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to reschedule workout %s: %s", workout_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    # Pruning is deliberately outside the try: a failure here leaves a
    # duplicate, which must not turn a successful move into a 502.
    new_schedule_id = None
    if isinstance(result, dict):
        raw_id = result.get("workoutScheduleId") or result.get("scheduleId")
        new_schedule_id = int(raw_id) if isinstance(raw_id, (int, str)) and str(raw_id).isdigit() else None
    removed = _prune_schedules(int(workout_id), new_schedule_id, body.scheduled_date)

    return {
        "garmin_workout_id": workout_id,
        "scheduled_date": body.scheduled_date,
        "removed_stale_schedules": removed,
        "result": result,
    }


@app.get("/workouts")
def list_workouts(_auth: Auth, limit: int = 100, with_schedules: bool = False):
    """Workouts this account holds, newest first, with their calendar dates.

    Lets Kadenz reconcile: anything on Garmin that Kadenz no longer tracks is
    a leftover from a deleted or regenerated plan and can be cleaned up.
    """
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be 1-500")
    try:
        result = _garmin_call(
            f"/workout-service/workouts?start=1&limit={limit}&myWorkoutsOnly=true",
            method="GET",
        )
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.error("Failed to list workouts: %s", exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    items = result if isinstance(result, list) else []
    # One calendar-window scan for ALL workouts when dates are needed — reconcile
    # matches ids only and skips this entirely (with_schedules=False).
    schedule_map = _scheduled_dates_by_workout() if with_schedules else {}
    out = []
    for w in items:
        if not isinstance(w, dict):
            continue
        workout_id = w.get("workoutId")
        if workout_id is None:
            continue
        scheduled = schedule_map.get(int(workout_id), []) if with_schedules else []
        out.append(
            {
                "garminWorkoutId": str(workout_id),
                "name": w.get("workoutName"),
                "description": w.get("description"),
                "createdByKadenz": KADENZ_TAG in (w.get("description") or ""),
                "sportType": (w.get("sportType") or {}).get("sportTypeKey"),
                "scheduledDates": scheduled,
            }
        )
    return {"workouts": out}


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


@app.get("/activities/{garmin_id}/exercise-sets")
def get_exercise_sets(garmin_id: int, _auth: Auth):
    """Ordered exercises the athlete actually performed, from Garmin's on-watch
    rep tracking — so the app can show a strength session in the order it was
    done rather than the plan order. Returns [] if the watch recorded no
    per-exercise data (many strength activities are logged generically)."""
    try:
        data = _garmin_call(f"/activity-service/activity/{garmin_id}/exerciseSets")
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.warning("Exercise sets unavailable for %s: %s", garmin_id, exc)
        return {"exercises": []}

    raw = (data or {}).get("exerciseSets") if isinstance(data, dict) else None
    out: list[dict[str, Any]] = []
    for s in raw or []:
        if not isinstance(s, dict) or s.get("setType") != "ACTIVE":
            continue
        exs = s.get("exercises") or []
        first = exs[0] if exs and isinstance(exs[0], dict) else {}
        category = first.get("category")
        name = first.get("name")
        if not category and not name:
            continue
        reps = s.get("repetitionCount")
        # Collapse consecutive sets of the same exercise into one entry.
        if out and out[-1]["category"] == category and out[-1]["name"] == name:
            out[-1]["sets"] += 1
            if reps:
                out[-1]["reps"].append(reps)
        else:
            out.append({
                "category": category,
                "name": name,
                "sets": 1,
                "reps": [reps] if reps else [],
            })
    return {"exercises": out}


# ── Wellness route ───────────────────────────────────────────────────────────


@app.get("/wellness")
def get_wellness(_auth: Auth, date: str):
    """Overnight physiological wellness for one calendar day: sleep duration
    and resting HR (sleep service) plus HRV (hrv service). Feeds readiness —
    Kadenz computes its own rolling baseline from a history of these rows
    rather than trusting Garmin's on-device status, so this returns the raw
    per-night numbers, not a verdict.

    Either service can have no data for a given day (watch not worn overnight,
    a gap in syncing) — that must return nulls for those fields, not a 404,
    since the readiness caller queries a whole date range and one thin night
    shouldn't break the rest of the pull.
    """
    try:
        target = date_cls.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")

    sleep_seconds: int | None = None
    resting_hr: int | None = None
    try:
        sleep = _garmin_call_fn(garth.DailySleepData.get, target)
        if sleep is not None:
            sleep_seconds = sleep.daily_sleep_dto.sleep_time_seconds
            resting_hr = sleep.resting_heart_rate
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.warning("Sleep data unavailable for %s: %s", date, exc)

    hrv_last_night_avg: int | None = None
    hrv_weekly_avg: int | None = None
    hrv_status: str | None = None
    try:
        hrv = _garmin_call_fn(garth.HRVData.get, target)
        if hrv is not None:
            hrv_last_night_avg = hrv.hrv_summary.last_night_avg
            hrv_weekly_avg = hrv.hrv_summary.weekly_avg
            hrv_status = hrv.hrv_summary.status
    except GarminAuthError:
        raise
    except Exception as exc:
        logger.warning("HRV data unavailable for %s: %s", date, exc)

    return {
        "date": date,
        "sleepSeconds": sleep_seconds,
        "restingHr": resting_hr,
        "hrvLastNightAvg": hrv_last_night_avg,
        "hrvWeeklyAvg": hrv_weekly_avg,
        "hrvStatus": hrv_status,
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
