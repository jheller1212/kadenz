"""Run-workout payload shapes: interval distance, step ordering, rescheduling."""

from unittest.mock import patch

from workouts import CreateWorkoutRequest, WorkoutBlock, _build_workout_payload


def _flatten(steps):
    """Every step in document order, descending into repeat groups."""
    out = []
    for s in steps:
        out.append(s)
        out.extend(s.get("workoutSteps", []))
    return out


def _steps(blocks):
    """Top-level steps of the built payload."""
    return _payload(blocks)["workoutSegments"][0]["workoutSteps"]


def _payload(blocks):
    return _build_workout_payload(
        CreateWorkoutRequest(
            title="W", sport_type="running", scheduled_date="2026-08-01", blocks=blocks
        )
    )


def test_interval_reps_use_per_rep_distance_not_lap_button():
    """5x800m must end each rep on distance — lap-button meant manual laps."""
    steps = _steps([
        WorkoutBlock(type="work", reps=5, rep_distance_meters=800, rep_rest_seconds=90)
    ])
    group = steps[0]
    assert group["type"] == "RepeatGroupDTO"
    assert group["numberOfIterations"] == 5
    work = group["workoutSteps"][0]
    assert work["endCondition"]["conditionTypeKey"] == "distance"
    assert work["endConditionValue"] == "800"


def test_interval_emits_rest_step_between_reps():
    steps = _steps([
        WorkoutBlock(type="work", reps=4, rep_distance_meters=400, rep_rest_seconds=60)
    ])
    children = steps[0]["workoutSteps"]
    assert len(children) == 2
    rest = children[1]
    assert rest["endCondition"]["conditionTypeKey"] == "time"
    assert rest["endConditionValue"] == "60"


def test_single_rep_block_keeps_its_rest():
    """Ladder blocks (reps=1) used to silently lose their recovery."""
    steps = _steps([
        WorkoutBlock(type="work", reps=1, rep_distance_meters=1000, rep_rest_seconds=120)
    ])
    assert len(steps) == 2
    assert steps[0]["endConditionValue"] == "1000"
    assert steps[1]["endConditionValue"] == "120"


def test_step_orders_are_unique_and_ascending_across_blocks():
    """Repeat group, its children and the next block must not collide."""
    steps = _steps([
        WorkoutBlock(type="warmup", duration_seconds=600),
        WorkoutBlock(type="work", reps=3, rep_distance_meters=800, rep_rest_seconds=90),
        WorkoutBlock(type="cooldown", duration_seconds=300),
    ])
    orders = [s["stepOrder"] for s in _flatten(steps)]
    assert orders == sorted(orders), orders
    assert len(orders) == len(set(orders)), f"duplicate stepOrder: {orders}"


def test_plain_distance_block_unchanged():
    steps = _steps([WorkoutBlock(type="work", distance_meters=10000)])
    step = steps[0]
    assert step["endCondition"]["conditionTypeKey"] == "distance"
    assert step["endConditionValue"] == "10000"


def test_move_removes_the_previous_calendar_entry():
    """Scheduling ADDS an entry, so the old day must be unscheduled."""
    import main

    calls = []

    def fake_call(path, method="GET", **kwargs):
        calls.append((method, path))
        if method == "GET" and path.startswith("/workout-service/schedule/"):
            return [
                {"scheduleId": 111, "date": "2026-08-01"},
                {"scheduleId": 222, "date": "2026-08-05"},
            ]
        return {"workoutScheduleId": 333}

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        result = main.move_workout(
            "42", main.MoveWorkoutRequest(scheduled_date="2026-08-05"), None
        )

    assert ("DELETE", "/workout-service/schedule/111") in calls
    # The entry already on the target date is kept, not churned.
    assert ("DELETE", "/workout-service/schedule/222") not in calls
    assert result["removed_stale_schedules"] == 1


def test_move_still_schedules_when_lookup_fails():
    """A duplicate on the watch beats a workout that never arrives."""
    import main

    scheduled = []

    def fake_call(path, method="GET", **kwargs):
        if method == "GET" and path.startswith("/workout-service/schedule/"):
            raise RuntimeError("Garmin down")
        scheduled.append(path)
        return {"workoutScheduleId": 999}

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        result = main.move_workout(
            "42", main.MoveWorkoutRequest(scheduled_date="2026-08-05"), None
        )

    assert result["removed_stale_schedules"] == 0
    assert scheduled, "new schedule must still be created"
