import os
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from scripts import backfill_nadac_history as backfill


class _FakeContext:
    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeService:
    def __init__(self):
        self.bulk_calls = []

    async def _resolve_column_map(self, dataset_id):
        return {"ndc": "ndc", "effective_date": "effective_date", "price": "nadac_per_unit", "unit": "pricing_unit"}

    async def _fetch_latest_effective_date(self, dataset_id):
        return date(2026, 5, 7)

    async def _bulk_query_nadac_for_ndcs(self, dataset_id, ndcs, column_map):
        self.bulk_calls.append(list(ndcs))
        return {ndc: {"ndc": ndc, "nadac_per_unit": 1.23, "pricing_unit": "EA", "effective_date": "2026-05-07"} for ndc in ndcs}

    def _parse_nadac_row(self, row, *, ndc_digits, as_of_week, column_map):
        return {
            "ndc": ndc_digits,
            "effective_date": "2026-05-07",
            "price_per_unit": 1.23,
            "unit": "EA",
        }


@pytest.mark.asyncio
async def test_dry_run_does_not_write():
    fake_service = _FakeService()
    with (
        patch.object(backfill, "NADACPricingService", return_value=fake_service),
        patch.object(backfill, "_load_target_ndcs", return_value=["11111111111", "22222222222"]),
        patch.object(backfill, "_fetch_recent_weekly_datasets", return_value=[{"dataset_id": "ds-1", "item": {}}]),
        patch.object(backfill, "_insert_history_rows") as mock_insert,
    ):
        summary = await backfill.run_nadac_history_backfill(weeks=1, dry_run=True, sleep_ms=0)

    mock_insert.assert_not_called()
    assert summary["dry_run"] is True
    assert summary["rows_inserted"] == 0


@pytest.mark.asyncio
async def test_ndc_filter_only_processes_pillfinder_ndcs():
    fake_service = _FakeService()
    ndcs = ["11111111111", "22222222222", "33333333333"]
    with (
        patch.object(backfill, "NADACPricingService", return_value=fake_service),
        patch.object(backfill, "_load_target_ndcs", return_value=ndcs),
        patch.object(backfill, "_fetch_recent_weekly_datasets", return_value=[{"dataset_id": "ds-1", "item": {}}]),
        patch.object(backfill, "_insert_history_rows", side_effect=lambda rows: len(rows)),
    ):
        await backfill.run_nadac_history_backfill(weeks=1, dry_run=False, sleep_ms=0)

    queried = fake_service.bulk_calls[0]
    assert queried == ndcs


def test_idempotent_on_conflict():
    fake_conn = MagicMock()
    fake_result = MagicMock()
    fake_result.rowcount = 1
    fake_conn.execute.return_value = fake_result
    fake_engine = MagicMock()
    fake_engine.begin.return_value = _FakeContext(fake_conn)

    with patch("scripts.backfill_nadac_history.database.db_engine", fake_engine):
        backfill._insert_history_rows(
            [
                {
                    "ndc": "11111111111",
                    "effective_date": "2026-05-07",
                    "price_per_unit": 1.0,
                    "unit": "EA",
                }
            ]
        )

    executed_sql = str(fake_conn.execute.call_args[0][0])
    assert "ON CONFLICT (ndc, effective_date) DO NOTHING" in executed_sql


@pytest.mark.asyncio
async def test_chunk_size_respected():
    fake_service = _FakeService()
    ndcs = [str(10000000000 + i) for i in range(1200)]
    with (
        patch.object(backfill, "NADACPricingService", return_value=fake_service),
        patch.object(backfill, "_load_target_ndcs", return_value=ndcs),
        patch.object(backfill, "_fetch_recent_weekly_datasets", return_value=[{"dataset_id": "ds-1", "item": {}}]),
        patch.object(backfill, "_insert_history_rows", side_effect=lambda rows: len(rows)),
    ):
        await backfill.run_nadac_history_backfill(weeks=1, dry_run=False, sleep_ms=0)

    assert len(fake_service.bulk_calls) == 3
    assert all(len(chunk) <= 500 for chunk in fake_service.bulk_calls)


@pytest.mark.asyncio
async def test_summary_counts_correct():
    class _SummaryService(_FakeService):
        async def _bulk_query_nadac_for_ndcs(self, dataset_id, ndcs, column_map):
            rows = {}
            for ndc in ndcs:
                for idx in range(5):
                    key = f"{ndc}_{idx}"
                    rows[key] = {"ndc": key, "nadac_per_unit": 1.23, "pricing_unit": "EA", "effective_date": "2026-05-07"}
            return rows

    fake_service = _SummaryService()
    with (
        patch.object(backfill, "NADACPricingService", return_value=fake_service),
        patch.object(backfill, "_load_target_ndcs", return_value=[str(10000000000 + i) for i in range(10)]),
        patch.object(
            backfill,
            "_fetch_recent_weekly_datasets",
            return_value=[{"dataset_id": "ds-1", "item": {}}, {"dataset_id": "ds-2", "item": {}}, {"dataset_id": "ds-3", "item": {}}],
        ),
        patch.object(backfill, "_insert_history_rows", side_effect=lambda rows: len(rows)),
    ):
        summary = await backfill.run_nadac_history_backfill(weeks=3, dry_run=False, sleep_ms=0)

    assert summary["weeks_processed"] == 3
    assert summary["ndcs_queried"] == 10
    assert summary["rows_inserted"] == 150
