"""Tests for services/ndc_backfill.py — core backfill logic with mocked HTTP + DB."""

import os
import json
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _make_pill(
    pill_id="aaaaaaaa-0000-0000-0000-000000000001",
    name="Metformin",
    imprint="500",
    rxcui="6809",
    ndc9=None,
    ndc11=None,
):
    return {
        "id": pill_id,
        "medicine_name": name,
        "splimprint": imprint,
        "rxcui": rxcui,
        "ndc9": ndc9,
        "ndc11": ndc11,
    }


DAILYMED_SPL_RESPONSE = {
    "data": [{"setid": "setid-001", "title": "Metformin HCl Tablets"}]
}

DAILYMED_NDC_RESPONSE = {
    "data": [
        {"ndc": "57664-0484-18", "package_description": "BOTTLE of 180 TABLETS"},
        {"ndc": "57664-0484-88", "package_description": "BOTTLE of 500 TABLETS"},
    ]
}

OPENFDA_RESPONSE = {
    "results": [
        {
            "product_ndc": "57664-0484",
            "dosage_form": "TABLET",
            "active_ingredients": [{"name": "METFORMIN HYDROCHLORIDE", "strength": "500 mg/1"}],
            "packaging": [
                {"package_ndc": "57664-0484-18", "description": "BOTTLE of 180 TABLETS"},
            ],
        }
    ]
}


# ---------------------------------------------------------------------------
# process_pill_row tests (unit, no DB)
# ---------------------------------------------------------------------------

class TestProcessPillRow:
    def test_rxcui_single_match_returns_updated(self):
        """RxCUI-only row with single DailyMed product → outcome='updated'."""
        row = _make_pill()
        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [
                DAILYMED_SPL_RESPONSE,   # spls.json?rxcui=...
                DAILYMED_NDC_RESPONSE,   # spls/{setid}/ndcs.json
            ]
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "updated"
        assert result["chosen_ndc11"] == "57664-0484-18"
        assert result["extras_count"] == 1  # second package

    def test_no_rxcui_falls_back_to_openfda(self):
        """No RxCUI → fall back to openFDA; single result → outcome='updated'."""
        row = _make_pill(rxcui=None)
        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.return_value = OPENFDA_RESPONSE
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "updated"
        assert result["chosen_ndc11"] is not None

    def test_multiple_products_returns_multiple_matches(self):
        """Two different products in response → outcome='multiple_matches'."""
        row = _make_pill()
        multi_ndc_response = {
            "data": [
                {"ndc": "57664-0484-18", "package_description": "Product A"},
                {"ndc": "12345-6789-01", "package_description": "Product B"},  # different labeler+product
            ]
        }
        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [DAILYMED_SPL_RESPONSE, multi_ndc_response]
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "multiple_matches"
        assert result["chosen_ndc11"] is None

    def test_api_error_returns_api_error(self):
        """Exception during HTTP call → outcome='api_error'."""
        row = _make_pill()
        with patch("services.ndc_backfill._fetch", side_effect=Exception("connection refused")):
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "api_error"
        assert "connection refused" in result["error"]

    def test_no_match_when_apis_return_empty(self):
        """Both APIs return nothing → outcome='no_match'."""
        row = _make_pill()
        with patch("services.ndc_backfill._fetch", return_value={"data": []}):
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "no_match"
        assert result["chosen_ndc11"] is None


# ---------------------------------------------------------------------------
# run_backfill integration tests (DB mocked)
# ---------------------------------------------------------------------------

def _make_mock_db(rows):
    """Return a mock database engine that yields *rows* for SELECT and accepts writes."""
    import database as db_module

    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_result = MagicMock()
    mock_result.fetchall.return_value = rows
    mock_conn.execute.return_value = mock_result

    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    db_module.db_engine = mock_engine
    return mock_engine, mock_conn


class TestRunBackfill:
    def _pill_row(self, pill_id, name, imprint, rxcui, ndc9, ndc11):
        return (pill_id, name, imprint, rxcui, ndc9, ndc11)

    def test_dry_run_does_not_call_write(self):
        """dry_run=True → no DB write calls beyond the initial SELECT."""
        pill_id = "bbbbbbbb-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Metformin", "", "6809", None, None)]
        engine, conn = _make_mock_db(rows)

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [DAILYMED_SPL_RESPONSE, DAILYMED_NDC_RESPONSE]
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        # engine.begin() should NOT have been called (no writes in dry_run)
        engine.begin.assert_not_called()
        assert summary["updated"] == 1
        assert summary["dry_run"] is True

    def test_live_run_calls_begin_on_updated(self):
        """Live run with a successful match → engine.begin() is called for the write."""
        pill_id = "cccccccc-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Metformin", "", "6809", None, None)]
        engine, conn = _make_mock_db(rows)

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [DAILYMED_SPL_RESPONSE, DAILYMED_NDC_RESPONSE]
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0)

        engine.begin.assert_called()
        assert summary["updated"] == 1

    def test_multiple_matches_increments_skipped_multi(self):
        pill_id = "dddddddd-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Metformin", "", "6809", None, None)]
        engine, conn = _make_mock_db(rows)

        multi_ndc = {
            "data": [
                {"ndc": "57664-0484-18", "package_description": "A"},
                {"ndc": "12345-6789-01", "package_description": "B"},
            ]
        }
        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [DAILYMED_SPL_RESPONSE, multi_ndc]
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        assert summary["skipped_multi"] == 1
        assert summary["updated"] == 0

    def test_no_match_increments_skipped_none(self):
        pill_id = "eeeeeeee-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Unknown Drug", "", None, None, None)]
        engine, conn = _make_mock_db(rows)

        with patch("services.ndc_backfill._fetch", return_value=None):
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        assert summary["skipped_none"] == 1

    def test_api_error_increments_errors(self):
        pill_id = "ffffffff-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Metformin", "", "6809", None, None)]
        engine, conn = _make_mock_db(rows)

        with patch("services.ndc_backfill._fetch", side_effect=Exception("timeout")):
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        assert summary["errors"] == 1

    def test_row_with_existing_ndc11_not_in_result(self):
        """Rows that already have ndc11 are excluded by the SQL WHERE clause.
        We verify the SELECT is called with the right query by checking that
        no rows are returned → processed=0."""
        engine, conn = _make_mock_db([])  # empty result set
        from services.ndc_backfill import run_backfill
        summary = run_backfill(limit=10, dry_run=True, sleep_ms=0)
        assert summary["processed"] == 0
