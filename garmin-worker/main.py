"""
Kadenz Garmin Worker

Thin FastAPI service that creates/moves/deletes structured workouts on
Garmin Connect via the garth library.

Auth: Bearer token (WORKER_TOKEN env var) for inbound requests.
Garmin: garth session loaded from GARTH_HOME directory on startup; falls
back to GARMIN_EMAIL + GARMIN_PASSWORD credentials for initial login.
"""

import logging
import os
import warnings
from contextlib import asynccontextmanager
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# Suppress garth deprecation warning — we're intentionally using it
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    import garth

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_garth()
    yield


app = FastAPI(title="Kadenz Garmin Worker", lifespan=lifespan)


# ── Auth dependency ───────────────────────────────────────────────────────────


def verify_token(authorization: Annotated[str, Header()]) -> None:
    """Bearer token auth dependency."""
    if not WORKER_TOKEN:
        raise HTTPException(status_code=500, detail="WORKER_TOKEN not configured")
    expected = f"Bearer {WORKER_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


Auth = Annotated[None, Depends(verify_token)]


# ── Pydantic models ───────────────────────────────────────────────────────────


class WorkoutBlock(BaseModel):
    """A single segment within a structured workout."""

    type: str = Field(
        description="Segment type: warmup | work | recovery | cooldown"
    )
    duration_seconds: int | None = Field(
        default=None,
        description="Duration of this block in seconds (mutually exclusive with distance_meters)",
    )
    distance_meters: float | None = Field(
        default=None,
        description="Distance in metres (mutually exclusive with duration_seconds)",
    )
    target_pace_sec_km: int | None = Field(
        default=None,
        description="Target pace in seconds per km",
    )
    min_pace_sec_km: int | None = Field(
        default=None,
        description="Minimum (fastest) pace in seconds per km",
    )
    max_pace_sec_km: int | None = Field(
        default=None,
        description="Maximum (slowest) pace in seconds per km",
    )
    reps: int | None = Field(
        default=None,
        description="Number of repetitions (for interval blocks)",
    )
    rep_distance_meters: float | None = Field(
        default=None,
        description="Distance per rep in metres",
    )
    rep_rest_seconds: int | None = Field(
        default=None,
        description="Rest between reps in seconds",
    )


class CreateWorkoutRequest(BaseModel):
    title: str = Field(description="Workout title shown in Garmin Connect")
    description: str | None = Field(
        default=None, description="Optional notes"
    )
    scheduled_date: str = Field(
        description="ISO date string (YYYY-MM-DD) to schedule the workout"
    )
    sport_type: str = Field(
        default="running",
        description="Sport type: running | cycling | swimming",
    )
    blocks: list[WorkoutBlock] = Field(
        description="Ordered list of workout segments"
    )


class MoveWorkoutRequest(BaseModel):
    scheduled_date: str = Field(
        description="New ISO date string (YYYY-MM-DD) to move the workout to"
    )


# ── Garmin Connect API helpers ────────────────────────────────────────────────

# Sport type codes used by Garmin Connect
_SPORT_TYPE_MAP: dict[str, dict[str, Any]] = {
    "running": {"sportTypeId": 1, "sportTypeKey": "running"},
    "cycling": {"sportTypeId": 2, "sportTypeKey": "cycling"},
    "swimming": {"sportTypeId": 5, "sportTypeKey": "lap_swimming"},
}

# Workout step type codes
_STEP_TYPE_MAP: dict[str, dict[str, Any]] = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup"},
    "work": {"stepTypeId": 3, "stepTypeKey": "interval"},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery"},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown"},
}

# Condition type codes
_CONDITION_DISTANCE = {"conditionTypeId": 3, "conditionTypeKey": "distance"}
_CONDITION_TIME = {"conditionTypeId": 2, "conditionTypeKey": "time"}
_CONDITION_LAP_BUTTON = {
    "conditionTypeId": 1,
    "conditionTypeKey": "lap.button",
}

# Target type codes
_TARGET_PACE = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone"}
_TARGET_OPEN = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target"}


def _pace_to_speed(pace_sec_km: int) -> float:
    """Convert sec/km pace to m/s (Garmin uses m/s internally)."""
    return 1000.0 / pace_sec_km


