"""Tests for services/clinical_metadata_backfill.py."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

# ---------------------------------------------------------------------------
# Sample openFDA label payload (representative of real API responses)
# ---------------------------------------------------------------------------

OPENFDA_LABEL = {
    "openfda": {
        "dosage_form": ["TABLET"],
        "route": ["ORAL"],
        "product_type": ["HUMAN PRESCRIPTION DRUG"],
        "dea_schedule": ["CII"],
        "pharm_class_epc": ["Opioid Agonist [EPC]"],
        "brand_name": ["OXYCONTIN"],
        "substance_name": ["OXYCODONE HYDROCHLORIDE"],
        "rxcui": ["1049502"],
        "package_ndc": ["59011-0402-10"],
    },
    "inactive_ingredient": [
        "Inactive ingredients: butylated hydroxytoluene, hypromellose, magnesium stearate"
    ],
}

OPENFDA_OTC_LABEL = {
    "openfda": {
        "dosage_form": ["TABLET"],
        "route": ["ORAL"],
        "product_type": ["HUMAN OTC DRUG"],
        "brand_name": ["TYLENOL"],
        "substance_name": ["ACETAMINOPHEN"],
    },
    "inactive_ingredient": ["microcrystalline cellulose, corn starch"],
}

OPENFDA_UNKNOWN_TYPE_LABEL = {
    "openfda": {
        "product_type": ["VETERINARY DRUG"],
    },
}

# ---------------------------------------------------------------------------
# Helpers / stubs
# ---------------------------------------------------------------------------


def _make_pill(
    pill_id: str = "aaaaaaaa-0000-0000-0000-000000000001",
    name: str = "Oxycontin",
    rxcui: str = "1049502",
    ndc11: str = "59011-0402-10",
    spl_set_id: str | None = None,
    **clinical_fields,
) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "id": pill_id,
        "medicine_name": name,
        "rxcui": rxcui,
        "ndc11": ndc11,
        "spl_set_id": spl_set_id,
        "dosage_form": None,
        "route": None,
        "rx_otc_status": None,
        "dea_schedule": None,
        "fda_pharma_class": None,
        "brand_names": None,
        "active_ingredients": None,
        "inactive_ingredients": None,
    }
    row.update(clinical_fields)
    return row


# All target columns — used as default active_columns in unit tests
from services.clinical_metadata_backfill import TARGET_COLUMNS


# ---------------------------------------------------------------------------
# Unit tests: individual mapper functions
# ---------------------------------------------------------------------------


class TestMappers:
    def test_map_dosage_form_title_case(self):
        from services.clinical_metadata_backfill import map_dosage_form
        assert map_dosage_form(OPENFDA_LABEL) == "Tablet"

    def test_map_route_title_case(self):
        from services.clinical_metadata_backfill import map_route
        assert map_route(OPENFDA_LABEL) == "Oral"

    def test_map_rx_otc_status_prescription(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        assert map_rx_otc_status(OPENFDA_LABEL) == "Rx"

    def test_map_rx_otc_status_otc(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        assert map_rx_otc_status(OPENFDA_OTC_LABEL) == "OTC"

    def test_map_rx_otc_status_unknown(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        assert map_rx_otc_status(OPENFDA_UNKNOWN_TYPE_LABEL) is None

    def test_map_rx_otc_status_missing(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        assert map_rx_otc_status({}) is None

    def test_map_dea_schedule(self):
        from services.clinical_metadata_backfill import map_dea_schedule
        assert map_dea_schedule(OPENFDA_LABEL) == "CII"

    def test_map_fda_pharma_class(self):
        from services.clinical_metadata_backfill import map_fda_pharma_class
        assert map_fda_pharma_class(OPENFDA_LABEL) == "Opioid Agonist [EPC]"

    def test_map_brand_names_title_case(self):
        from services.clinical_metadata_backfill import map_brand_names
        assert map_brand_names(OPENFDA_LABEL) == "Oxycontin"

    def test_map_active_ingredients_from_openfda(self):
        from services.clinical_metadata_backfill import map_active_ingredients
        result = map_active_ingredients(OPENFDA_LABEL, spl_root=None)
        assert result == "OXYCODONE HYDROCHLORIDE"

    def test_map_active_ingredients_multiple_substances(self):
        from services.clinical_metadata_backfill import map_active_ingredients
        label = {"openfda": {"substance_name": ["METFORMIN", "SITAGLIPTIN"]}}
        result = map_active_ingredients(label)
        assert result == "METFORMIN, SITAGLIPTIN"

    def test_inactive_ingredients_strips_prefix(self):
        from services.clinical_metadata_backfill import map_inactive_ingredients
        label = {
            "inactive_ingredient": [
                "Inactive ingredients: lactose, magnesium stearate"
            ]
        }
        result = map_inactive_ingredients(label)
        assert result == "lactose, magnesium stearate"

    def test_inactive_ingredients_strips_singular_prefix(self):
        from services.clinical_metadata_backfill import map_inactive_ingredients
        label = {
            "inactive_ingredient": [
                "Inactive Ingredient: corn starch"
            ]
        }
        result = map_inactive_ingredients(label)
        assert result == "corn starch"

    def test_inactive_ingredients_no_prefix(self):
        from services.clinical_metadata_backfill import map_inactive_ingredients
        label = {"inactive_ingredient": ["microcrystalline cellulose, corn starch"]}
        result = map_inactive_ingredients(label)
        assert result == "microcrystalline cellulose, corn starch"

    def test_inactive_ingredients_collapses_whitespace(self):
        from services.clinical_metadata_backfill import map_inactive_ingredients
        label = {"inactive_ingredient": ["Inactive ingredients:  lactose   monohydrate "]}
        result = map_inactive_ingredients(label)
        assert result == "lactose monohydrate"

    def test_inactive_ingredients_missing(self):
        from services.clinical_metadata_backfill import map_inactive_ingredients
        assert map_inactive_ingredients({}) is None
        assert map_inactive_ingredients({"inactive_ingredient": []}) is None


class TestRxOtcMapping:
    """Dedicated tests for the Rx/OTC status mapping per spec."""

    def test_human_prescription_drug_maps_to_rx(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        label = {"openfda": {"product_type": ["HUMAN PRESCRIPTION DRUG"]}}
        assert map_rx_otc_status(label) == "Rx"

    def test_human_otc_drug_maps_to_otc(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        label = {"openfda": {"product_type": ["HUMAN OTC DRUG"]}}
        assert map_rx_otc_status(label) == "OTC"

    def test_unknown_product_type_maps_to_none(self):
        from services.clinical_metadata_backfill import map_rx_otc_status
        label = {"openfda": {"product_type": ["PLASMA DERIVATIVE"]}}
        assert map_rx_otc_status(label) is None


# ---------------------------------------------------------------------------
# Unit tests: process_pill_row
# ---------------------------------------------------------------------------


class TestProcessPillRow:
    def test_fills_null_fields_when_openfda_returns_data(self):
        """All NULL fields are populated when openFDA returns full label."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill()
        with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui") as mock_label:
            mock_label.return_value = OPENFDA_LABEL
            result = process_pill_row(
                row, active_columns=TARGET_COLUMNS, sleep_ms=0
            )

        assert result["outcome"] == "updated"
        updates = result["updates"]
        assert "dosage_form" in updates
        assert updates["dosage_form"]["new"] == "Tablet"
        assert updates["route"]["new"] == "Oral"
        assert updates["rx_otc_status"]["new"] == "Rx"
        assert updates["dea_schedule"]["new"] == "CII"

    def test_does_not_overwrite_existing_values(self):
        """Non-NULL field is excluded from updates."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill(dosage_form="CustomTablet")
        with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui") as mock_label:
            mock_label.return_value = OPENFDA_LABEL
            result = process_pill_row(
                row, active_columns=TARGET_COLUMNS, sleep_ms=0
            )

        assert result["outcome"] == "updated"
        assert "dosage_form" not in result["updates"], "Should not overwrite existing dosage_form"
        assert "route" in result["updates"]

    def test_outcome_no_match_when_openfda_returns_nothing(self):
        """No openFDA label → outcome='no_match'."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill()
        with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui") as mock_rx:
            mock_rx.return_value = None
            with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_ndc") as mock_ndc:
                mock_ndc.return_value = None
                result = process_pill_row(
                    row, active_columns=TARGET_COLUMNS, sleep_ms=0
                )

        assert result["outcome"] == "no_match"
        assert result["updates"] == {}

    def test_api_error_is_caught(self):
        """Exception during API call → outcome='api_error', no raise."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill()
        with patch(
            "services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui",
            side_effect=Exception("connection refused"),
        ):
            result = process_pill_row(row, active_columns=TARGET_COLUMNS, sleep_ms=0)

        assert result["outcome"] == "api_error"
        assert "connection refused" in result["error"]

    def test_outcome_already_populated_when_all_fields_filled(self):
        """All fields already populated → outcome='already_populated'."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill(
            dosage_form="Tablet",
            route="Oral",
            rx_otc_status="Rx",
            dea_schedule="CII",
            fda_pharma_class="Opioid Agonist [EPC]",
            brand_names="Oxycontin",
            active_ingredients="OXYCODONE HYDROCHLORIDE",
            inactive_ingredients="butylated hydroxytoluene",
        )
        with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui") as mock_label:
            mock_label.return_value = OPENFDA_LABEL
            result = process_pill_row(
                row, active_columns=TARGET_COLUMNS, sleep_ms=0
            )

        assert result["outcome"] == "already_populated"
        assert result["updates"] == {}

    def test_only_fields_filter(self):
        """only_fields=['route'] — only route column is updated."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill()
        with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui") as mock_label:
            mock_label.return_value = OPENFDA_LABEL
            result = process_pill_row(
                row, active_columns=["route"], sleep_ms=0
            )

        assert result["outcome"] == "updated"
        assert list(result["updates"].keys()) == ["route"]

    def test_ndc_fallback_when_no_rxcui(self):
        """match_mode=auto, no rxcui → falls back to NDC lookup."""
        from services.clinical_metadata_backfill import process_pill_row

        row = _make_pill(rxcui=None)
        with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui") as mock_rx:
            mock_rx.return_value = None
            with patch("services.clinical_metadata_backfill.fetch_openfda_label_by_ndc") as mock_ndc:
                mock_ndc.return_value = OPENFDA_OTC_LABEL
                result = process_pill_row(
                    row, active_columns=TARGET_COLUMNS, sleep_ms=0, match_mode="auto"
                )

        # RxCUI path not called when rxcui is None
        mock_rx.assert_not_called()
        assert result["outcome"] == "updated"
        assert result["match_source"] == "openfda_ndc"


# ---------------------------------------------------------------------------
# Integration-style tests: run_backfill (mocked DB + HTTP)
# ---------------------------------------------------------------------------


def _make_mock_engine(rows: List[Dict], existing_cols: Optional[List[str]] = None):
    """Build a MagicMock sqlalchemy engine whose connect()/begin() return
    fake connection objects yielding *rows* on execute().fetchall()."""
    if existing_cols is None:
        existing_cols = TARGET_COLUMNS + ["id", "medicine_name", "rxcui", "ndc11", "spl_set_id"]

    col_names = list(rows[0].keys()) if rows else []
    row_tuples = [tuple(r[c] for c in col_names) for r in rows]

    def _execute(sql, params=None):
        sql_str = str(sql)
        result = MagicMock()
        if "information_schema" in sql_str:
            result.fetchall.return_value = [(c,) for c in existing_cols]
        else:
            result.fetchall.return_value = row_tuples
        return result

    mock_conn = MagicMock()
    mock_conn.execute.side_effect = _execute

    # Support both connect() (read) and begin() (write) context managers
    class _ConnCtx:
        def __enter__(self):
            return mock_conn

        def __exit__(self, *a):
            return False

    mock_engine = MagicMock()
    mock_engine.connect.return_value = _ConnCtx()
    mock_engine.begin.return_value = _ConnCtx()
    return mock_engine, mock_conn


class TestRunBackfill:
    """Integration tests using a mocked DB engine and HTTP client."""

    def test_dry_run_does_not_write(self):
        """dry_run=True: no DB writes; audit log table not written."""
        row = _make_pill()
        mock_engine, mock_conn = _make_mock_engine([row])

        with (
            patch("database.db_engine", mock_engine),
            patch("database.connect_to_database", return_value=True),
            patch(
                "services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui",
                return_value=OPENFDA_LABEL,
            ),
            patch(
                "services.clinical_metadata_backfill._resolve_setid_for_rxcui",
                return_value=None,
            ),
        ):
            from services.clinical_metadata_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=True, sleep_ms=0)

        assert summary["dry_run"] is True
        assert summary["updated"] == 1
        # No UPDATE statement should have been executed
        executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list]
        assert not any("UPDATE pillfinder SET" in s for s in executed_sqls), (
            "dry_run should not write to pillfinder"
        )
        assert not any("INSERT INTO clinical_metadata_backfill_log" in s for s in executed_sqls), (
            "dry_run should not write audit log"
        )

    def test_live_run_fills_null_fields(self):
        """Live run with all NULL fields → all target fields populated."""
        row = _make_pill()
        mock_engine, mock_conn = _make_mock_engine([row])

        with (
            patch("database.db_engine", mock_engine),
            patch("database.connect_to_database", return_value=True),
            patch(
                "services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui",
                return_value=OPENFDA_LABEL,
            ),
            patch(
                "services.clinical_metadata_backfill._resolve_setid_for_rxcui",
                return_value=None,
            ),
        ):
            from services.clinical_metadata_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0)

        assert summary["updated"] == 1
        assert summary["errors"] == 0

        # Verify UPDATE was written
        executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list]
        assert any("UPDATE pillfinder SET" in s for s in executed_sqls)

    def test_does_not_overwrite_existing_values(self):
        """Existing dosage_form='CustomTablet' must survive a live run."""
        row = _make_pill(dosage_form="CustomTablet")
        mock_engine, mock_conn = _make_mock_engine([row])

        with (
            patch("database.db_engine", mock_engine),
            patch("database.connect_to_database", return_value=True),
            patch(
                "services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui",
                return_value=OPENFDA_LABEL,
            ),
            patch(
                "services.clinical_metadata_backfill._resolve_setid_for_rxcui",
                return_value=None,
            ),
        ):
            from services.clinical_metadata_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0)

        assert summary["updated"] == 1
        # Check UPDATE SQL does NOT contain dosage_form
        update_calls = [
            str(call.args[0])
            for call in mock_conn.execute.call_args_list
            if "UPDATE pillfinder SET" in str(call.args[0])
        ]
        assert update_calls, "Expected at least one UPDATE call"
        for sql in update_calls:
            assert "dosage_form" not in sql, (
                "dosage_form should NOT be included in the UPDATE (it already has a value)"
            )

    def test_skips_when_openfda_returns_nothing(self):
        """openFDA returns 404/None → outcome=no_match, no DB writes."""
        row = _make_pill()
        mock_engine, mock_conn = _make_mock_engine([row])

        with (
            patch("database.db_engine", mock_engine),
            patch("database.connect_to_database", return_value=True),
            patch(
                "services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui",
                return_value=None,
            ),
            patch(
                "services.clinical_metadata_backfill.fetch_openfda_label_by_ndc",
                return_value=None,
            ),
        ):
            from services.clinical_metadata_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0)

        assert summary["skipped_no_match"] == 1
        assert summary["updated"] == 0

        executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list]
        assert not any("UPDATE pillfinder SET" in s for s in executed_sqls)

    def test_only_fields_filter(self):
        """only_fields=['route'] — only route is written even if openFDA supplies others."""
        row = _make_pill()
        mock_engine, mock_conn = _make_mock_engine(
            [row],
            existing_cols=TARGET_COLUMNS + ["id", "medicine_name", "rxcui", "ndc11", "spl_set_id"],
        )

        # Track UPDATE parameters
        update_params: list = []
        orig_side = mock_conn.execute.side_effect

        def _tracking_execute(sql, params=None):
            sql_str = str(sql)
            if "UPDATE pillfinder SET" in sql_str and params:
                update_params.append(dict(params))
            return orig_side(sql, params)

        mock_conn.execute.side_effect = _tracking_execute

        with (
            patch("database.db_engine", mock_engine),
            patch("database.connect_to_database", return_value=True),
            patch(
                "services.clinical_metadata_backfill.fetch_openfda_label_by_rxcui",
                return_value=OPENFDA_LABEL,
            ),
            patch(
                "services.clinical_metadata_backfill._resolve_setid_for_rxcui",
                return_value=None,
            ),
        ):
            from services.clinical_metadata_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0, only_fields=["route"])

        assert summary["updated"] == 1
        assert update_params, "Expected an UPDATE call"
        for params in update_params:
            assert "route" in params
            for col in TARGET_COLUMNS:
                if col != "route":
                    assert col not in params, f"{col} should not be in UPDATE params"

    def test_already_populated_rows_are_skipped(self):
        """Row where all target fields are non-NULL → skipped_already_populated."""
        row = _make_pill(
            dosage_form="Tablet",
            route="Oral",
            rx_otc_status="Rx",
            dea_schedule="CII",
            fda_pharma_class="Opioid Agonist [EPC]",
            brand_names="Oxycontin",
            active_ingredients="OXYCODONE HYDROCHLORIDE",
            inactive_ingredients="butylated hydroxytoluene",
        )
        # Row won't appear in SELECT because the NULL-check WHERE clause won't match it,
        # so return no rows from DB
        mock_engine, mock_conn = _make_mock_engine([])

        with (
            patch("database.db_engine", mock_engine),
            patch("database.connect_to_database", return_value=True),
        ):
            from services.clinical_metadata_backfill import run_backfill
            summary = run_backfill(limit=1, dry_run=False, sleep_ms=0)

        assert summary["processed"] == 0
        assert summary["skipped_already_populated"] == 0

    def test_rx_otc_status_mapping_prescription(self):
        """map_rx_otc_status correctly maps HUMAN PRESCRIPTION DRUG → Rx."""
        from services.clinical_metadata_backfill import map_rx_otc_status
        label = {"openfda": {"product_type": ["HUMAN PRESCRIPTION DRUG"]}}
        assert map_rx_otc_status(label) == "Rx"

    def test_rx_otc_status_mapping_otc(self):
        """map_rx_otc_status correctly maps HUMAN OTC DRUG → OTC."""
        from services.clinical_metadata_backfill import map_rx_otc_status
        label = {"openfda": {"product_type": ["HUMAN OTC DRUG"]}}
        assert map_rx_otc_status(label) == "OTC"

    def test_rx_otc_status_mapping_unknown(self):
        """map_rx_otc_status maps unrecognized product_type → None."""
        from services.clinical_metadata_backfill import map_rx_otc_status
        label = {"openfda": {"product_type": ["SOME UNKNOWN TYPE"]}}
        assert map_rx_otc_status(label) is None

    def test_inactive_ingredients_strips_prefix(self):
        """map_inactive_ingredients strips 'Inactive ingredients:' prefix."""
        from services.clinical_metadata_backfill import map_inactive_ingredients
        label = {
            "inactive_ingredient": ["Inactive ingredients: lactose, magnesium stearate"]
        }
        result = map_inactive_ingredients(label)
        assert result == "lactose, magnesium stearate"
