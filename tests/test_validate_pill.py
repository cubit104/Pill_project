"""
Tests for validate_pill() and completeness logic in routes/admin/field_schema.py.
Also tests GET /api/admin/pills/:id/completeness endpoint.
"""

import os
import pytest
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from routes.admin.field_schema import validate_pill, compute_completeness


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _full_pill():
    """Return a completely filled-in pill dict (all tiers satisfied)."""
    return {
        # Tier 1
        "medicine_name": "Ibuprofen",
        "author": "Generic Pharma",
        "spl_strength": "200mg",
        "splimprint": "IP 200",
        "splcolor_text": "white",
        "splshape_text": "oval",
        "slug": "ibuprofen-200mg",
        # Tier 2
        "ndc9": "12345-678",
        "ndc11": "12345-678-90",
        "dosage_form": "tablet",
        "route": "oral",
        "spl_ingredients": "Ibuprofen 200mg",
        "spl_inactive_ing": "microcrystalline cellulose",
        "dea_schedule_name": "N/A",
        "status_rx_otc": "OTC",
        "image_alt_text": "white oval pill imprinted IP 200",
        "has_image": "TRUE",
        # Tier 3
        "brand_names": "Advil",
        "splsize": "10",
        "meta_description": "Ibuprofen 200mg OTC",
        "pharmclass_fda_epc": "Anti-inflammatory",
        "rxcui": "5640",
        "rxcui_1": "5641",
        "imprint_status": "active",
        "tags": "pain, fever",
    }


# ---------------------------------------------------------------------------
# validate_pill — Tier 1
# ---------------------------------------------------------------------------

class TestValidatePillTier1:
    def test_empty_tier1_rejected_in_strict_mode(self):
        data = _full_pill()
        data["medicine_name"] = ""
        errors = validate_pill(data, strict=True)
        assert any(e["field"] == "medicine_name" for e in errors)

    def test_empty_tier1_allowed_in_draft_mode(self):
        """Tier 1 is NOT enforced in draft mode — allows saving partial data."""
        data = _full_pill()
        data["medicine_name"] = None
        errors = validate_pill(data, strict=False)
        assert errors == []

    def test_author_treated_as_tier1(self):
        data = _full_pill()
        data["author"] = None
        errors = validate_pill(data, strict=True)
        assert any(e["field"] == "author" for e in errors)

    def test_author_required_in_strict_mode(self):
        data = _full_pill()
        data["author"] = ""
        errors = validate_pill(data, strict=True)
        assert any(e["field"] == "author" for e in errors)

    def test_all_tier1_present_no_errors_draft(self):
        data = _full_pill()
        # Clear some Tier 2/3 fields — should still pass in draft mode
        data["ndc9"] = ""
        data["brand_names"] = ""
        errors = validate_pill(data, strict=False)
        assert errors == []

    def test_multiple_tier1_missing_all_reported(self):
        data = _full_pill()
        data["medicine_name"] = None
        data["splimprint"] = None
        data["slug"] = ""
        errors = validate_pill(data, strict=True)
        fields = [e["field"] for e in errors]
        assert "medicine_name" in fields
        assert "splimprint" in fields
        assert "slug" in fields


# ---------------------------------------------------------------------------
# validate_pill — Tier 2
# ---------------------------------------------------------------------------

class TestValidatePillTier2:
    def test_empty_tier2_rejected_in_strict_mode(self):
        data = _full_pill()
        data["ndc11"] = ""
        errors = validate_pill(data, strict=True)
        assert any(e["field"] == "ndc11" for e in errors)

    def test_empty_tier2_allowed_in_draft_mode(self):
        data = _full_pill()
        data["ndc11"] = ""
        errors = validate_pill(data, strict=False)
        # Only Tier 1 is enforced in draft mode
        assert all(e["field"] != "ndc11" for e in errors)

    def test_na_value_accepted_for_tier2_in_strict_mode(self):
        data = _full_pill()
        data["ndc11"] = "N/A"
        errors = validate_pill(data, strict=True)
        assert all(e["field"] != "ndc11" for e in errors)

    def test_na_lowercase_accepted(self):
        data = _full_pill()
        data["dea_schedule_name"] = "n/a"
        errors = validate_pill(data, strict=True)
        assert all(e["field"] != "dea_schedule_name" for e in errors)

    def test_image_alt_text_required_when_has_image_true(self):
        data = _full_pill()
        data["has_image"] = "TRUE"
        data["image_alt_text"] = ""
        errors = validate_pill(data, strict=True)
        assert any(e["field"] == "image_alt_text" for e in errors)

    def test_image_alt_text_not_required_when_has_image_false(self):
        data = _full_pill()
        data["has_image"] = "FALSE"
        data["image_alt_text"] = ""
        errors = validate_pill(data, strict=True)
        assert all(e["field"] != "image_alt_text" for e in errors)

    def test_image_alt_text_not_required_when_has_image_missing(self):
        data = _full_pill()
        del data["has_image"]
        data["image_alt_text"] = ""
        errors = validate_pill(data, strict=True)
        assert all(e["field"] != "image_alt_text" for e in errors)


