"""Tests for the imprint/attribute matcher behind POST /api/identify."""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Fake DB settings so modules import without a real database (same as test_api.py).
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from routes.identify import _attr_matches, _clean_tokens, _match_quality, _score_row  # noqa: E402


def test_clean_tokens_uppercases_splits_and_dedupes():
    assert _clean_tokens(["lamictal xr", "200", "XR"]) == ["LAMICTAL", "XR", "200"]


def test_clean_tokens_strips_noise_characters():
    assert _clean_tokens(["m3*67!", " "]) == ["M367"]


def test_attr_matches_handles_multi_value_db_fields():
    assert _attr_matches("blue", "BLUE, WHITE") is True
    assert _attr_matches("red", "BLUE, WHITE") is False
    assert _attr_matches("", "BLUE") is None  # attribute not supplied → excluded from scoring


def test_score_exact_two_sided_imprint_is_perfect():
    score, matched = _score_row(["LAMICTAL", "XR", "200"], {"LAMICTAL", "XR", "200"}, True, True)
    assert score == 1.0 and matched == ["LAMICTAL", "XR", "200"]
    assert _match_quality(score, matched, ["LAMICTAL", "XR", "200"]) == "exact"


def test_score_partial_read_is_penalized_but_nonzero():
    score, matched = _score_row(["200"], {"LAMICTAL", "XR", "200"}, None, None)
    assert 0 < score < 1 and matched == ["200"]


def test_score_ignores_missing_attributes_in_normalization():
    with_attrs, _ = _score_row(["S", "10"], {"S", "10"}, True, True)
    without_attrs, _ = _score_row(["S", "10"], {"S", "10"}, None, None)
    assert with_attrs == without_attrs == 1.0


@pytest.fixture
def client():
    with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
        from main import app

        with TestClient(app) as c:
            yield c


def test_identify_requires_some_input(client):
    res = client.post("/api/identify", json={"imprint_tokens": [], "color": None, "shape": None})
    assert res.status_code == 422
