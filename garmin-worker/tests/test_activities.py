"""
Tests for the activity pull endpoints (GET /activities, GET /activities/{id}).

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

client = TestClient(app, raise_server_exceptions=True)
AUTH_HEADERS = {"authorization": "Bearer test-token"}


class FakeAuthError(Exception):
    """Mimics a garth HTTP error carrying a 401 response."""

    def __init__(self, status: int = 401):
        super().__init__(f"{status} Client Error: Unauthorized")
        self.response = SimpleNamespace(status_code=status)


def make_activity(**overrides) -> dict:
    base = {
        "activityId": 111,
        "activityName": "Morning Run",
        "activityType": {"typeKey": "running"},
        "startTimeLocal": "2026-07-16 07:00:00",
        "startTimeGMT": "2026-07-16 05:00:00",
        "distance": 10000.0,
        "duration": 3000.0,
        "averageSpeed": 3.333333,
        "averageHR": 150.0,
        "maxHR": 172.0,
        "elevationGain": 85.0,
        "calories": 640.0,
    }
    base.update(overrides)
    return base


# ── Auth guard ────────────────────────────────────────────────────────────────


def test_list_activities_no_auth():
    assert client.get("/activities").status_code == 422


def test_list_activities_wrong_token():
    resp = client.get(
        "/activities", headers={"authorization": "Bearer wrong-token"}
    )
    assert resp.status_code == 401


def test_activity_detail_no_auth():
    assert client.get("/activities/111").status_code == 422


def test_activity_detail_wrong_token():
    resp = client.get(
        "/activities/111", headers={"authorization": "Bearer nope"}
    )
    assert resp.status_code == 401


# ── GET /activities mapping + filter ─────────────────────────────────────────


def test_list_activities_mapping():
    page = [
        make_activity(),
        make_activity(
            activityId=222,
            activityName="Gym",
            activityType={"typeKey": "strength_training"},
            distance=0.0,
            averageSpeed=0.0,
        ),
        make_activity(
            activityId=333,
            activityName="Yoga",
            activityType={"typeKey": "yoga"},
        ),
    ]
    with patch("main.garth.connectapi", return_value=page) as mock_api:
        resp = client.get("/activities", headers=AUTH_HEADERS)

    assert resp.status_code == 200
    acts = resp.json()["activities"]
    assert len(acts) == 3

    run = acts[0]
    assert run["garminId"] == 111
    assert run["name"] == "Morning Run"
    assert run["activityType"] == "running"
    assert run["kind"] == "run"
    assert run["startTimeLocal"] == "2026-07-16 07:00:00"
    assert run["startTimeGMT"] == "2026-07-16 05:00:00"
    assert run["distanceMeters"] == 10000.0
    assert run["durationSeconds"] == 3000.0
    assert run["avgPaceSecPerKm"] == 300  # 3.3333 m/s → 5:00/km
    assert run["avgHr"] == 150.0
    assert run["maxHr"] == 172.0
    assert run["elevationGain"] == 85.0
    assert run["calories"] == 640.0

    assert acts[1]["kind"] == "strength"
    assert acts[1]["avgPaceSecPerKm"] is None  # pace only derived for runs
    assert acts[2]["kind"] == "other"
    # Single page smaller than page size — no extra paging calls
    assert mock_api.call_count == 1

    # Verify Garmin endpoint + paging params
    args, kwargs = mock_api.call_args
    assert args[0] == "/activitylist-service/activities/search/activities"
    assert kwargs["params"] == {"start": 0, "limit": 50}


def test_list_activities_since_filter():
    page = [
        make_activity(activityId=1, startTimeGMT="2026-07-16 05:00:00"),
        make_activity(activityId=2, startTimeGMT="2026-07-10 05:00:00"),
        make_activity(activityId=3, startTimeGMT="2026-07-01 05:00:00"),
    ]
    with patch("main.garth.connectapi", return_value=page) as mock_api:
        resp = client.get(
            "/activities",
            params={"since": "2026-07-12T00:00:00Z"},
            headers=AUTH_HEADERS,
        )

    assert resp.status_code == 200
    acts = resp.json()["activities"]
    assert [a["garminId"] for a in acts] == [1]
    # Stops paging once activities older than `since` are reached
    assert mock_api.call_count == 1


def test_list_activities_limit():
    page = [make_activity(activityId=i) for i in range(10)]
    with patch("main.garth.connectapi", return_value=page):
        resp = client.get(
            "/activities", params={"limit": 4}, headers=AUTH_HEADERS
        )
    assert len(resp.json()["activities"]) == 4


def test_list_activities_invalid_since():
    resp = client.get(
        "/activities", params={"since": "not-a-date"}, headers=AUTH_HEADERS
    )
    assert resp.status_code == 400


def test_list_activities_garmin_error():
    with patch("main.garth.connectapi", side_effect=Exception("Garmin down")):
        resp = client.get("/activities", headers=AUTH_HEADERS)
    assert resp.status_code == 502


# ── GET /activities/{id} detail + splits ─────────────────────────────────────


def make_detail() -> dict:
    return {
        "activityId": 111,
        "activityName": "Morning Run",
        "activityTypeDTO": {"typeKey": "trail_running"},
        "summaryDTO": {
            "startTimeLocal": "2026-07-16T07:00:00.0",
            "startTimeGMT": "2026-07-16T05:00:00.0",
            "distance": 10000.0,
            "duration": 3000.0,
            "averageSpeed": 3.333333,
            "averageHR": 150.0,
            "maxHR": 172.0,
            "elevationGain": 85.0,
            "calories": 640.0,
        },
    }


def make_splits() -> dict:
    return {
        "lapDTOs": [
            {
                "distance": 1000.0,
                "duration": 290.0,
                "averageSpeed": 3.448,
                "averageHR": 148.0,
            },
            {
                "distance": 1000.0,
                "duration": 310.0,
                "averageHR": 155.0,
                # no averageSpeed — pace derived from duration/distance
            },
        ]
    }


def test_activity_detail_with_splits():
    with patch("main.garth.connectapi", side_effect=[make_detail(), make_splits()]):
        resp = client.get("/activities/111", headers=AUTH_HEADERS)

    assert resp.status_code == 200
    body = resp.json()
    assert body["garminId"] == 111
    assert body["activityType"] == "trail_running"
    assert body["kind"] == "run"
    assert body["avgPaceSecPerKm"] == 300
    assert body["lapCount"] == 2
    assert len(body["splits"]) == 2

    s1, s2 = body["splits"]
    assert s1 == {
        "distanceKm": 1.0,
        "durationSeconds": 290.0,
        "avgHr": 148.0,
        "avgPaceSecPerKm": 290,  # from averageSpeed 3.448 m/s
    }
    assert s2["avgPaceSecPerKm"] == 310  # derived from duration/distance
    assert s2["avgHr"] == 155.0


def test_activity_detail_splits_unavailable():
    with patch(
        "main.garth.connectapi",
        side_effect=[make_detail(), Exception("500 Server Error")],
    ):
        resp = client.get("/activities/111", headers=AUTH_HEADERS)

    assert resp.status_code == 200
    body = resp.json()
    assert body["splits"] == []
    assert body["lapCount"] == 0


def test_activity_detail_garmin_error():
    with patch("main.garth.connectapi", side_effect=Exception("boom")):
        resp = client.get("/activities/111", headers=AUTH_HEADERS)
    assert resp.status_code == 502


# ── Auth-failure resilience (503 garmin_auth) ────────────────────────────────


def test_list_activities_persistent_auth_failure_returns_503():
    with (
        patch("main.garth.connectapi", side_effect=FakeAuthError()),
        patch("main.garth.resume", MagicMock()),
    ):
        resp = client.get("/activities", headers=AUTH_HEADERS)
    assert resp.status_code == 503
    assert resp.json() == {"error": "garmin_auth"}


def test_list_activities_auth_retry_recovers():
    page = [make_activity()]
    with (
        patch(
            "main.garth.connectapi", side_effect=[FakeAuthError(), page]
        ) as mock_api,
        patch("main.garth.resume", MagicMock()) as mock_resume,
    ):
        resp = client.get("/activities", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert len(resp.json()["activities"]) == 1
    assert mock_resume.called
    assert mock_api.call_count == 2


def test_workout_delete_persistent_auth_failure_returns_503():
    # Existing routes go through the same retry wrapper
    with (
        patch("main.garth.connectapi", side_effect=FakeAuthError()),
        patch("main.garth.resume", MagicMock()),
    ):
        resp = client.delete("/workouts/123", headers=AUTH_HEADERS)
    assert resp.status_code == 503
    assert resp.json() == {"error": "garmin_auth"}
