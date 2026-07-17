"""
Pure request models, Garmin payload builders and activity mappers.

No network access here — everything is unit-testable without garth.
"""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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


class StrengthExercise(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(description="Exercise name, e.g. 'Bench Press'")
    category: str | None = Field(
        default=None,
        description="Garmin exercise category hint, e.g. 'squat' or 'BENCH_PRESS'",
    )
    sets: int = Field(ge=1, description="Number of sets")
    reps: int = Field(ge=1, description="Reps per set")
    weight_kg: float | None = Field(
        default=None, alias="weightKg", description="Working weight in kilograms"
    )


class CreateStrengthWorkoutRequest(BaseModel):
    title: str = Field(description="Workout title shown in Garmin Connect")
    date: str = Field(description="ISO date string (YYYY-MM-DD) to schedule on")
    exercises: list[StrengthExercise] = Field(min_length=1)


# ── Garmin Connect payload constants ─────────────────────────────────────────

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

# Strength workout codes
_SPORT_STRENGTH = {"sportTypeId": 5, "sportTypeKey": "strength_training"}
_CONDITION_REPS = {"conditionTypeId": 10, "conditionTypeKey": "reps"}
_CONDITION_ITERATIONS = {"conditionTypeId": 7, "conditionTypeKey": "iterations"}
_STEP_REPEAT = {"stepTypeId": 6, "stepTypeKey": "repeat"}
_WEIGHT_UNIT_KG = {"unitId": 8, "unitKey": "kilogram", "factor": 1000.0}

# Garmin FIT exercise categories (subset relevant to gym strength work)
_GARMIN_CATEGORIES = {
    "BENCH_PRESS", "CALF_RAISE", "CARDIO", "CARRY", "CHOP", "CORE", "CRUNCH",
    "CURL", "DEADLIFT", "FLYE", "HIP_RAISE", "HIP_STABILITY", "HIP_SWING",
    "HYPEREXTENSION", "LATERAL_RAISE", "LEG_CURL", "LEG_RAISE", "LUNGE",
    "OLYMPIC_LIFT", "PLANK", "PLYO", "PULL_UP", "PUSH_UP", "ROW",
    "SHOULDER_PRESS", "SHOULDER_STABILITY", "SHRUG", "SIT_UP", "SQUAT",
    "TOTAL_BODY", "TRICEPS_EXTENSION", "WARM_UP",
}

# Curated name → (category, exerciseName) mapping in Garmin's taxonomy.
# Keys are normalized: lowercase, spaces only.
_EXERCISE_TAXONOMY: dict[str, tuple[str, str]] = {
    "bench press": ("BENCH_PRESS", "BARBELL_BENCH_PRESS"),
    "barbell bench press": ("BENCH_PRESS", "BARBELL_BENCH_PRESS"),
    "dumbbell bench press": ("BENCH_PRESS", "DUMBBELL_BENCH_PRESS"),
    "incline bench press": ("BENCH_PRESS", "INCLINE_BARBELL_BENCH_PRESS"),
    "squat": ("SQUAT", "BARBELL_BACK_SQUAT"),
    "back squat": ("SQUAT", "BARBELL_BACK_SQUAT"),
    "front squat": ("SQUAT", "BARBELL_FRONT_SQUAT"),
    "goblet squat": ("SQUAT", "GOBLET_SQUAT"),
    "leg press": ("SQUAT", "LEG_PRESS"),
    "bulgarian split squat": ("SQUAT", "REAR_FOOT_ELEVATED_SPLIT_SQUAT"),
    "deadlift": ("DEADLIFT", "BARBELL_DEADLIFT"),
    "romanian deadlift": ("DEADLIFT", "ROMANIAN_DEADLIFT"),
    "single leg deadlift": ("DEADLIFT", "SINGLE_LEG_ROMANIAN_DEADLIFT"),
    "overhead press": ("SHOULDER_PRESS", "OVERHEAD_BARBELL_PRESS"),
    "shoulder press": ("SHOULDER_PRESS", "OVERHEAD_DUMBBELL_PRESS"),
    "dumbbell shoulder press": ("SHOULDER_PRESS", "OVERHEAD_DUMBBELL_PRESS"),
    "lateral raise": ("LATERAL_RAISE", "DUMBBELL_LATERAL_RAISE"),
    "row": ("ROW", "DUMBBELL_ROW"),
    "dumbbell row": ("ROW", "DUMBBELL_ROW"),
    "barbell row": ("ROW", "BARBELL_ROW"),
    "bent over row": ("ROW", "BARBELL_ROW"),
    "cable row": ("ROW", "SEATED_CABLE_ROW"),
    "pull up": ("PULL_UP", "PULL_UP"),
    "chin up": ("PULL_UP", "CHIN_UP"),
    "lat pulldown": ("PULL_UP", "LAT_PULLDOWN"),
    "push up": ("PUSH_UP", "PUSH_UP"),
    "lunge": ("LUNGE", "LUNGE"),
    "walking lunge": ("LUNGE", "WALKING_LUNGE"),
    "reverse lunge": ("LUNGE", "REVERSE_LUNGE"),
    "plank": ("PLANK", "PLANK"),
    "side plank": ("PLANK", "SIDE_PLANK"),
    "bicep curl": ("CURL", "STANDING_DUMBBELL_BICEPS_CURL"),
    "biceps curl": ("CURL", "STANDING_DUMBBELL_BICEPS_CURL"),
    "curl": ("CURL", "STANDING_DUMBBELL_BICEPS_CURL"),
    "hammer curl": ("CURL", "HAMMER_CURL"),
    "hip thrust": ("HIP_RAISE", "BARBELL_HIP_THRUST"),
    "glute bridge": ("HIP_RAISE", "HIP_RAISE"),
    "calf raise": ("CALF_RAISE", "STANDING_CALF_RAISE"),
    "crunch": ("CRUNCH", "CRUNCH"),
    "sit up": ("SIT_UP", "SIT_UP"),
    "triceps extension": ("TRICEPS_EXTENSION", "LYING_TRICEPS_EXTENSION"),
    "tricep extension": ("TRICEPS_EXTENSION", "LYING_TRICEPS_EXTENSION"),
    "dip": ("TRICEPS_EXTENSION", "DIP"),
    "shrug": ("SHRUG", "BARBELL_SHRUG"),
    "leg curl": ("LEG_CURL", "LEG_CURL"),
    "leg raise": ("LEG_RAISE", "HANGING_LEG_RAISE"),
    "farmers carry": ("CARRY", "FARMERS_WALK"),
    "kettlebell swing": ("HIP_SWING", "KETTLEBELL_SWING"),
}


# ── Running/cycling payload builders ─────────────────────────────────────────


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
            "stepType": _STEP_REPEAT,
            "numberOfIterations": block.reps,
            "smartRepeat": False,
            "endCondition": _CONDITION_ITERATIONS,
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


# ── Strength payload builders ────────────────────────────────────────────────


def _normalize_exercise_key(value: str) -> str:
    return " ".join(value.strip().lower().replace("-", " ").replace("_", " ").split())


def _to_upper_snake(value: str) -> str:
    return "_".join(_normalize_exercise_key(value).split()).upper()


def _resolve_exercise(name: str, category: str | None) -> tuple[str | None, str | None]:
    """Map a free-text exercise to Garmin's (category, exerciseName) taxonomy.

    Returns (None, None) when unmappable — caller falls back to a generic
    strength step with the name in the description.
    """
    key = _normalize_exercise_key(name)
    if key in _EXERCISE_TAXONOMY:
        return _EXERCISE_TAXONOMY[key]
    if category:
        cat = _to_upper_snake(category)
        if cat in _GARMIN_CATEGORIES:
            return cat, _to_upper_snake(name)
    return None, None


def _build_strength_step(
    exercise: StrengthExercise, order: int
) -> dict[str, Any]:
    """One exercise → RepeatGroupDTO (sets iterations) wrapping a reps step."""
    category, exercise_name = _resolve_exercise(exercise.name, exercise.category)

    exec_step: dict[str, Any] = {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": order + 1,
        "childStepId": 1,
        "description": None if category else exercise.name,
        "stepType": _STEP_TYPE_MAP["work"],
        "endCondition": _CONDITION_REPS,
        "endConditionValue": str(exercise.reps),
        "endConditionCompare": None,
        "endConditionZone": None,
        "targetType": _TARGET_OPEN,
        "targetValueOne": None,
        "targetValueTwo": None,
        "zoneNumber": None,
        "secondaryTargetType": None,
        "secondaryTargetValueOne": None,
        "secondaryTargetValueTwo": None,
        "secondaryZoneNumber": None,
        "numberOfIterations": None,
        "smartRepeat": False,
        "preferredEndConditionUnit": None,
        "equipmentType": None,
        "category": category,
        "exerciseName": exercise_name,
        "workoutProvider": None,
        "providerExerciseSourceId": None,
        "strokeType": None,
        "poolLength": None,
    }
    if exercise.weight_kg is not None:
        exec_step["weightValue"] = exercise.weight_kg
        exec_step["weightUnit"] = _WEIGHT_UNIT_KG

    return {
        "type": "RepeatGroupDTO",
        "stepId": None,
        "stepOrder": order,
        "childStepId": None,
        "description": None,
        "stepType": _STEP_REPEAT,
        "numberOfIterations": exercise.sets,
        "smartRepeat": False,
        "endCondition": _CONDITION_ITERATIONS,
        "endConditionValue": str(exercise.sets),
        "workoutSteps": [exec_step],
    }


def _build_strength_workout_payload(
    req: CreateStrengthWorkoutRequest,
) -> dict[str, Any]:
    """Build the full Garmin Connect strength workout creation payload."""
    steps = []
    order = 1
    for exercise in req.exercises:
        steps.append(_build_strength_step(exercise, order))
        order += 2  # repeat group + child step

    return {
        "sportType": _SPORT_STRENGTH,
        "subSportType": None,
        "workoutName": req.title,
        "description": None,
        "estimatedDurationInSecs": None,
        "estimatedDistanceInMeters": None,
        "poolLength": None,
        "workoutSegments": [
            {
                "segmentOrder": 1,
                "sportType": _SPORT_STRENGTH,
                "workoutSteps": steps,
            }
        ],
    }


# ── Activity mapping helpers ─────────────────────────────────────────────────

_KIND_MAP = {
    "running": "run",
    "treadmill_running": "run",
    "trail_running": "run",
    "strength_training": "strength",
    "indoor_cardio": "strength",
}


def _simplify_kind(type_key: str | None) -> str:
    return _KIND_MAP.get(type_key or "", "other")


def _pace_from_speed(speed_mps: float | None) -> int | None:
    """Convert m/s average speed to sec/km pace."""
    if not speed_mps or speed_mps <= 0:
        return None
    return round(1000.0 / speed_mps)


def _parse_since(value: str) -> datetime:
    """Parse an ISO timestamp into naive UTC for comparison with Garmin GMT times."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _parse_garmin_ts(value: str | None) -> datetime | None:
    """Parse Garmin's 'YYYY-MM-DD HH:MM:SS[.f]' (or ISO-T) timestamps."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace(" ", "T"))
    except ValueError:
        return None


def _map_activity_summary(raw: dict[str, Any]) -> dict[str, Any]:
    """Map one entry from the activity search list to the Kadenz shape."""
    type_key = (raw.get("activityType") or {}).get("typeKey")
    kind = _simplify_kind(type_key)
    avg_pace = _pace_from_speed(raw.get("averageSpeed")) if kind == "run" else None
    return {
        "garminId": raw.get("activityId"),
        "name": raw.get("activityName"),
        "activityType": type_key,
        "kind": kind,
        "startTimeLocal": raw.get("startTimeLocal"),
        "startTimeGMT": raw.get("startTimeGMT"),
        "distanceMeters": raw.get("distance"),
        "durationSeconds": raw.get("duration"),
        "avgPaceSecPerKm": avg_pace,
        "avgHr": raw.get("averageHR"),
        "maxHr": raw.get("maxHR"),
        "elevationGain": raw.get("elevationGain"),
        "calories": raw.get("calories"),
    }


def _map_split(lap: dict[str, Any]) -> dict[str, Any]:
    distance = lap.get("distance")
    duration = lap.get("duration")
    pace = _pace_from_speed(lap.get("averageSpeed"))
    if pace is None and distance and duration:
        pace = round(duration / (distance / 1000.0))
    return {
        "distanceKm": round(distance / 1000.0, 3) if distance is not None else None,
        "durationSeconds": duration,
        "avgHr": lap.get("averageHR"),
        "avgPaceSecPerKm": pace,
    }
