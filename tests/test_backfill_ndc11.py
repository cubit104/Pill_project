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

DAILYMED_PACKAGING_RESPONSE = {
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
                DAILYMED_SPL_RESPONSE,       # spls.json?rxcui=...
                DAILYMED_PACKAGING_RESPONSE, # spls/{setid}/packaging.json
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

    def test_multiple_products_picks_best_candidate(self):
        """Two different products in response → outcome='updated', best candidate chosen."""
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

        assert result["outcome"] == "updated"
        assert result["chosen_ndc11"] is not None
        assert result["multi_product_count"] == 2
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

    def test_dailymed_nonnormalizing_falls_back_to_openfda(self):
        """DailyMed returns candidates that don't normalize; openFDA rescues."""
        row = _make_pill(name="Aspirin")
        with (
            patch("services.ndc_backfill.fetch_dailymed_by_rxcui", return_value=[
                {"ndc": "0781-1506", "package_description": "product level only", "source": "dailymed", "setid": "setid-asp-001"},
            ]) as mock_dm,
            patch("services.ndc_backfill.fetch_openfda_by_name", return_value=[
                {"ndc": "21130-957-12", "package_description": "100 TABLET in 1 BOTTLE", "source": "openfda"},
            ]) as mock_of,
        ):
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "updated"
        assert result["chosen_ndc11"] == "21130-0957-12"
        sc = result["source_counts"]
        assert sc["dailymed_raw"] == 1
        assert sc["dailymed_normalized"] == 0
        assert sc["openfda_raw"] == 1
        assert sc["openfda_normalized"] == 1
        mock_of.assert_called_once()

    def test_dailymed_valid_candidates_openfda_not_called(self):
        """DailyMed returns a valid normalized candidate → openFDA is NOT called."""
        row = _make_pill(name="Metformin")
        with (
            patch("services.ndc_backfill.fetch_dailymed_by_rxcui", return_value=[
                {"ndc": "57664-0484-18", "package_description": "BOTTLE of 180 TABLETS", "source": "dailymed", "setid": "setid-met-001"},
            ]) as mock_dm,
            patch("services.ndc_backfill.fetch_openfda_by_name", side_effect=AssertionError("openFDA must not be called")) as mock_of,
        ):
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "updated"
        assert result["chosen_ndc11"] is not None
        sc = result["source_counts"]
        assert sc["dailymed_normalized"] == 1
        assert sc["openfda_raw"] == 0
        assert sc["openfda_normalized"] == 0
        mock_of.assert_not_called()

    def test_both_sources_empty_all_counts_zero(self):
        """Both DailyMed and openFDA return empty → no_match, all source_counts=0."""
        row = _make_pill(name="UnknownDrug")
        with (
            patch("services.ndc_backfill.fetch_dailymed_by_rxcui", return_value=[]) as mock_dm,
            patch("services.ndc_backfill.fetch_openfda_by_name", return_value=[]) as mock_of,
        ):
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "no_match"
        assert result["chosen_ndc11"] is None
        sc = result["source_counts"]
        assert sc["dailymed_raw"] == 0
        assert sc["dailymed_normalized"] == 0
        assert sc["openfda_raw"] == 0
        assert sc["openfda_normalized"] == 0


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
            mock_fetch.side_effect = [DAILYMED_SPL_RESPONSE, DAILYMED_PACKAGING_RESPONSE]
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
            mock_fetch.side_effect = [DAILYMED_SPL_RESPONSE, DAILYMED_PACKAGING_RESPONSE]
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0)

        engine.begin.assert_called()
        assert summary["updated"] == 1

    def test_multiple_products_now_picks_one(self):
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

        assert summary["skipped_multi"] == 0
        assert summary["updated"] == 1

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

    def test_api_error_row_includes_error_field(self):
        """api_error outcome → row in summary includes 'error' field."""
        pill_id = "11111111-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Metformin", "", "6809", None, None)]
        _make_mock_db(rows)

        with patch("services.ndc_backfill._fetch", side_effect=Exception("timeout")):
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        assert summary["errors"] == 1
        row = summary["rows"][0]
        assert row["outcome"] == "api_error"
        assert "error" in row
        assert "timeout" in row["error"]

    def test_api_error_error_field_truncated_to_500(self):
        """api_error error message is truncated to 500 chars."""
        pill_id = "22222222-0000-0000-0000-000000000001"
        rows = [self._pill_row(pill_id, "Metformin", "", "6809", None, None)]
        _make_mock_db(rows)

        long_error = "x" * 600
        with patch("services.ndc_backfill._fetch", side_effect=Exception(long_error)):
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        row = summary["rows"][0]
        assert "error" in row
        assert len(row["error"]) <= 500


