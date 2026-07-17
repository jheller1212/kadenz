"""
Tests for POST /strength-workouts and the strength payload builders.

All Garmin API calls are mocked — no real network requests are made.
"""

import os
import warnings
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

warnings.filterwarnings("ignore", category=DeprecationWarning, module="garth")

os.environ.setdefault("WORKER_TOKEN", "test-token")
os.environ.setdefault("GARTH_HOME", "/tmp/garth-test")

with patch("garth.resume"), patch("os.path.exists", return_value=False):
    from main import app
    from workouts import (
        CreateStrengthWorkoutRequest,
        StrengthExercise,
        _build_strength_step,
        _build_strength_workout_payload,
        _resolve_exercise,
    )

client = TestClient(app, raise_server_exceptions=True)
AUTH_HEADERS = {"authorization": "Bearer test-token"}


class FakeAuthError(Exception):
    def __init__(self, status: int = 401):
        super().__init__(f"{status} Client Error: Unauthorized")
        self.response = SimpleNamespace(status_code=status)


def make_request(**overrides) -> dict:
    base = {
        "title": "Kraft A",
        "date": "2026-07-20",
        "exercises": [
            {
                "name": "Bench Press",
                "category": "bench_press",
                "sets": 3,
                "reps": 5,
                "weightKg": 60.0,
            },
            {
                "name": "Mystery Machine Move",
                "category": None,
                "sets": 2,
                "reps": 12,
            },
        ],
    }
    base.update(overrides)
    return base


# ── Taxonomy resolution ──────────────────────────────────────────────────────


def test_resolve_exercise_curated_name():
    assert _resolve_exercise("Bench Press", None) == (
        "BENCH_PRESS",
        "BARBELL_BENCH_PRESS",
    )
    assert _resolve_exercise("goblet-squat", None) == ("SQUAT", "GOBLET_SQUAT")


def test_resolve_exercise_category_hint():
    assert _resolve_exercise("Nordic Curl", "leg_curl") == (
        "LEG_CURL",
        "NORDIC_CURL",
    )


def test_resolve_exercise_unmappable():
    assert _resolve_exercise("Mystery Machine Move", None) == (None, None)
    assert _resolve_exercise("Mystery Move", "not_a_category") == (None, None)


# ── Payload construction ─────────────────────────────────────────────────────


def test_build_strength_step_shape():
    ex = StrengthExercise(
        name="Bench Press", category="bench_press", sets=3, reps=5, weightKg=60.0
    )
    group = _build_strength_step(ex, 1)

    assert group["type"] == "RepeatGroupDTO"
    assert group["stepType"] == {"stepTypeId": 6, "stepTypeKey": "repeat"}
    assert group["numberOfIterations"] == 3  # sets
    assert group["endCondition"]["conditionTypeKey"] == "iterations"

    (child,) = group["workoutSteps"]
    assert child["type"] == "ExecutableStepDTO"
    assert child["stepType"]["stepTypeKey"] == "interval"
    assert child["endCondition"] == {"conditionTypeId": 10, "conditionTypeKey": "reps"}
    assert child["endConditionValue"] == "5"
    assert child["category"] == "BENCH_PRESS"
    assert child["exerciseName"] == "BARBELL_BENCH_PRESS"
    assert child["weightValue"] == 60.0
    assert child["weightUnit"] == {
        "unitId": 8,
        "unitKey": "kilogram",
        "factor": 1000.0,
    }
    assert child["description"] is None
    assert child["targetType"]["workoutTargetTypeKey"] == "no.target"


def test_build_strength_step_fallback_generic():
    ex = StrengthExercise(name="Mystery Machine Move", sets=2, reps=12)
    group = _build_strength_step(ex, 1)
    (child,) = group["workoutSteps"]
    assert child["category"] is None
    assert child["exerciseName"] is None
    assert child["description"] == "Mystery Machine Move"
    assert "weightValue" not in child  # no weight given


def test_build_strength_workout_payload_shape():
    req = CreateStrengthWorkoutRequest(**make_request())
    payload = _build_strength_workout_payload(req)

    assert payload["sportType"] == {
        "sportTypeId": 5,
        "sportTypeKey": "strength_training",
    }
    assert payload["workoutName"] == "Kraft A"
    assert len(payload["workoutSegments"]) == 1
    segment = payload["workoutSegments"][0]
    assert segment["sportType"]["sportTypeKey"] == "strength_training"

    steps = segment["workoutSteps"]
    assert len(steps) == 2
    assert all(s["type"] == "RepeatGroupDTO" for s in steps)
    assert steps[0]["numberOfIterations"] == 3
    assert steps[1]["numberOfIterations"] == 2
    # Step orders don't collide across groups
    orders = [steps[0]["stepOrder"], steps[0]["workoutSteps"][0]["stepOrder"],
              steps[1]["stepOrder"], steps[1]["workoutSteps"][0]["stepOrder"]]
    assert orders == sorted(set(orders))


# ── POST /strength-workouts ──────────────────────────────────────────────────


def test_create_strength_workout_no_auth():
    resp = client.post("/strength-workouts", json=make_request())
    assert resp.status_code == 422  # missing Authorization header


def test_create_strength_workout_wrong_token():
    resp = client.post(
        "/strength-workouts",
        json=make_request(),
        headers={"authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 401


def test_create_strength_workout_success():
    with patch("main.garth.connectapi") as mock_api:
        mock_api.side_effect = [
            {"workoutId": 555, "workoutName": "Kraft A"},  # create
            {"workoutScheduleId": 777},  # schedule
        ]
        resp = client.post(
            "/strength-workouts", json=make_request(), headers=AUTH_HEADERS
        )

    assert resp.status_code == 201
    assert resp.json() == {"garminWorkoutId": "555", "scheduleId": "777"}

    # Verify the payload sent to Garmin was a strength workout
    create_call = mock_api.call_args_list[0]
    assert create_call.args[0] == "/workout-service/workout"
    sent = create_call.kwargs["json"]
    assert sent["sportType"]["sportTypeKey"] == "strength_training"

    # Verify scheduling on the requested date
    schedule_call = mock_api.call_args_list[1]
    assert schedule_call.args[0] == "/workout-service/schedule/555"
    assert schedule_call.kwargs["json"] == {"date": "2026-07-20"}


def test_create_strength_workout_empty_exercises_rejected():
    resp = client.post(
        "/strength-workouts",
        json=make_request(exercises=[]),
        headers=AUTH_HEADERS,
    )
    assert resp.status_code == 422


def test_create_strength_workout_garmin_error():
    with patch("main.garth.connectapi", side_effect=Exception("Garmin down")):
        resp = client.post(
            "/strength-workouts", json=make_request(), headers=AUTH_HEADERS
        )
    assert resp.status_code == 502


def test_create_strength_workout_persistent_auth_failure_returns_503():
    with (
        patch("main.garth.connectapi", side_effect=FakeAuthError()),
        patch("main.garth.resume", MagicMock()),
    ):
        resp = client.post(
            "/strength-workouts", json=make_request(), headers=AUTH_HEADERS
        )
    assert resp.status_code == 503
    assert resp.json() == {"error": "garmin_auth"}
