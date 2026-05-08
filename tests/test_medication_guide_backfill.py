from __future__ import annotations

import asyncio
import csv
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.admin.auth import require_superuser
from routes.admin import medication_guide_backfill as admin_backfill_route
from services.medication_guide import GuideNotFoundError
from services.medication_guide_backfill import run_backfill


SECTION_KEYS = [
    "overview",
    "uses",
    "dosage",
    "how_to_take",
    "side_effects",
    "warnings",
    "interactions",
    "contraindications",
    "special_populations",
    "overdose",
    "storage",
    "pharmacology",
    "manufacturer",
]


def _pill(pid: int, *, rxcui: str | None = "1", ndc11: str | None = "12345-6789-01") -> dict:
    return {
        "id": pid,
        "slug": f"drug-{pid}",
        "medicine_name": f"Drug {pid}",
        "rxcui": rxcui,
        "ndc11": ndc11,
    }


def _guide(*, complete: bool = True) -> dict:
    sections = {key: f"{key}-value" for key in SECTION_KEYS}
    if not complete:
        sections["interactions"] = None
    return {
        "rxcui": "1",
        "ndc": "12345-6789-01",
        "brand_name": "Brand",
        "generic_name": "Generic",
        "sections": sections,
    }


def _csv_rows(path: str) -> list[dict[str, str]]:
    with Path(path).open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_mocked_happy_path_complete_and_partial(tmp_path):
    pills = [_pill(1), _pill(2)]
    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=AsyncMock(side_effect=[_guide(complete=True), _guide(complete=False)]),
    ):
        summary = asyncio.run(run_backfill(limit=2, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.complete == 1
    assert summary.partial == 1
    complete_rows = _csv_rows(summary.report_paths["complete"])
    partial_rows = _csv_rows(summary.report_paths["partial"])
    assert len(complete_rows) == 1
    assert len(partial_rows) == 1
    assert partial_rows[0]["missing_sections"] == "interactions"


def test_mocked_not_found(tmp_path):
    with patch("services.medication_guide_backfill._load_published_pills", return_value=[_pill(1)]), patch(
        "services.medication_guide_backfill.build_guide",
        new=AsyncMock(side_effect=GuideNotFoundError("No FDA label")),
    ):
        summary = asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.not_found == 1
    rows = _csv_rows(summary.report_paths["not_found"])
    assert len(rows) == 1
    assert rows[0]["pill_id"] == "1"


def test_mocked_error_does_not_crash(tmp_path):
    pills = [_pill(1), _pill(2)]
    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=AsyncMock(side_effect=[RuntimeError("boom"), _guide(complete=True)]),
    ):
        summary = asyncio.run(run_backfill(limit=2, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.errors == 1
    assert summary.complete == 1
    error_rows = _csv_rows(summary.report_paths["errors"])
    assert len(error_rows) == 1
    assert error_rows[0]["error_type"] == "RuntimeError"


def test_skipped_row_with_no_ids(tmp_path):
    pills = [_pill(1, rxcui=None, ndc11=None)]
    build_guide_mock = AsyncMock()
    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.skipped == 1
    assert build_guide_mock.call_count == 0
    skipped_rows = _csv_rows(summary.report_paths["skipped"])
    assert len(skipped_rows) == 1


def test_limit_honored(tmp_path):
    pills = [_pill(i) for i in range(1, 4)]
    build_guide_mock = AsyncMock(return_value=_guide(complete=True))
    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=3, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.processed == 3
    assert build_guide_mock.call_count == 3


def test_rate_limit_honored_and_disabled_with_api_key(tmp_path):
    pills = [_pill(1), _pill(2), _pill(3)]
    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=AsyncMock(return_value=_guide(complete=True)),
    ), patch("services.medication_guide_backfill.asyncio.sleep", new=AsyncMock()) as sleep_mock, patch.dict(
        os.environ, {"OPENFDA_API_KEY": ""}, clear=False
    ):
        asyncio.run(run_backfill(limit=3, report_dir=tmp_path, rate_limit_seconds=0.1))
        assert sleep_mock.call_count == 2

    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=AsyncMock(return_value=_guide(complete=True)),
    ), patch("services.medication_guide_backfill.asyncio.sleep", new=AsyncMock()) as sleep_mock, patch.dict(
        os.environ, {"OPENFDA_API_KEY": "anything"}, clear=False
    ):
        asyncio.run(run_backfill(limit=3, report_dir=tmp_path, rate_limit_seconds=0.1))
        assert sleep_mock.call_count == 0


def test_dry_run_produces_reports_without_build_call(tmp_path):
    pills = [_pill(1), _pill(2)]
    build_guide_mock = AsyncMock()
    with patch("services.medication_guide_backfill._load_published_pills", return_value=pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=2, dry_run=True, report_dir=tmp_path))

    assert build_guide_mock.call_count == 0
    for key in ("complete", "partial", "not_found", "errors"):
        assert Path(summary.report_paths[key]).exists()


def test_concurrent_run_rejection():
    app = FastAPI()
    app.include_router(admin_backfill_route.router)
    app.dependency_overrides[require_superuser] = lambda: {"email": "super@test.com", "role": "superuser"}

    admin_backfill_route._is_running = False
    with patch("starlette.background.BackgroundTasks.add_task", return_value=None):
        client = TestClient(app)
        first = client.post("/api/admin/medication-guide/backfill?limit=5&dry_run=true")
        second = client.post("/api/admin/medication-guide/backfill?limit=5&dry_run=true")

    assert first.status_code == 202
    assert second.status_code == 409
    assert second.json() == {"error": "Backfill already in progress"}
