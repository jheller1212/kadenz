"""
Pure request models, Garmin payload builders and activity mappers.

No garth/network access here — everything is unit-testable without garth.
(Exercise resolution may consult taxonomy.py, which lazily fetches Garmin's
public exercise list but always falls back to a bundled snapshot.)
"""

import logging
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

import taxonomy

logger = logging.getLogger(__name__)


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
    # Kadenz program exercises with no exact-token taxonomy match (verified
    # against data/garmin_exercises_snapshot.json) — dumbbell variants chosen.
    "standing overhead press": ("SHOULDER_PRESS", "OVERHEAD_DUMBBELL_PRESS"),
    "floor press": ("BENCH_PRESS", "DUMBBELL_FLOOR_PRESS"),
    "curl to press": ("CURL", "HAMMER_CURL_TO_PRESS"),
    "bulgarian split squat (chair)": ("LUNGE", "DUMBBELL_BULGARIAN_SPLIT_SQUAT"),
    "single leg romanian deadlift": ("DEADLIFT", "SINGLE_LEG_ROMANIAN_DEADLIFT_WITH_DUMBBELL"),
    "single leg hip thrust (chair)": ("HIP_RAISE", "SINGLE_LEG_HIP_RAISE_WITH_FOOT_ON_BENCH"),
    "explosive box step up": ("SQUAT", "ALTERNATING_BOX_DUMBBELL_STEP_UPS"),
    "loaded toe walk": ("CARRY", "FARMERS_WALK_ON_TOES"),
    "straight knee calf raise (hsr)": ("CALF_RAISE", "STANDING_DUMBBELL_CALF_RAISE"),
    "bent knee calf raise (hsr, soleus)": ("CALF_RAISE", "WEIGHTED_SEATED_CALF_RAISE"),
    "one arm dumbbell row": ("ROW", "ONE_ARM_BENT_OVER_ROW"),
    "floor chest fly": ("FLYE", "DUMBBELL_FLYE"),
    "overhead triceps extension": ("TRICEPS_EXTENSION", "OVERHEAD_DUMBBELL_TRICEPS_EXTENSION"),
    "rear delt fly": ("FLYE", "KNEELING_REAR_FLYE"),
    "dumbbell pullover": ("TRICEPS_EXTENSION", "LYING_DUMBBELL_PULLOVER_TO_EXTENSION"),
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


KADENZ_TAG = "[kadenz]"


def _tag_description(description: str | None) -> str:
    """Stamp Kadenz ownership into the workout description."""
    base = (description or "").strip()
    if KADENZ_TAG in base:
        return base
    return f"{base}\n{KADENZ_TAG}".strip()


def _pace_to_speed(pace_sec_km: int) -> float:
    """Convert sec/km pace to m/s (Garmin uses m/s internally)."""
    return 1000.0 / pace_sec_km


