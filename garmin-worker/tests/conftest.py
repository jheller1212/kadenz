"""
Shared test fixtures.

Blocks the taxonomy live fetch in every test so nothing hits the network —
resolution falls back to the bundled snapshot. Individual tests re-patch
taxonomy._fetch_live when they need to exercise the live path.
"""

import pytest

import taxonomy


def _network_disabled() -> dict:
    raise RuntimeError("network disabled in tests")


@pytest.fixture(autouse=True)
def no_taxonomy_network(monkeypatch):
    monkeypatch.setattr(taxonomy, "_fetch_live", _network_disabled)
    taxonomy._clear_cache()
    yield
    taxonomy._clear_cache()
