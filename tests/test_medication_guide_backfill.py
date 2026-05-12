from __future__ import annotations

import asyncio
import csv
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

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


def _pill(
    pid: int,
    *,
    rxcui: str | None = "1",
    ndc11: str | None = "12345-6789-01",
    ndc9: str | None = None,
    spl_set_id: str | None = None,
) -> dict:
    return {
        "id": pid,
        "slug": f"drug-{pid}",
        "medicine_name": f"Drug {pid}",
        "rxcui": rxcui,
        "ndc11": ndc11,
        "ndc9": ndc9,
        "spl_set_id": spl_set_id,
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


def _patch_pills(pills):
    return patch("services.medication_guide_backfill._iter_published_pills", return_value=iter(pills))


@pytest.fixture(autouse=True)
def _reset_backfill_running_flag():
    admin_backfill_route._is_running = False
    yield
    admin_backfill_route._is_running = False


def test_mocked_happy_path_complete_and_partial(tmp_path):
    pills = [_pill(1), _pill(2)]
    with patch("services.medication_guide_backfill._count_published_pills", return_value=2), _patch_pills(pills), patch(
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
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills([_pill(1)]), patch(
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
    with patch("services.medication_guide_backfill._count_published_pills", return_value=2), _patch_pills(pills), patch(
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
    pills = [_pill(1, rxcui=None, ndc11=None, ndc9=None, spl_set_id=None)]
    build_guide_mock = AsyncMock()
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
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
    with patch("services.medication_guide_backfill._count_published_pills", return_value=3), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=3, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.processed == 3
    assert build_guide_mock.call_count == 3


def test_rate_limit_honored_and_disabled_with_api_key(tmp_path):
    pills = [_pill(1), _pill(2), _pill(3)]
    with patch("services.medication_guide_backfill._count_published_pills", return_value=3), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=AsyncMock(return_value=_guide(complete=True)),
    ), patch("services.medication_guide_backfill.asyncio.sleep", new=AsyncMock()) as sleep_mock, patch.dict(
        os.environ, {"OPENFDA_API_KEY": ""}, clear=False
    ):
        asyncio.run(run_backfill(limit=3, report_dir=tmp_path, rate_limit_seconds=0.1))
        assert sleep_mock.call_count == 2

    with patch("services.medication_guide_backfill._count_published_pills", return_value=3), _patch_pills(pills), patch(
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
    with patch("services.medication_guide_backfill._count_published_pills", return_value=2), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=2, dry_run=True, report_dir=tmp_path))

    assert build_guide_mock.call_count == 0
    assert summary.complete == 0
    assert summary.partial == 0
    assert summary.not_found == 0
    assert summary.errors == 0
    for key in ("complete", "partial", "not_found", "errors", "would_fetch"):
        assert Path(summary.report_paths[key]).exists()


def test_backfill_uses_rxcui_alone_when_rxcui_available(tmp_path):
    """When rxcui is available, build_guide should be called with rxcui only (ndc=None)."""
    pills = [_pill(1, rxcui="123", ndc11="12345-6789-01")]
    build_guide_mock = AsyncMock(return_value=_guide(complete=True))
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    _, kwargs = build_guide_mock.call_args
    assert kwargs["rxcui"] == "123"
    assert kwargs.get("ndc") is None
    assert kwargs["include_professional"] is True
    assert kwargs["include_medguide"] is True
    assert kwargs["include_boxed_warning"] is True


def test_backfill_uses_ndc9_when_ndc11_missing(tmp_path):
    pills = [_pill(1, rxcui=None, ndc11=None, ndc9="12345-678")]
    build_guide_mock = AsyncMock(return_value=_guide(complete=True))
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    _, kwargs = build_guide_mock.call_args
    assert kwargs.get("rxcui") is None
    assert kwargs["ndc"] == "12345-678"


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


# --- New tests for spl_set_id support ---

from services.medication_guide import GuideValidationError  # noqa: E402


def test_backfill_prioritises_spl_set_id_over_rxcui(tmp_path):
    """When spl_set_id is present, build_guide should be called with spl_set_id first."""
    pills = [_pill(1, rxcui="123", ndc11="12345-6789-01", spl_set_id="aaa-bbb-ccc")]
    build_guide_mock = AsyncMock(return_value=_guide(complete=True))
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.matched == 1
    assert build_guide_mock.call_count == 1
    _, kwargs = build_guide_mock.call_args
    assert kwargs.get("spl_set_id") == "aaa-bbb-ccc"
    assert "rxcui" not in kwargs or kwargs.get("rxcui") is None


def test_backfill_falls_back_to_rxcui_when_spl_set_id_not_found(tmp_path):
    """When spl_set_id raises GuideNotFoundError, fall back to rxcui."""
    pills = [_pill(1, rxcui="123", spl_set_id="aaa-bbb-ccc")]
    guide_result = _guide(complete=True)

    async def _side_effect(**kwargs):
        if kwargs.get("spl_set_id"):
            raise GuideNotFoundError("not found")
        return guide_result

    build_guide_mock = AsyncMock(side_effect=_side_effect)
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.matched == 1
    assert build_guide_mock.call_count == 2
    # Second call should have used rxcui
    _, second_kwargs = build_guide_mock.call_args
    assert second_kwargs.get("rxcui") == "123"
    assert second_kwargs.get("ndc") is None


def test_backfill_invalid_ndc11_falls_through_to_ndc9(tmp_path):
    """Invalid ndc11 should not count as a row error; ndc9 should be tried next."""
    pills = [_pill(1, rxcui=None, ndc11="BADINDC", ndc9="12345-678")]
    guide_result = _guide(complete=True)

    async def _side_effect(**kwargs):
        if kwargs.get("ndc") == "BADINDC":
            raise GuideValidationError("Invalid NDC format")
        return guide_result

    build_guide_mock = AsyncMock(side_effect=_side_effect)
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.errors == 0
    assert summary.matched == 1


def test_backfill_invalid_ndc_with_valid_rxcui_does_not_error(tmp_path):
    """Invalid NDC should not produce an error row when rxcui succeeds."""
    pills = [_pill(1, rxcui="856373", ndc11="422910834", ndc9=None)]
    build_guide_mock = AsyncMock(return_value=_guide(complete=True))
    with patch("services.medication_guide_backfill._count_published_pills", return_value=1), _patch_pills(pills), patch(
        "services.medication_guide_backfill.build_guide",
        new=build_guide_mock,
    ):
        summary = asyncio.run(run_backfill(limit=1, report_dir=tmp_path, rate_limit_seconds=0))

    assert summary.errors == 0
    assert summary.matched == 1
    # rxcui call should have been made first (with ndc=None)
    _, kwargs = build_guide_mock.call_args
    assert kwargs["rxcui"] == "856373"
    assert kwargs.get("ndc") is None


def test_build_guide_with_spl_set_id_hydrates_without_rxcui_or_ndc(tmp_path):
    """build_guide(spl_set_id=...) should hydrate using DailyMed directly."""
    from services.medication_guide import (
        GuideNotFoundError as _GNF,
        _select_cached_row_by_spl_set_id,
        build_guide as _build_guide,
    )
    from tests.test_medication_guide import _DummyEngine, _row_from_payload

    spl_id = "test-spl-set-id-123"
    dummy_section = "<p>Indications HTML</p>"

    spl_sections_result = {"uses": dummy_section, "overview": "<p>Overview</p>"}

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), \
         patch("services.medication_guide._select_cached_row_by_spl_set_id", return_value=None), \
         patch("services.medication_guide.fetch_spl_sections", new=AsyncMock(return_value=spl_sections_result)), \
         patch("services.medication_guide.fetch_professional_rendered", new=AsyncMock(return_value=None)), \
         patch("services.medication_guide.fetch_medguide_html", new=AsyncMock(return_value=None)), \
         patch("services.medication_guide.fetch_boxed_warning_html", new=AsyncMock(return_value=None)), \
         patch("services.medication_guide._select_cached_row", return_value=None), \
         patch("services.medication_guide._insert_guide", return_value=_row_from_payload({"spl_set_id": spl_id, "uses": dummy_section, "overview": "<p>Overview</p>"})):

        result = asyncio.run(
            _build_guide(
                spl_set_id=spl_id,
                include_professional=True,
                include_medguide=True,
                include_boxed_warning=True,
            )
        )

    assert result is not None
    sections = result.get("sections") or {}
    assert sections.get("uses") == dummy_section
