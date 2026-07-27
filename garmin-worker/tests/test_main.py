"""
Tests for the garmin-worker FastAPI service.

All Garmin API calls are mocked — no real network requests are made.
"""

import os
import warnings
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Suppress garth deprecation warning in tests
warnings.filterwarnings("ignore", category=DeprecationWarning, module="garth")

# Set required env vars before importing app
os.environ.setdefault("WORKER_TOKEN", "test-token")
os.environ.setdefault("GARTH_HOME", "/tmp/garth-test")

with patch("garth.resume"), patch("os.path.exists", return_value=False):
    from main import _build_step, _build_workout_payload, app
    from main import WorkoutBlock, CreateWorkoutRequest

client = TestClient(app, raise_server_exceptions=True)
AUTH_HEADERS = {"authorization": "Bearer test-token"}


# ── Helper ────────────────────────────────────────────────────────────────────


def make_simple_request(**overrides) -> dict:
    base = {
        "title": "Easy Run",
        "scheduled_date": "2026-05-01",
        "sport_type": "running",
        "blocks": [
            {
                "type": "warmup",
                "duration_seconds": 600,
            },
            {
                "type": "work",
                "distance_meters": 8000,
                "target_pace_sec_km": 300,
                "min_pace_sec_km": 285,
                "max_pace_sec_km": 315,
            },
            {
                "type": "cooldown",
                "duration_seconds": 300,
            },
        ],
    }
    base.update(overrides)
    return base


# ── Auth tests ────────────────────────────────────────────────────────────────


def test_health_no_auth():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_create_workout_no_auth():
    resp = client.post("/workouts", json=make_simple_request())
    assert resp.status_code == 422  # missing Authorization header