# ---------------------------------------------------------------------------
# validate_pill — All tiers satisfied
# ---------------------------------------------------------------------------

class TestValidatePillAllTiers:
    def test_fully_complete_pill_passes_strict(self):
        data = _full_pill()
        errors = validate_pill(data, strict=True)
        assert errors == []

    def test_fully_complete_pill_passes_draft(self):
        data = _full_pill()
        errors = validate_pill(data, strict=False)
        assert errors == []


# ---------------------------------------------------------------------------
# compute_completeness
# ---------------------------------------------------------------------------

class TestComputeCompleteness:
    def test_full_pill_scores_100(self):
        data = _full_pill()
        result = compute_completeness(data)
        assert result["score"] == 100
        assert result["missing_required"] == []
        assert result["needs_na_confirmation"] == []

    def test_missing_tier1_shows_in_missing_required(self):
        data = _full_pill()
        data["medicine_name"] = None
        result = compute_completeness(data)
        assert "medicine_name" in result["missing_required"]
        assert result["score"] < 100

    def test_empty_tier2_shows_in_needs_na(self):
        data = _full_pill()
        data["ndc11"] = ""
        result = compute_completeness(data)
        assert "ndc11" in result["needs_na_confirmation"]

    def test_na_tier2_not_in_needs_na(self):
        data = _full_pill()
        data["ndc11"] = "N/A"
        result = compute_completeness(data)
        assert "ndc11" not in result["needs_na_confirmation"]

    def test_image_alt_text_excluded_when_no_image(self):
        data = _full_pill()
        data["has_image"] = "FALSE"
        data["image_alt_text"] = ""
        result = compute_completeness(data)
        # Should not appear in needs_na since condition not met
        assert "image_alt_text" not in result["needs_na_confirmation"]

    def test_score_structure(self):
        data = _full_pill()
        result = compute_completeness(data)
        assert "score" in result
        assert "missing_required" in result
        assert "needs_na_confirmation" in result
        assert "optional_empty" in result
        assert isinstance(result["score"], int)
        assert 0 <= result["score"] <= 100


# ---------------------------------------------------------------------------
# GET /api/admin/pills/:id/completeness (integration-style)
# ---------------------------------------------------------------------------

FAKE_ADMIN_ROW = ("00000000-0000-0000-0000-000000000001", "admin@test.com", "superadmin", "Admin", True)
FAKE_USER_PAYLOAD = {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@test.com"}


def _make_mock_engine_for_completeness():
    """Return a mock engine that returns a full pill row for completeness endpoint."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    # Simulate the admin auth lookup (first call) and pill lookup (second call)
    admin_result = MagicMock()
    admin_result.fetchone.return_value = FAKE_ADMIN_ROW

    pill_row = MagicMock()
    pill_row._fields = [
        "id", "medicine_name", "author", "spl_strength", "splimprint",
        "splcolor_text", "splshape_text", "slug", "ndc9", "ndc11",
        "dosage_form", "route", "spl_ingredients", "spl_inactive_ing",
        "dea_schedule_name", "status_rx_otc", "image_alt_text", "has_image",
        "brand_names", "splsize", "meta_description", "pharmclass_fda_epc",
        "rxcui", "rxcui_1", "imprint_status", "tags",
    ]
    pill_values = [
        "some-id", "Ibuprofen", "Generic Pharma", "200mg", "IP 200",
        "white", "oval", "ibuprofen-200mg", "12345-678", "12345-678-90",
        "tablet", "oral", "Ibuprofen 200mg", "cellulose",
        "N/A", "OTC", "white oval pill", "TRUE",
        "Advil", "10", "Ibuprofen 200mg OTC", "Anti-inflammatory",
        "5640", "", "active", "pain",
    ]
    pill_row.__iter__ = MagicMock(return_value=iter(pill_values))

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        else:
            result.fetchone.return_value = pill_row
        return result

    mock_conn.execute.side_effect = side_effect
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine


@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = _make_mock_engine_for_completeness()
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


def test_completeness_endpoint_structure(client):
    """GET /api/admin/pills/:id/completeness returns expected structure."""
    mock_engine = _make_mock_engine_for_completeness()

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills/some-pill-id/completeness",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "score" in data
    assert "missing_required" in data
    assert "needs_na_confirmation" in data
    assert "optional_empty" in data


def test_completeness_requires_auth(client):
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        resp = client.get("/api/admin/pills/some-id/completeness")
    assert resp.status_code == 401
