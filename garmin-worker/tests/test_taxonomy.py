"""
Tests for taxonomy.py — snapshot-based, no network (conftest blocks the
live fetch, so everything resolves against data/garmin_exercises_snapshot.json).
"""

import pytest

import taxonomy
from workouts import _resolve_exercise


# ── Resolution against the real snapshot ─────────────────────────────────────

# Realistic Kadenz exercise names that exist verbatim (after normalization)
# in Garmin's published taxonomy.
SNAPSHOT_HITS = [
    ("Goblet squat", ("SQUAT", "GOBLET_SQUAT")),
    ("Romanian deadlift", ("DEADLIFT", "ROMANIAN_DEADLIFT")),
    ("Push-up", ("PUSH_UP", "PUSH_UP")),
    ("Calf raise", ("CALF_RAISE", "CALF_RAISE")),
    ("Standing calf raise", ("CALF_RAISE", "STANDING_CALF_RAISE")),
    ("Dumbbell squat", ("SQUAT", "DUMBBELL_SQUAT")),
    ("Renegade row", ("ROW", "RENEGADE_ROW")),
    ("Arnold press", ("SHOULDER_PRESS", "ARNOLD_PRESS")),
    ("Dumbbell shrug", ("SHRUG", "DUMBBELL_SHRUG")),
    ("Sumo squat", ("SQUAT", "SUMO_SQUAT")),
    ("Russian twist", ("CORE", "RUSSIAN_TWIST")),
    ("Weighted sit-up", ("SIT_UP", "WEIGHTED_SIT_UP")),
    # Generic movement category preferred over BANDED_EXERCISES duplicate.
    ("Front raise", ("LATERAL_RAISE", "FRONT_RAISE")),
]


@pytest.mark.parametrize("name,expected", SNAPSHOT_HITS)
def test_resolve_snapshot_hits(name, expected):
    assert taxonomy.resolve(name) == expected


def test_resolve_is_word_order_insensitive():
    # Token-set equality: same words, different order.
    assert taxonomy.resolve("Squat, goblet") == ("SQUAT", "GOBLET_SQUAT")
    assert taxonomy.resolve("Deadlift (Romanian)") == (
        "DEADLIFT",
        "ROMANIAN_DEADLIFT",
    )


def test_resolve_applies_synonyms():
    assert taxonomy.resolve("DB squat") == ("SQUAT", "DUMBBELL_SQUAT")
    assert taxonomy.resolve("Triceps kickback") == (
        "BANDED_EXERCISES",
        "TRICEP_KICKBACK",
    )


@pytest.mark.parametrize(
    "name",
    [
        # Garmin's taxonomy genuinely has no exercise with exactly these
        # tokens (only qualified variants like BARBELL_BULGARIAN_SPLIT_SQUAT
        # or OVERHEAD_BARBELL_PRESS) — curated map covers the important ones.
        "Standing overhead press",
        "Bulgarian split squat",
        "Loaded toe walk",
        "Rear-delt fly",
        "Curl to press",
        "Mystery Machine Move",
        "",
    ],
)
def test_resolve_misses_return_none(name):
    assert taxonomy.resolve(name) is None


def test_load_taxonomy_returns_normalized_index():
    index = taxonomy.load_taxonomy()
    assert index["gobletsquat"] == ("SQUAT", "GOBLET_SQUAT")
    assert all(
        isinstance(k, str) and isinstance(v, tuple) and len(v) == 2
        for k, v in index.items()
    )
    # Snapshot is substantial: full taxonomy, not a stub.
    assert len(index) > 1000


# ── Live fetch, TTL cache, and fallback behavior ─────────────────────────────

FAKE_LIVE_PAYLOAD = {
    "categories": {
        "SQUAT": {"exercises": {"FAKE_LIVE_SQUAT": {"primaryMuscles": []}}},
    }
}


def test_live_fetch_used_when_available(monkeypatch):
    monkeypatch.setattr(taxonomy, "_fetch_live", lambda: FAKE_LIVE_PAYLOAD)
    taxonomy._clear_cache()
    assert taxonomy.resolve("Fake live squat") == ("SQUAT", "FAKE_LIVE_SQUAT")
    assert taxonomy.resolve("Goblet squat") is None  # snapshot not consulted


def test_live_fetch_failure_falls_back_to_snapshot():
    # conftest already makes _fetch_live raise; the snapshot must serve.
    taxonomy._clear_cache()
    assert taxonomy.resolve("Goblet squat") == ("SQUAT", "GOBLET_SQUAT")


def test_ttl_cache_avoids_refetch_within_ttl(monkeypatch):
    calls = {"n": 0}

    def counting_fetch():
        calls["n"] += 1
        return FAKE_LIVE_PAYLOAD

    monkeypatch.setattr(taxonomy, "_fetch_live", counting_fetch)
    taxonomy._clear_cache()
    taxonomy.resolve("Fake live squat")
    taxonomy.resolve("Fake live squat")
    taxonomy.load_taxonomy()
    assert calls["n"] == 1


def test_ttl_cache_refetches_after_expiry(monkeypatch):
    calls = {"n": 0}

    def counting_fetch():
        calls["n"] += 1
        return FAKE_LIVE_PAYLOAD

    fake_now = {"t": 1000.0}
    monkeypatch.setattr(taxonomy, "_fetch_live", counting_fetch)
    monkeypatch.setattr(taxonomy.time, "monotonic", lambda: fake_now["t"])
    taxonomy._clear_cache()

    taxonomy.resolve("Fake live squat")
    fake_now["t"] += taxonomy._TTL_SECONDS - 1
    taxonomy.resolve("Fake live squat")
    assert calls["n"] == 1

    fake_now["t"] += 2  # now past the TTL
    taxonomy.resolve("Fake live squat")
    assert calls["n"] == 2


# ── Wiring into _resolve_exercise ────────────────────────────────────────────


def test_resolve_exercise_curated_map_wins_over_taxonomy():
    # "Calf raise" is in both; the curated map's deliberate choice
    # (STANDING_CALF_RAISE) must beat the taxonomy's literal CALF_RAISE.
    assert _resolve_exercise("Calf raise", None) == (
        "CALF_RAISE",
        "STANDING_CALF_RAISE",
    )


def test_resolve_exercise_falls_through_to_taxonomy():
    # Not in the curated map, no category hint → taxonomy resolves it.
    assert _resolve_exercise("Arnold press", None) == (
        "SHOULDER_PRESS",
        "ARNOLD_PRESS",
    )
    assert _resolve_exercise("Renegade row", None) == ("ROW", "RENEGADE_ROW")


def test_resolve_exercise_still_none_when_unmappable():
    assert _resolve_exercise("Loaded toe walk", None) == (None, None)