def test_create_workout_wrong_token():
    resp = client.post(
        "/workouts",
        json=make_simple_request(),
        headers={"authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 401


# ── _build_step unit tests ────────────────────────────────────────────────────


def test_build_step_warmup_by_duration():
    block = WorkoutBlock(type="warmup", duration_seconds=600)
    step = _build_step(block, 1)
    assert step["stepType"]["stepTypeKey"] == "warmup"
    assert step["endCondition"]["conditionTypeKey"] == "time"
    assert step["endConditionValue"] == "600"
    assert step["targetType"]["workoutTargetTypeKey"] == "no.target"


def test_build_step_work_by_distance_with_pace():
    block = WorkoutBlock(
        type="work",
        distance_meters=5000,
        target_pace_sec_km=240,
        min_pace_sec_km=228,
        max_pace_sec_km=252,
    )
    step = _build_step(block, 2)
    assert step["stepType"]["stepTypeKey"] == "interval"
    assert step["endCondition"]["conditionTypeKey"] == "distance"
    assert step["endConditionValue"] == "5000"
    assert step["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    # faster pace (min_pace=228 sec/km) → higher m/s speed value
    assert step["targetValueOne"] > step["targetValueTwo"]


def test_build_step_cooldown_lap_button():
    block = WorkoutBlock(type="cooldown")
    step = _build_step(block, 3)
    assert step["endCondition"]["conditionTypeKey"] == "lap.button"
    assert step["endConditionValue"] is None


def test_build_step_unknown_type_raises():
    block = WorkoutBlock(type="sprint")
    with pytest.raises(ValueError, match="Unknown block type"):
        _build_step(block, 1)


def test_build_step_with_reps_returns_repeat_group():
    block = WorkoutBlock(
        type="work",
        reps=6,
        rep_distance_meters=400,
        distance_meters=400,
        target_pace_sec_km=210,
        min_pace_sec_km=200,
        max_pace_sec_km=220,
        rep_rest_seconds=90,
    )
    step = _build_step(block, 1)
    assert step["type"] == "RepeatGroupDTO"
    assert step["numberOfIterations"] == 6
    assert len(step["workoutSteps"]) == 2  # work + rest


# ── _build_workout_payload unit tests ────────────────────────────────────────


def test_build_workout_payload_structure():
    req = CreateWorkoutRequest(**make_simple_request())
    payload = _build_workout_payload(req)

    assert payload["workoutName"] == "Easy Run"
    assert payload["sportType"]["sportTypeKey"] == "running"
    assert len(payload["workoutSegments"]) == 1
    steps = payload["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 3
    assert steps[0]["stepType"]["stepTypeKey"] == "warmup"
    assert steps[1]["stepType"]["stepTypeKey"] == "interval"
    assert steps[2]["stepType"]["stepTypeKey"] == "cooldown"


def test_build_workout_payload_cycling():
    req = CreateWorkoutRequest(
        **{**make_simple_request(), "sport_type": "cycling"}
    )
    payload = _build_workout_payload(req)
    assert payload["sportType"]["sportTypeKey"] == "cycling"


# ── POST /workouts integration tests (garth mocked) ─────────────────────────


def test_create_workout_success():
    with (
        patch("main.garth.connectapi") as mock_api,
    ):
        mock_api.side_effect = [
            {"workoutId": 12345, "workoutName": "Easy Run"},  # create
            {"scheduleId": 99},  # schedule
        ]
        resp = client.post(
            "/workouts",
            json=make_simple_request(),
            headers=AUTH_HEADERS,
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["garmin_workout_id"] == "12345"
    assert body["scheduled_date"] == "2026-05-01"


def test_create_workout_garmin_api_error():
    with patch("main.garth.connectapi", side_effect=Exception("Garmin down")):
        resp = client.post(
            "/workouts",
            json=make_simple_request(),
            headers=AUTH_HEADERS,
        )
    assert resp.status_code == 502
    assert "Garmin API error" in resp.json()["detail"]


def test_create_workout_schedule_fails_cleans_up_orphan():
    """Scheduling failing after creation must delete the just-created workout,
    not leave it dangling for every outbox retry to duplicate."""
    with patch("main.garth.connectapi") as mock_api:
        mock_api.side_effect = [
            {"workoutId": 12345, "workoutName": "Easy Run"},  # create succeeds
            Exception("schedule down"),  # schedule fails
            {},  # cleanup delete succeeds
        ]
        resp = client.post(
            "/workouts",
            json=make_simple_request(),
            headers=AUTH_HEADERS,
        )
    assert resp.status_code == 502
    assert "rolled back" in resp.json()["detail"]
    # create, schedule, delete
    assert mock_api.call_count == 3
    delete_call = mock_api.call_args_list[2]
    assert delete_call.args[0] == "/workout-service/workout/12345"
    assert delete_call.kwargs["method"] == "DELETE"


def test_create_workout_schedule_and_cleanup_both_fail():
    """If the cleanup delete also fails, the error must say so clearly rather
    than swallowing it and reporting a plain scheduling failure."""
    with patch("main.garth.connectapi") as mock_api:
        mock_api.side_effect = [
            {"workoutId": 12345, "workoutName": "Easy Run"},
            Exception("schedule down"),
            Exception("delete down too"),
        ]
        resp = client.post(
            "/workouts",
            json=make_simple_request(),
            headers=AUTH_HEADERS,
        )
    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert "scheduling failed" in detail
    assert "Cleanup delete also failed" in detail
    assert "delete down too" in detail


def test_create_workout_missing_blocks():
    payload = {
        "title": "Bad",
        "scheduled_date": "2026-05-01",
        "blocks": [],
    }
    with patch("main.garth.connectapi") as mock_api:
        mock_api.side_effect = [
            {"workoutId": 1},
            {},
        ]
        resp = client.post("/workouts", json=payload, headers=AUTH_HEADERS)
    assert resp.status_code == 201  # empty blocks are allowed by the API


# ── PATCH /workouts/{id} ──────────────────────────────────────────────────────


def test_move_workout_success():
    with patch("main.garth.connectapi", return_value={"scheduleId": 42}) as mock_api:
        resp = client.patch(
            "/workouts/12345",
            json={"scheduled_date": "2026-05-10"},
            headers=AUTH_HEADERS,
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["garmin_workout_id"] == "12345"
    assert body["scheduled_date"] == "2026-05-10"


def test_move_workout_garmin_error():
    with patch("main.garth.connectapi", side_effect=Exception("timeout")):
        resp = client.patch(
            "/workouts/99",
            json={"scheduled_date": "2026-05-10"},
            headers=AUTH_HEADERS,
        )
    assert resp.status_code == 502


# ── DELETE /workouts/{id} ────────────────────────────────────────────────────


def test_delete_workout_success():
    with patch("main.garth.connectapi", return_value=None):
        resp = client.delete("/workouts/12345", headers=AUTH_HEADERS)
    assert resp.status_code == 204


def test_delete_workout_garmin_error():
    with patch("main.garth.connectapi", side_effect=Exception("not found")):
        resp = client.delete("/workouts/99999", headers=AUTH_HEADERS)
    assert resp.status_code == 502