def _exec_step(
    *,
    order: int,
    step_type: dict[str, Any],
    end_condition: dict[str, Any],
    end_condition_value: str | None,
    child_step_id: int | None = None,
    target: dict[str, Any] | None = None,
    target_one: float | None = None,
    target_two: float | None = None,
) -> dict[str, Any]:
    """A single Garmin ExecutableStepDTO with the fields Connect expects."""
    return {
        "type": "ExecutableStepDTO",
        "stepId": None,
        "stepOrder": order,
        "childStepId": child_step_id,
        "description": None,
        "stepType": step_type,
        "endCondition": end_condition,
        "endConditionValue": end_condition_value,
        "endConditionCompare": None,
        "endConditionZone": None,
        "targetType": target or _TARGET_OPEN,
        "targetValueOne": target_one,
        "targetValueTwo": target_two,
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


def _build_steps(
    block: WorkoutBlock, start_order: int
) -> tuple[list[dict[str, Any]], int]:
    """Translate one WorkoutBlock into top-level Garmin steps.

    Returns the steps plus the next free stepOrder. Orders must be unique and
    sequential across the whole workout INCLUDING children of a repeat group —
    a repeat group, its child and the following block previously collided.
    """
    step_type = _STEP_TYPE_MAP.get(block.type)
    if step_type is None:
        raise ValueError(f"Unknown block type: {block.type!r}")

    reps = block.reps or 1

    # End condition for the work step. A repeated block measures ONE rep, so
    # rep_distance_meters wins there — without it the watch fell back to the
    # lap button and every interval read "press lap to end".
    if reps > 1 and block.rep_distance_meters is not None:
        work_condition = _CONDITION_DISTANCE
        work_value: str | None = str(int(block.rep_distance_meters))
    elif block.distance_meters is not None:
        work_condition = _CONDITION_DISTANCE
        work_value = str(int(block.distance_meters))
    elif block.duration_seconds is not None:
        work_condition = _CONDITION_TIME
        work_value = str(block.duration_seconds)
    elif block.rep_distance_meters is not None:
        # Single rep expressed only as a per-rep distance.
        work_condition = _CONDITION_DISTANCE
        work_value = str(int(block.rep_distance_meters))
    else:
        work_condition = _CONDITION_LAP_BUTTON
        work_value = None

    # Pace target
    if block.target_pace_sec_km and block.min_pace_sec_km and block.max_pace_sec_km:
        target = _TARGET_PACE
        # Garmin pace target uses m/s; faster (lower sec/km) = higher m/s
        target_one = _pace_to_speed(block.min_pace_sec_km)  # faster
        target_two = _pace_to_speed(block.max_pace_sec_km)  # slower
    else:
        target = _TARGET_OPEN
        target_one = None
        target_two = None

    if reps > 1:
        order = start_order
        child_steps = [
            _exec_step(
                order=order + 1,
                step_type=step_type,
                end_condition=work_condition,
                end_condition_value=work_value,
                child_step_id=1,
                target=target,
                target_one=target_one,
                target_two=target_two,
            )
        ]
        if block.rep_rest_seconds:
            child_steps.append(
                _exec_step(
                    order=order + 2,
                    step_type=_STEP_TYPE_MAP["recovery"],
                    end_condition=_CONDITION_TIME,
                    end_condition_value=str(block.rep_rest_seconds),
                    child_step_id=1,
                )
            )
        group = {
            "type": "RepeatGroupDTO",
            "stepId": None,
            "stepOrder": order,
            "childStepId": None,
            "description": None,
            "stepType": _STEP_REPEAT,
            "numberOfIterations": reps,
            "smartRepeat": False,
            "endCondition": _CONDITION_ITERATIONS,
            "endConditionValue": str(reps),
            "workoutSteps": child_steps,
        }
        return [group], order + 1 + len(child_steps)

    steps = [
        _exec_step(
            order=start_order,
            step_type=step_type,
            end_condition=work_condition,
            end_condition_value=work_value,
            target=target,
            target_one=target_one,
            target_two=target_two,
        )
    ]
    next_order = start_order + 1
    # A single-rep block can still prescribe recovery (ladders) — it used to be
    # dropped because only the repeat branch emitted rest.
    if block.rep_rest_seconds:
        steps.append(
            _exec_step(
                order=next_order,
                step_type=_STEP_TYPE_MAP["recovery"],
                end_condition=_CONDITION_TIME,
                end_condition_value=str(block.rep_rest_seconds),
            )
        )
        next_order += 1
    return steps, next_order


def _build_step(block: WorkoutBlock, order: int) -> dict[str, Any]:
    """Single-step helper. Rejects blocks that expand to several steps rather
    than silently returning the first and dropping e.g. the rest step."""
    steps, _ = _build_steps(block, order)
    if len(steps) != 1:
        raise ValueError("Block expands to multiple steps — use _build_steps")
    return steps[0]


def _build_workout_payload(
    req: CreateWorkoutRequest,
) -> dict[str, Any]:
    """Build the full Garmin Connect workout creation payload."""
    sport = _SPORT_TYPE_MAP.get(req.sport_type, _SPORT_TYPE_MAP["running"])
    steps: list[dict[str, Any]] = []
    order = 1
    for block in req.blocks:
        built, order = _build_steps(block, order)
        steps.extend(built)

    return {
        "sportType": sport,
        "subSportType": None,
        "workoutName": req.title,
        # Ownership marker: reconcile deletes ONLY workouts carrying this tag,
        # so other apps' (Benchmark) and hand-made workouts are never touched.
        "description": _tag_description(req.description),
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
        logger.debug("Exercise %r resolved via curated map", name)
        return _EXERCISE_TAXONOMY[key]
    if category:
        cat = _to_upper_snake(category)
        if cat in _GARMIN_CATEGORIES:
            logger.debug("Exercise %r resolved via category hint %r", name, cat)
            return cat, _to_upper_snake(name)
    resolved = taxonomy.resolve(name)
    if resolved is not None:
        logger.debug("Exercise %r resolved via Garmin taxonomy", name)
        return resolved
    logger.debug("Exercise %r unresolved; using generic strength step", name)
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
        "description": _tag_description(None),
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
