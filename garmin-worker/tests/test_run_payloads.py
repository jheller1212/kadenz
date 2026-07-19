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


def test_move_keeps_only_the_entry_it_just_created():
    """Scheduling ADDS an entry; every earlier one for this workout goes."""
    import main

    schedules = [
        {"scheduleId": 111, "date": "2026-08-01"},  # the old day
        {"scheduleId": 222, "date": "2026-08-05"},  # a stale entry on the new day
    ]
    deleted = []

    def fake_call(path, method="GET", **kwargs):
        if method == "GET" and path.startswith("/workout-service/schedule/"):
            return list(schedules)
        if method == "DELETE":
            deleted.append(int(path.rsplit("/", 1)[1]))
            return {}
        # POST = schedule: the new entry now exists too
        schedules.append({"scheduleId": 333, "date": "2026-08-05"})
        return {"workoutScheduleId": 333}

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        result = main.move_workout(
            "42", main.MoveWorkoutRequest(scheduled_date="2026-08-05"), None
        )

    assert sorted(deleted) == [111, 222], deleted
    assert 333 not in deleted, "must not delete the entry it just created"
    assert result["removed_stale_schedules"] == 2


def test_move_schedules_before_pruning():
    """A failed schedule must not leave the calendar emptied."""
    import main

    order = []

    def fake_call(path, method="GET", **kwargs):
        if method == "GET" and path.startswith("/workout-service/schedule/"):
            order.append("list")
            return [{"scheduleId": 111, "date": "2026-08-01"}]
        if method == "DELETE":
            order.append("delete")
            return {}
        order.append("schedule")
        raise RuntimeError("Garmin refused the new schedule")

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        try:
            main.move_workout("42", main.MoveWorkoutRequest(scheduled_date="2026-08-05"), None)
        except Exception:
            pass

    assert "delete" not in order, "nothing may be deleted when scheduling failed"
    assert order[0] == "schedule"


def test_move_succeeds_even_if_pruning_fails():
    """A leftover duplicate must not turn a successful move into an error."""
    import main

    def fake_call(path, method="GET", **kwargs):
        if method == "GET" and path.startswith("/workout-service/schedule/"):
            raise RuntimeError("Garmin down")
        return {"workoutScheduleId": 333}

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        result = main.move_workout(
            "42", main.MoveWorkoutRequest(scheduled_date="2026-08-05"), None
        )

    assert result["removed_stale_schedules"] == 0
    assert result["scheduled_date"] == "2026-08-05"




def test_list_workouts_includes_scheduled_dates():
    """Reconcile needs to know what Garmin holds AND when it's scheduled."""
    import main

    def fake_call(path, method="GET", **kwargs):
        if path.startswith("/workout-service/workouts"):
            return [
                {"workoutId": 1, "workoutName": "Easy Run", "sportType": {"sportTypeKey": "running"}},
                {"workoutId": 2, "workoutName": "Upper", "sportType": {"sportTypeKey": "strength_training"}},
            ]
        if path.startswith("/workout-service/schedule/1"):
            return [{"scheduleId": 11, "date": "2026-08-01"}]
        return []

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        out = main.list_workouts(None, with_schedules=True)

    ids = [w["garminWorkoutId"] for w in out["workouts"]]
    assert ids == ["1", "2"]
    assert out["workouts"][0]["scheduledDates"] == ["2026-08-01"]
    assert out["workouts"][1]["scheduledDates"] == []


def test_list_workouts_skips_schedule_lookups_by_default():
    """Reconcile matches ids only — the per-workout lookup is what timed it out."""
    import main

    paths = []

    def fake_call(path, method="GET", **kwargs):
        paths.append(path)
        if path.startswith("/workout-service/workouts"):
            return [{"workoutId": 5, "workoutName": "Y", "sportType": {"sportTypeKey": "running"}}]
        return []

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        out = main.list_workouts(None)

    assert out["workouts"][0]["scheduledDates"] == []
    assert not any(p.startswith("/workout-service/schedule/") for p in paths)


def test_list_workouts_survives_a_schedule_lookup_failure():
    import main

    def fake_call(path, method="GET", **kwargs):
        if path.startswith("/workout-service/workouts"):
            return [{"workoutId": 7, "workoutName": "X", "sportType": {"sportTypeKey": "running"}}]
        raise RuntimeError("schedule service down")

    with patch.object(main, "_garmin_call", side_effect=fake_call):
        out = main.list_workouts(None, with_schedules=True)

    assert out["workouts"][0]["scheduledDates"] == []