# ---------------------------------------------------------------------------
# fetch_dailymed_by_rxcui — packaging.json endpoint tests
# ---------------------------------------------------------------------------

class TestFetchDailymedByRxcui:
    def test_packaging_dict_ndc_key(self):
        """Packaging returns list of dicts with 'ndc' key → candidates returned."""
        spl_response = {"data": [{"setid": "setid-pkg-001", "title": "Drug A"}]}
        pkg_response = {
            "data": [
                {"ndc": "57664-0484-18", "package_description": "BOTTLE of 180 TABLETS"},
                {"ndc": "57664-0484-88", "package_description": "BOTTLE of 500 TABLETS"},
            ]
        }

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [spl_response, pkg_response]
            from services.ndc_backfill import fetch_dailymed_by_rxcui, DAILYMED_PACKAGING_URL
            candidates = fetch_dailymed_by_rxcui("12345")

        assert len(candidates) == 2
        assert candidates[0]["ndc"] == "57664-0484-18"
        assert candidates[0]["package_description"] == "BOTTLE of 180 TABLETS"
        assert candidates[0]["source"] == "dailymed"
        assert candidates[0]["setid"] == "setid-pkg-001"
        # Verify the second call used the packaging URL
        second_call_url = mock_fetch.call_args_list[1][0][0]
        assert second_call_url == DAILYMED_PACKAGING_URL.format(setid="setid-pkg-001")

    def test_packaging_dict_package_ndc_key(self):
        """Packaging returns dicts with 'package_ndc' instead of 'ndc' → still handled."""
        spl_response = {"data": [{"setid": "setid-pkg-002", "title": "Drug B"}]}
        pkg_response = {
            "data": [
                {"package_ndc": "00093-0150-01", "package_description": "30 TABLET in 1 BOTTLE"},
            ]
        }

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [spl_response, pkg_response]
            from services.ndc_backfill import fetch_dailymed_by_rxcui
            candidates = fetch_dailymed_by_rxcui("99999")

        assert len(candidates) == 1
        assert candidates[0]["ndc"] == "00093-0150-01"
        assert candidates[0]["package_description"] == "30 TABLET in 1 BOTTLE"

    def test_packaging_empty_list_returns_empty(self):
        """Packaging endpoint returns empty data list → fetch returns []."""
        spl_response = {"data": [{"setid": "setid-pkg-003"}]}
        pkg_response = {"data": []}

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [spl_response, pkg_response]
            from services.ndc_backfill import fetch_dailymed_by_rxcui
            candidates = fetch_dailymed_by_rxcui("11111")

        assert candidates == []

    def test_string_entries_returns_candidates(self):
        """Packaging returning plain strings (defensive) → 2 candidates, no exception."""
        spl_response = {"data": [{"setid": "setid-str-001", "title": "Drug A"}]}
        pkg_response = {"data": ["0093-0150-01", "0093-0150-02"]}

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [spl_response, pkg_response]
            from services.ndc_backfill import fetch_dailymed_by_rxcui
            candidates = fetch_dailymed_by_rxcui("12345")

        assert len(candidates) == 2
        for c in candidates:
            assert c["ndc"] in ("0093-0150-01", "0093-0150-02")
            assert c["package_description"] == ""
            assert c["source"] == "dailymed"
            assert c["setid"] == "setid-str-001"

    def test_mixed_string_and_dict_entries(self):
        """Packaging returning mixed strings and dicts → all handled."""
        spl_response = {"data": [{"setid": "setid-mix-001", "title": "Drug B"}]}
        pkg_response = {
            "data": [
                "0093-0150-01",
                {"ndc": "0093-0150-02", "package_description": "BOTTLE of 60"},
            ]
        }

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [spl_response, pkg_response]
            from services.ndc_backfill import fetch_dailymed_by_rxcui
            candidates = fetch_dailymed_by_rxcui("12345")

        assert len(candidates) == 2
        ndcs = {c["ndc"] for c in candidates}
        assert "0093-0150-01" in ndcs
        assert "0093-0150-02" in ndcs

        str_candidate = next(c for c in candidates if c["ndc"] == "0093-0150-01")
        assert str_candidate["package_description"] == ""

        dict_candidate = next(c for c in candidates if c["ndc"] == "0093-0150-02")
        assert dict_candidate["package_description"] == "BOTTLE of 60"

        for c in candidates:
            assert c["source"] == "dailymed"
            assert c["setid"] == "setid-mix-001"

    def test_string_entries_no_exception(self):
        """Ensure no AttributeError is raised when entries are plain strings."""
        spl_response = {"data": [{"setid": "setid-noerr-001"}]}
        pkg_response = {"data": ["0093-0150-01", "0093-0150-02"]}

        with patch("services.ndc_backfill._fetch") as mock_fetch:
            mock_fetch.side_effect = [spl_response, pkg_response]
            from services.ndc_backfill import fetch_dailymed_by_rxcui
            # Should not raise
            candidates = fetch_dailymed_by_rxcui("99999")

        assert isinstance(candidates, list)
        assert len(candidates) == 2


