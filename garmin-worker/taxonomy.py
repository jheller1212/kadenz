"""
Garmin exercise taxonomy loader and resolver.

Garmin publishes its full exercise taxonomy publicly (no auth) at
https://connect.garmin.com/web-data/exercises/Exercises.json. We fetch it
live with a 24h in-process cache and fall back to a bundled snapshot
(data/garmin_exercises_snapshot.json) on any failure, so resolution works
offline and in tests.

Resolution is deliberately conservative: exact normalized match, then
word-order-insensitive token-set equality, then None. No fuzzy scoring —
predictability beats cleverness on a watch.
"""

import json
import logging
import re
import threading
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

EXERCISES_URL = "https://connect.garmin.com/web-data/exercises/Exercises.json"
SNAPSHOT_PATH = Path(__file__).parent / "data" / "garmin_exercises_snapshot.json"

_TTL_SECONDS = 24 * 60 * 60
_FETCH_TIMEOUT_SECONDS = 5.0

# Small, principled token-level synonyms: common abbreviations and
# spelling variants only — no semantic guessing.
_SYNONYMS: dict[str, str] = {
    "db": "dumbbell",
    "bb": "barbell",
    "kb": "kettlebell",
    "dumbell": "dumbbell",
    "tricep": "triceps",
    "bicep": "biceps",
}

# Equipment-flavoured categories; when the same exercise name exists both
# here and in a generic movement category, prefer the generic one.
_EQUIPMENT_CATEGORIES = frozenset({
    "BANDED_EXERCISES", "BATTLE_ROPE", "SANDBAG", "SLED", "SLEDGE_HAMMER",
    "SUSPENSION", "TIRE",
})

# ── Normalization ────────────────────────────────────────────────────────────


def _tokens(value: str) -> list[str]:
    """Lowercase, split on non-alphanumerics, apply synonyms."""
    raw = [t for t in re.split(r"[^a-z0-9]+", value.lower()) if t]
    return [_SYNONYMS.get(t, t) for t in raw]


def _normalize(value: str) -> str:
    return "".join(_tokens(value))


def _preference(category: str, exercise_name: str) -> tuple[int, int, str]:
    """Rank order for the same exercise name across categories (lower wins):
    1. category whose tokens appear in the exercise name (e.g. SQUAT for
       GOBLET_SQUAT), 2. generic over equipment-flavoured, 3. alphabetical.
    """
    cat_matches = set(_tokens(category)) <= set(_tokens(exercise_name))
    return (
        0 if cat_matches else 1,
        1 if category in _EQUIPMENT_CATEGORIES else 0,
        category,
    )


# ── Index building ───────────────────────────────────────────────────────────


def _category_names(payload: dict) -> dict[str, list[str]]:
    """Accept both the live shape ({"categories": {cat: {"exercises": {...}}}})
    and the trimmed snapshot shape ({cat: [names]})."""
    categories = payload.get("categories", payload)
    out: dict[str, list[str]] = {}
    for cat, value in categories.items():
        if isinstance(value, dict):
            out[cat] = sorted(value.get("exercises", {}).keys())
        else:
            out[cat] = sorted(value)
    return out


def _build_indexes(
    payload: dict,
) -> tuple[dict[str, tuple[str, str]], dict[frozenset[str], tuple[str, str]]]:
    """Build (exact normalized index, token-set index)."""
    exact: dict[str, tuple[str, str]] = {}
    token_set: dict[frozenset[str], tuple[str, str]] = {}
    by_category = _category_names(payload)
    for category in sorted(by_category):
        for name in by_category[category]:
            key = _normalize(name)
            if not key:
                continue
            entry = (category, name)
            if key not in exact or _preference(category, name) < _preference(
                exact[key][0], name
            ):
                exact[key] = entry
            ts = frozenset(_tokens(name))
            if ts not in token_set or _preference(category, name) < _preference(
                token_set[ts][0], name
            ):
                token_set[ts] = entry
    return exact, token_set


# ── Loading with TTL cache + snapshot fallback ───────────────────────────────

_lock = threading.Lock()
_cache: (
    tuple[float, dict[str, tuple[str, str]], dict[frozenset[str], tuple[str, str]]]
    | None
) = None


def _fetch_live() -> dict:
    resp = httpx.get(EXERCISES_URL, timeout=_FETCH_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.json()


def _load_snapshot() -> dict:
    with SNAPSHOT_PATH.open() as f:
        return json.load(f)


def _clear_cache() -> None:
    """Test helper: drop the in-process cache."""
    global _cache
    with _lock:
        _cache = None


def _get_indexes() -> tuple[
    dict[str, tuple[str, str]], dict[frozenset[str], tuple[str, str]]
]:
    global _cache
    with _lock:
        now = time.monotonic()
        if _cache is not None and now - _cache[0] < _TTL_SECONDS:
            return _cache[1], _cache[2]
        try:
            payload = _fetch_live()
            logger.debug("Loaded Garmin exercise taxonomy from live endpoint")
        except Exception as exc:  # noqa: BLE001 — any failure falls back
            logger.debug(
                "Live taxonomy fetch failed (%s); using bundled snapshot", exc
            )
            payload = _load_snapshot()
        exact, token_set = _build_indexes(payload)
        _cache = (now, exact, token_set)
        return exact, token_set


def load_taxonomy() -> dict[str, tuple[str, str]]:
    """Return the normalized-name → (CATEGORY, EXERCISE_NAME) index.

    Tries the live Garmin endpoint (5s timeout, 24h in-process cache);
    falls back to the bundled snapshot on any failure.
    """
    exact, _ = _get_indexes()
    return exact


def resolve(name: str) -> tuple[str, str] | None:
    """Resolve a free-text exercise name to Garmin (category, exerciseName).

    Exact normalized match, then word-order-insensitive token-set equality,
    then None. No fuzzy scoring.
    """
    exact, token_set = _get_indexes()
    key = _normalize(name)
    if not key:
        return None
    hit = exact.get(key)
    if hit is not None:
        return hit
    return token_set.get(frozenset(_tokens(name)))