def _build_step(block: WorkoutBlock, order: int) -> dict[str, Any]:
    """Translate a WorkoutBlock into a Garmin Connect workout step dict."""
    step_type = _STEP_TYPE_MAP.get(block.type)
    if step_type is None:
        raise ValueError(f"Unknown block type: {block.type!r}")

    # End condition
    if block.distance_meters is not None:
        end_condition = _CONDITION_DISTANCE
        end_condition_value = str(int(block.distance_meters))
    elif block.duration_seconds is not None:
        end_condition = _CONDITION_TIME
        end_condition_value = str(block.duration_seconds)
    else:
        end_condition = _CONDITION_LAP_BUTTON
        end_condition_value = None

    # Target
    if block.target_pace_sec_km and block.min_pace_sec_km and block.max_pace_sec_km:
        target = _TARGET_PACE
        # Garmin pace target uses m/s; faster (lower sec/km) = higher m/s
        target_value_one = _pace_to_speed(block.min_pace_sec_km)  # faster
        target_value_two = _pace_to_speed(block.max_pace_sec_km)  # slower
    else:
        target = _TARGET_OPEN
        target_value_one = None
        target_value_two = None

    step: dict[str, Any] = {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": order,
        "childStepId": None,
        "description": None,
        "stepType": step_type,
        "endCondition": end_condition,
        "endConditionValue": end_condition_value,
        "endConditionCompare": None,
        "endConditionZone": None,
        "targetType": target,
        "targetValueOne": target_value_one,
        "targetValueTwo": target_value_two,
        "zoneNumber": None,
        "secondaryTargetType": None,
        "secondaryTargetValueOne": None,
        "secondaryTargetValueTwo": None,
        "secondaryZoneNumber": None,
        "numberOfIterations": None,
        "smartRepeat": False,
        "preferredEndConditionUnit": None,
        "equipmentType": None,
        "category": None,
        "exerciseName": None,
        "workoutProvider": None,
        "providerExerciseSourceId": None,
        "strokeType": None,
        "poolLength": None,
    }

    # Wrap in a repeat step if reps are specified
    if block.reps and block.reps > 1:
        rest_step = None
        if block.rep_rest_seconds:
            rest_step = {
                "type": "ExecutableStepDTO",
                "stepId": None,
                "stepOrder": order + 1,
                "childStepId": 1,
                "description": None,
                "stepType": _STEP_TYPE_MAP["recovery"],
                "endCondition": _CONDITION_TIME,
                "endConditionValue": str(block.rep_rest_seconds),
                "targetType": _TARGET_OPEN,
                "targetValueOne": None,
                "targetValueTwo": None,
            }

        step["childStepId"] = 1
        child_steps = [step]
        if rest_step:
            child_steps.append(rest_step)

        return {
            "type": "RepeatGroupDTO",
            "stepId": None,
            "stepOrder": order,
            "childStepId": None,
            "description": None,
            "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat"},
            "numberOfIterations": block.reps,
            "smartRepeat": False,
            "endCondition": {"conditionTypeKey": "iterations", "conditionTypeId": 7},
            "endConditionValue": str(block.reps),
            "workoutSteps": child_steps,
        }

    return step


def _build_workout_payload(
    req: CreateWorkoutRequest,
) -> dict[str, Any]:
    """Build the full Garmin Connect workout creation payload."""
    sport = _SPORT_TYPE_MAP.get(req.sport_type, _SPORT_TYPE_MAP["running"])
    steps = []
    for i, block in enumerate(req.blocks, start=1):
        steps.append(_build_step(block, i))

    return {
        "sportType": sport,
        "subSportType": None,
        "workoutName": req.title,
        "description": req.description,
        "estimatedDurationInSecs": None,
        "estimatedDistanceInMeters": None,
        "poolLength": None,
        "workoutSegments": [
            {
                "segmentOrder": 1,
                "sportType": sport,
                "workoutSteps": steps,
            }
        ],
    }


def _schedule_workout(garmin_workout_id: int, date: str) -> dict[str, Any]:
    """Schedule a workout to a specific date on Garmin Connect."""
    result = garth.connectapi(
        f"/workout-service/schedule/{garmin_workout_id}",
        method="POST",
        json={"date": date},
    )
    return result or {}


def _get_scheduled_workout_id(garmin_workout_id: int, date: str) -> int | None:
    """Find the schedule ID for a workout on a given date."""
    result = garth.connectapi(
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
        created = garth.connectapi(
            "/workout-service/workout",
            method="POST",
            json=payload,
        )
    except Exception as exc:
        logger.error("Failed to create workout: %s", exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")

    if not created or not isinstance(created, dict):
        raise HTTPException(status_code=502, detail="Unexpected response from Garmin")

    workout_id: int = created["workoutId"]

    try:
        schedule_result = _schedule_workout(workout_id, body.scheduled_date)
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
    """Remove a workout from Garmin Connect."""
    try:
        garth.connectapi(
            f"/workout-service/workout/{workout_id}",
            method="DELETE",
        )
    except Exception as exc:
        logger.error("Failed to delete workout %s: %s", workout_id, exc)
        raise HTTPException(status_code=502, detail=f"Garmin API error: {exc}")