# ---------------------------------------------------------------------------
# _decide / scoring / filtering tests (Tests A-E)
# ---------------------------------------------------------------------------

class TestDecideFunction:
    """Unit tests for the _decide, _is_dispensable, and _score_candidate helpers."""

    def _make_candidate(
        self,
        ndc11: str,
        source: str = "openfda",
        package_description: str = "100 TABLET in 1 BOTTLE",
        marketing_category: str = "NDA",
        finished: bool = True,
    ) -> dict:
        from ndc_normalize import ndc11_to_ndc9
        return {
            "ndc": ndc11,
            "ndc11": ndc11,
            "ndc9": ndc11_to_ndc9(ndc11),
            "package_description": package_description,
            "source": source,
            "marketing_category": marketing_category,
            "finished": finished,
        }

    def test_a_bulk_ingredient_filtered(self):
        """Test A: bulk-ingredient candidate is excluded; normal candidate is chosen."""
        from services.ndc_backfill import _decide

        bulk = self._make_candidate(
            "10357-0209-02",
            marketing_category="BULK INGREDIENT",
            package_description="115 kg in 1 DRUM",
        )
        normal = self._make_candidate(
            "57664-0484-18",
            marketing_category="NDA",
            package_description="100 TABLET in 1 BOTTLE",
        )
        outcome, primary, extras, mpc = _decide([bulk, normal])

        assert outcome == "updated"
        assert primary["ndc11"] == "57664-0484-18"
        # The bulk candidate must not appear as primary
        assert primary.get("marketing_category") != "BULK INGREDIENT"

    def test_b_multi_product_picks_one(self):
        """Test B: 3 candidates across 3 labelers, all dispensable → outcome='updated'."""
        from services.ndc_backfill import _decide

        c1 = self._make_candidate("00093-0150-01", package_description="30 TABLET in 1 BOTTLE")
        c2 = self._make_candidate("57664-0484-18", package_description="100 TABLET in 1 BOTTLE")
        c3 = self._make_candidate("12345-6789-01", package_description="60 TABLET in 1 BOTTLE")

        outcome, primary, extras, mpc = _decide([c1, c2, c3])

        assert outcome == "updated"
        assert primary is not None
        assert primary["ndc11"] in {"00093-0150-01", "57664-0484-18", "12345-6789-01"}
        assert mpc == 3

    def test_c_all_bulk_returns_no_match(self):
        """Test C: only bulk-ingredient candidates → outcome='no_match'."""
        from services.ndc_backfill import _decide

        bulk1 = self._make_candidate("10357-0209-02", marketing_category="BULK INGREDIENT")
        bulk2 = self._make_candidate("99999-0001-01", marketing_category="BULK INGREDIENT")

        outcome, primary, extras, mpc = _decide([bulk1, bulk2])

        assert outcome == "no_match"
        assert primary is None

    def test_d_deterministic_tiebreaker(self):
        """Test D: same candidate list in different order → same primary chosen."""
        import random
        from services.ndc_backfill import _decide

        candidates = [
            self._make_candidate("00093-0150-01", package_description="30 TABLET in 1 BOTTLE"),
            self._make_candidate("57664-0484-18", package_description="100 TABLET in 1 BOTTLE"),
            self._make_candidate("12345-6789-01", package_description="60 TABLET in 1 BOTTLE"),
            self._make_candidate("00456-0123-05", package_description=""),
        ]

        _, primary_original, _, _ = _decide(list(candidates))

        for _ in range(5):
            shuffled = list(candidates)
            random.shuffle(shuffled)
            _, primary_shuffled, _, _ = _decide(shuffled)
            assert primary_shuffled["ndc11"] == primary_original["ndc11"]

    def test_e_single_product_unchanged(self):
        """Test E: single product with multiple packages → existing behaviour preserved."""
        from services.ndc_backfill import _decide

        c1 = self._make_candidate("57664-0484-18", package_description="BOTTLE of 180 TABLETS")
        c2 = self._make_candidate("57664-0484-88", package_description="BOTTLE of 500 TABLETS")

        outcome, primary, extras, mpc = _decide([c1, c2])

        assert outcome == "updated"
        assert primary is not None
        assert mpc == 1  # same labeler+product → 1 product key
        assert len(extras) == 1

    def test_empty_candidates_returns_no_match(self):
        """Empty candidate list → no_match."""
        from services.ndc_backfill import _decide

        outcome, primary, extras, mpc = _decide([])

        assert outcome == "no_match"
        assert primary is None
        assert mpc == 0

    def test_is_dispensable_bulk_rejected(self):
        """_is_dispensable rejects BULK INGREDIENT entries."""
        from services.ndc_backfill import _is_dispensable

        bulk = {"source": "openfda", "marketing_category": "BULK INGREDIENT"}
        assert _is_dispensable(bulk) is False

    def test_is_dispensable_normal_accepted(self):
        """_is_dispensable accepts normal openfda and dailymed entries."""
        from services.ndc_backfill import _is_dispensable

        assert _is_dispensable({"source": "openfda", "marketing_category": "NDA"}) is True
        assert _is_dispensable({"source": "dailymed", "marketing_category": ""}) is True
        assert _is_dispensable({"source": "openfda", "marketing_category": ""}) is True

    def test_openfda_marketing_category_captured(self):
        """fetch_openfda_by_name includes marketing_category and finished in candidates."""
        openfda_response = {
            "results": [
                {
                    "product_ndc": "57664-0484",
                    "dosage_form": "TABLET",
                    "marketing_category": "ANDA",
                    "finished": True,
                    "active_ingredients": [{"name": "METFORMIN", "strength": "500 mg/1"}],
                    "packaging": [
                        {"package_ndc": "57664-0484-18", "description": "BOTTLE of 180 TABLETS"},
                    ],
                }
            ]
        }

        with patch("services.ndc_backfill._fetch", return_value=openfda_response):
            from services.ndc_backfill import fetch_openfda_by_name
            candidates = fetch_openfda_by_name("Metformin")

        assert len(candidates) == 1
        assert candidates[0]["marketing_category"] == "ANDA"
        assert candidates[0]["finished"] is True

    def test_multi_product_count_in_process_pill_row(self):
        """process_pill_row exposes multi_product_count when multiple products found."""
        row = _make_pill(rxcui=None, name="Naproxen")

        openfda_multi = {
            "results": [
                {
                    "product_ndc": "57664-0484",
                    "dosage_form": "TABLET",
                    "marketing_category": "ANDA",
                    "finished": True,
                    "active_ingredients": [],
                    "packaging": [
                        {"package_ndc": "57664-0484-18", "description": "BOTTLE of 180 TABLETS"},
                    ],
                },
                {
                    "product_ndc": "12345-6789",
                    "dosage_form": "TABLET",
                    "marketing_category": "ANDA",
                    "finished": True,
                    "active_ingredients": [],
                    "packaging": [
                        {"package_ndc": "12345-6789-01", "description": "BOTTLE of 60 TABLETS"},
                    ],
                },
            ]
        }

        with patch("services.ndc_backfill._fetch", return_value=openfda_multi):
            from services.ndc_backfill import process_pill_row
            result = process_pill_row(row, sleep_ms=0)

        assert result["outcome"] == "updated"
        assert result["chosen_ndc11"] is not None
        assert result["multi_product_count"] == 2

    def test_row_summary_includes_multi_product_count(self):
        """run_backfill row_summary includes multi_product_count field."""
        pill_id = "abababab-0000-0000-0000-000000000001"
        rows = [(pill_id, "Naproxen", "", None, None, None)]
        _make_mock_db(rows)

        openfda_multi = {
            "results": [
                {
                    "product_ndc": "57664-0484",
                    "dosage_form": "TABLET",
                    "marketing_category": "ANDA",
                    "finished": True,
                    "active_ingredients": [],
                    "packaging": [{"package_ndc": "57664-0484-18", "description": "BOTTLE of 180"}],
                },
                {
                    "product_ndc": "12345-6789",
                    "dosage_form": "TABLET",
                    "marketing_category": "ANDA",
                    "finished": True,
                    "active_ingredients": [],
                    "packaging": [{"package_ndc": "12345-6789-01", "description": "BOTTLE of 60"}],
                },
            ]
        }

        with patch("services.ndc_backfill._fetch", return_value=openfda_multi):
            from services.ndc_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        assert summary["updated"] == 1
        row = summary["rows"][0]
        assert "multi_product_count" in row
        assert row["multi_product_count"] == 2
