"""Tests for medication guide cache/build behavior and live openFDA checks."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from routes import medication_guide as medication_guide_routes
from services.medication_guide import GuideNotFoundError, build_guide

FIXTURES = Path(__file__).parent / "fixtures"


class _DummyEngine:
    def connect(self):
        class _Ctx:
            def __enter__(self):
                return object()

            def __exit__(self, exc_type, exc, tb):
                return False

        return _Ctx()


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _row_from_payload(payload: dict, *, fetched_at: datetime | None = None) -> dict:
    row = dict(payload)
    row.setdefault("fetched_at", fetched_at or datetime.now(timezone.utc))
    row.setdefault("has_boxed_warning", False)
    row.setdefault("id", 1)
    return row


def test_build_guide_maps_openfda_fields_and_null_sections():
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]
    acet = _load_fixture("openfda_acetaminophen.json")["results"][0]

    cache = {"row": None}

    def _select(*_, **__):
        return cache["row"]

    def _upsert(_conn, payload, existing_id):
        assert existing_id is None
        cache["row"] = _row_from_payload(payload)
        return cache["row"]

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", side_effect=_select
    ), patch("services.medication_guide._upsert_guide", side_effect=_upsert):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client))

    assert result["rxcui"] == "153165"
    assert result["ndc"] == "0071-0156-23"
    assert result["sections"]["dosage"] == (
        "The recommended starting dose is 10 or 20 mg once daily.\n\n"
        "Tablets: 10 mg, 20 mg, 40 mg, and 80 mg."
    )
    assert result["sections"]["manufacturer"].startswith("Manufacturer:")
    assert result["has_boxed_warning"] is False

    cache["row"] = None
    mock_client_2 = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=acet),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", side_effect=_select
    ), patch("services.medication_guide._upsert_guide", side_effect=_upsert):
        acet_result = asyncio.run(build_guide(rxcui="161", openfda_client=mock_client_2))

    assert acet_result["sections"]["how_to_take"] is None
    assert acet_result["sections"]["interactions"] is None
    assert acet_result["sections"]["pharmacology"] is None


def test_build_guide_cache_hit_skips_openfda_within_30_days():
    fresh_row = {
        "id": 1,
        "rxcui": "153165",
        "ndc": "0071-0156-23",
        "generic_name": "atorvastatin calcium",
        "brand_name": "LIPITOR",
        "overview": "cached overview",
        "uses": "cached uses",
        "dosage": "cached dosage",
        "how_to_take": None,
        "side_effects": "cached side effects",
        "warnings": "cached warnings",
        "interactions": None,
        "contraindications": "cached contraindications",
        "special_populations": None,
        "overdose": None,
        "storage": None,
        "pharmacology": "cached pharmacology",
        "manufacturer": "cached manufacturer",
        "has_boxed_warning": False,
        "source_url": "https://api.fda.gov/drug/label.json?search=spl_set_id:abc-123",
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=1),
    }

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=fresh_row
    ):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client))

    assert result["sections"]["overview"] == "cached overview"
    assert mock_client.fetch_label_by_rxcui.call_count == 0


def test_build_guide_refetches_when_stale():
    old_row = {
        "id": 1,
        "rxcui": "153165",
        "ndc": "0071-0156-23",
        "generic_name": "atorvastatin calcium",
        "brand_name": "LIPITOR",
        "overview": "old",
        "uses": "old",
        "dosage": "old",
        "how_to_take": None,
        "side_effects": "old",
        "warnings": "old",
        "interactions": None,
        "contraindications": "old",
        "special_populations": None,
        "overdose": None,
        "storage": None,
        "pharmacology": "old",
        "manufacturer": "old",
        "has_boxed_warning": False,
        "source_url": "https://api.fda.gov/drug/label.json?search=spl_set_id:old",
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=31),
    }
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]

    def _upsert(_conn, payload, existing_id):
        assert existing_id == 1
        return _row_from_payload(payload)

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=old_row
    ), patch("services.medication_guide._upsert_guide", side_effect=_upsert):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client))

    assert result["sections"]["overview"].startswith("LIPITOR")
    assert mock_client.fetch_label_by_rxcui.call_count == 1


def test_unknown_rxcui_returns_404_error_payload():
    app = FastAPI()
    app.include_router(medication_guide_routes.router)

    async def _not_found(*args, **kwargs):
        raise GuideNotFoundError("No FDA label found for this drug")

    with patch("routes.medication_guide.build_guide", side_effect=_not_found):
        client = TestClient(app)
        response = client.get("/api/drugs/000000/guide")

    assert response.status_code == 404
    assert response.json() == {"error": "No FDA label found for this drug"}


@pytest.mark.live
@pytest.mark.skipif(os.getenv("RUN_LIVE_OPENFDA_TESTS") != "1", reason="Live openFDA tests are disabled")
def test_live_lipitor_sections():
    result = asyncio.run(build_guide(rxcui="153165"))
    sections = result["sections"]
    for key in [
        "overview",
        "uses",
        "dosage",
        "side_effects",
        "warnings",
        "contraindications",
        "pharmacology",
        "manufacturer",
    ]:
        assert sections[key] is not None


@pytest.mark.live
@pytest.mark.skipif(os.getenv("RUN_LIVE_OPENFDA_TESTS") != "1", reason="Live openFDA tests are disabled")
def test_live_lisinopril_sections_and_box_warning():
    result = asyncio.run(build_guide(rxcui="29046"))
    sections = result["sections"]
    for key in [
        "overview",
        "uses",
        "dosage",
        "side_effects",
        "warnings",
        "contraindications",
        "pharmacology",
        "manufacturer",
    ]:
        assert sections[key] is not None
    assert result["has_boxed_warning"] is True


@pytest.mark.live
@pytest.mark.skipif(os.getenv("RUN_LIVE_OPENFDA_TESTS") != "1", reason="Live openFDA tests are disabled")
def test_live_acetaminophen_sections():
    result = asyncio.run(build_guide(rxcui="161"))
    sections = result["sections"]
    for key in ["overview", "uses", "dosage", "warnings", "manufacturer"]:
        assert sections[key] is not None
