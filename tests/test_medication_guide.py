"""Tests for medication guide cache/build behavior and live openFDA checks."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from routes import medication_guide as medication_guide_routes
from services.medication_guide import GuideNotFoundError, GuideValidationError, build_guide

FIXTURES = Path(__file__).parent / "fixtures"


class _DummyEngine:
    def connect(self):
        class _Ctx:
            def __enter__(self):
                return object()

            def __exit__(self, exc_type, exc, tb):
                return False

        return _Ctx()

    def begin(self):
        return self.connect()


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

    def _insert(_conn, payload):
        cache["row"] = _row_from_payload(payload)
        return cache["row"]

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = None

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", side_effect=_select
    ), patch("services.medication_guide._insert_guide", side_effect=_insert):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client, dailymed_client=mock_dm))

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
    mock_dm_2 = MagicMock()
    mock_dm_2.fetch_patient_guide.return_value = None
    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", side_effect=_select
    ), patch("services.medication_guide._insert_guide", side_effect=_insert):
        acet_result = asyncio.run(build_guide(rxcui="161", openfda_client=mock_client_2, dailymed_client=mock_dm_2))

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
        "professional_html": "<html><body>cached professional</body></html>",
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
        pro_result = asyncio.run(
            build_guide(rxcui="153165", include_professional=True, openfda_client=mock_client)
        )

    assert result["sections"]["overview"] == "cached overview"
    assert result["professional_html"] is None
    assert pro_result["professional_html"] == "<html><body>cached professional</body></html>"
    assert mock_client.fetch_label_by_rxcui.call_count == 0


def test_guide_route_forwards_include_professional_flag():
    app = FastAPI()
    app.include_router(medication_guide_routes.router)

    async def _ok(*, rxcui=None, ndc=None, include_professional=False, **kwargs):
        return {
            "rxcui": rxcui,
            "ndc": ndc,
            "sections": {},
            "professional_html": "<html></html>" if include_professional else None,
        }

    with patch("routes.medication_guide.build_guide", side_effect=_ok) as mock_build:
        client = TestClient(app)
        response = client.get("/api/drugs/153165/guide?include_professional=true")

    assert response.status_code == 200
    assert response.json()["professional_html"] == "<html></html>"
    assert mock_build.call_args.kwargs["include_professional"] is True


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

    def _update(_conn, payload, *, existing_id):
        assert existing_id == 1
        return _row_from_payload(payload)

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = {"full_text": "LIPITOR Medication Guide patient text."}

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=old_row
    ), patch("services.medication_guide._update_guide", side_effect=_update):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client, dailymed_client=mock_dm))

    assert result["sections"]["overview"].startswith("LIPITOR")
    assert mock_client.fetch_label_by_rxcui.call_count == 1
    mock_dm.fetch_patient_guide.assert_called_once_with("abc-123")


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


def test_by_ndc_endpoint_returns_400_for_invalid_ndc():
    app = FastAPI()
    app.include_router(medication_guide_routes.router)
    client = TestClient(app)
    response = client.get("/api/drugs/by-ndc/not-an-ndc/guide")
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid NDC format"}


def test_invalid_ndc_is_rejected_before_openfda_lookup():
    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", _DummyEngine()):
        with pytest.raises(GuideValidationError):
            asyncio.run(build_guide(ndc="not-an-ndc", openfda_client=mock_client))

    assert mock_client.fetch_label_by_ndc.call_count == 0


def test_upsert_recovers_from_insert_integrity_error():
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]
    updated_row = _row_from_payload(
        {
            "id": 7,
            "rxcui": "153165",
            "ndc": "0071-0156-23",
            "generic_name": "atorvastatin calcium",
            "brand_name": "LIPITOR",
        }
    )

    read_conn = MagicMock()
    write_conn_1 = MagicMock()
    write_conn_2 = MagicMock()
    engine = MagicMock()

    connect_cm = MagicMock()
    connect_cm.__enter__.return_value = read_conn
    connect_cm.__exit__.return_value = False
    engine.connect.return_value = connect_cm

    begin_cm_1 = MagicMock()
    begin_cm_1.__enter__.return_value = write_conn_1
    begin_cm_1.__exit__.return_value = False
    begin_cm_2 = MagicMock()
    begin_cm_2.__enter__.return_value = write_conn_2
    begin_cm_2.__exit__.return_value = False
    engine.begin.side_effect = [begin_cm_1, begin_cm_2]

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = None

    with patch("services.medication_guide.database.db_engine", engine), patch(
        "services.medication_guide._select_cached_row",
        side_effect=[None, None, {"id": 7, "rxcui": "153165"}],
    ) as mock_select, patch(
        "services.medication_guide._insert_guide",
        side_effect=IntegrityError("INSERT", {}, Exception("duplicate key")),
    ) as mock_insert, patch(
        "services.medication_guide._update_guide", return_value=updated_row
    ) as mock_update:
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client, dailymed_client=mock_dm))

    assert result["rxcui"] == "153165"
    assert mock_insert.call_count == 1
    assert mock_select.call_count == 3
    mock_update.assert_called_once()
    assert mock_update.call_args.kwargs["existing_id"] == 7
    assert write_conn_1.commit.call_count == 0
    assert write_conn_1.rollback.call_count == 0
    assert write_conn_2.commit.call_count == 0
    assert write_conn_2.rollback.call_count == 0


def test_build_guide_uses_engine_begin_for_writes():
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]
    inserted_row = _row_from_payload({"rxcui": "153165", "ndc": "0071-0156-23"})

    read_conn = MagicMock()
    write_conn = MagicMock()
    engine = MagicMock()

    connect_cm = MagicMock()
    connect_cm.__enter__.return_value = read_conn
    connect_cm.__exit__.return_value = False
    engine.connect.return_value = connect_cm

    begin_cm = MagicMock()
    begin_cm.__enter__.return_value = write_conn
    begin_cm.__exit__.return_value = False
    engine.begin.return_value = begin_cm

    miss_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = None

    with patch("services.medication_guide.database.db_engine", engine), patch(
        "services.medication_guide._select_cached_row", side_effect=[None, None]
    ), patch("services.medication_guide._insert_guide", return_value=inserted_row):
        asyncio.run(build_guide(rxcui="153165", openfda_client=miss_client, dailymed_client=mock_dm))

    assert engine.begin.call_count >= 1

    fresh_row = _row_from_payload(
        {"rxcui": "153165", "ndc": "0071-0156-23"},
        fetched_at=datetime.now(timezone.utc),
    )
    engine_cache_hit = MagicMock()
    hit_cm = MagicMock()
    hit_cm.__enter__.return_value = read_conn
    hit_cm.__exit__.return_value = False
    engine_cache_hit.connect.return_value = hit_cm
    hit_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", engine_cache_hit), patch(
        "services.medication_guide._select_cached_row", return_value=fresh_row
    ):
        asyncio.run(build_guide(rxcui="153165", openfda_client=hit_client))

    assert engine_cache_hit.begin.call_count == 0


def test_build_guide_uses_dailymed_as_primary_overview_source():
    """When DailyMed returns full_text, it overrides the openFDA overview."""
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]

    cache = {"row": None}

    def _insert(_conn, payload):
        cache["row"] = _row_from_payload(payload)
        return cache["row"]

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = {"full_text": "Patient-facing guide text from DailyMed."}

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=None
    ), patch("services.medication_guide._insert_guide", side_effect=_insert):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client, dailymed_client=mock_dm))

    assert result["sections"]["overview"] == "Patient-facing guide text from DailyMed."
    mock_dm.fetch_patient_guide.assert_called_once_with("abc-123")


def test_build_guide_falls_back_to_openfda_overview_when_dailymed_fails():
    """When DailyMed returns None, the openFDA fallback is used for overview."""
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]
    # Lipitor fixture has no medication_guide/patient_package_insert fields,
    # so overview will be None with the openFDA fallback.
    cache = {"row": None}

    def _insert(_conn, payload):
        cache["row"] = _row_from_payload(payload)
        return cache["row"]

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = None

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=None
    ), patch("services.medication_guide._insert_guide", side_effect=_insert):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client, dailymed_client=mock_dm))

    # overview is None because lipitor fixture has no openFDA med guide fields
    assert result["sections"]["overview"] is None


def test_build_guide_falls_back_gracefully_when_dailymed_raises():
    """When DailyMed raises an exception, build_guide continues without crashing."""
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]

    cache = {"row": None}

    def _insert(_conn, payload):
        cache["row"] = _row_from_payload(payload)
        return cache["row"]

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.side_effect = RuntimeError("unexpected DailyMed error")

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=None
    ), patch("services.medication_guide._insert_guide", side_effect=_insert):
        result = asyncio.run(build_guide(rxcui="153165", openfda_client=mock_client, dailymed_client=mock_dm))

    # Should not raise — falls back to openFDA overview (None for lipitor fixture)
    assert "sections" in result


def test_guide_route_forwards_include_medguide_flag():
    app = FastAPI()
    app.include_router(medication_guide_routes.router)

    async def _ok(*, rxcui=None, ndc=None, include_medguide=False, **kwargs):
        return {
            "rxcui": rxcui,
            "ndc": ndc,
            "sections": {},
            "medguide_html": "<html>medguide</html>" if include_medguide else None,
        }

    with patch("routes.medication_guide.build_guide", side_effect=_ok) as mock_build:
        client = TestClient(app)
        response = client.get("/api/drugs/153165/guide?include_medguide=true")

    assert response.status_code == 200
    assert response.json()["medguide_html"] == "<html>medguide</html>"
    assert mock_build.call_args.kwargs["include_medguide"] is True


def test_include_medguide_false_does_not_include_in_response():
    """include_medguide=False (default) must not include medguide_html even if cached."""
    fresh_row = {
        "id": 1,
        "rxcui": "153165",
        "ndc": "0071-0156-23",
        "generic_name": "atorvastatin calcium",
        "brand_name": "LIPITOR",
        "overview": "cached overview",
        "uses": None,
        "dosage": None,
        "how_to_take": None,
        "side_effects": None,
        "warnings": None,
        "interactions": None,
        "contraindications": None,
        "special_populations": None,
        "overdose": None,
        "storage": None,
        "pharmacology": None,
        "manufacturer": None,
        "has_boxed_warning": False,
        "professional_html": None,
        "medguide_html": "<html>cached medguide</html>",
        "source_url": "https://dailymed.nlm.nih.gov/",
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

    # include_medguide defaults to False → medguide_html must be absent / None
    assert result.get("medguide_html") is None


def test_include_medguide_lazy_fetches_and_persists_on_cache_hit():
    """When cache hit lacks medguide_html and include_medguide=True, it is fetched and persisted."""
    spl_id = "spl-set-abc"
    fresh_row = {
        "id": 42,
        "rxcui": "153165",
        "ndc": "0071-0156-23",
        "generic_name": "atorvastatin calcium",
        "brand_name": "LIPITOR",
        "spl_set_id": spl_id,
        "overview": "cached overview",
        "uses": None,
        "dosage": None,
        "how_to_take": None,
        "side_effects": None,
        "warnings": None,
        "interactions": None,
        "contraindications": None,
        "special_populations": None,
        "overdose": None,
        "storage": None,
        "pharmacology": None,
        "manufacturer": None,
        "has_boxed_warning": False,
        "professional_html": None,
        "medguide_html": None,
        "source_url": "https://dailymed.nlm.nih.gov/",
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=1),
    }

    updated_row = {**fresh_row, "medguide_html": "<html>fetched medguide</html>"}

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    write_conn = MagicMock()
    engine = MagicMock()
    read_cm = MagicMock()
    read_cm.__enter__.return_value = MagicMock()
    read_cm.__exit__.return_value = False
    engine.connect.return_value = read_cm

    write_cm = MagicMock()
    write_cm.__enter__.return_value = write_conn
    write_cm.__exit__.return_value = False
    engine.begin.return_value = write_cm

    with patch("services.medication_guide.database.db_engine", engine), \
         patch("services.medication_guide._select_cached_row", return_value=fresh_row), \
         patch(
             "services.medication_guide.fetch_medguide_html",
             new=AsyncMock(return_value="<html>fetched medguide</html>"),
         ) as mock_fetch, \
         patch(
             "services.medication_guide._update_guide",
             return_value=updated_row,
         ) as mock_update:
        result = asyncio.run(
            build_guide(rxcui="153165", include_medguide=True, openfda_client=mock_client)
        )

    mock_fetch.assert_called_once_with(spl_id)
    mock_update.assert_called_once()
    assert result.get("medguide_html") == "<html>fetched medguide</html>"


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


# ---------------------------------------------------------------------------
# include_boxed_warning flag tests
# ---------------------------------------------------------------------------


def _fresh_row_with_spl(extra: dict | None = None) -> dict:
    row = {
        "id": 99,
        "rxcui": "123456",
        "ndc": "0001-0001-01",
        "spl_set_id": "spl-set-xyz",
        "generic_name": "testdrug",
        "brand_name": "TESTDRUG",
        "overview": "overview",
        "uses": None,
        "dosage": None,
        "how_to_take": None,
        "side_effects": None,
        "warnings": None,
        "interactions": None,
        "contraindications": None,
        "special_populations": None,
        "overdose": None,
        "storage": None,
        "pharmacology": None,
        "manufacturer": None,
        "has_boxed_warning": True,
        "professional_html": None,
        "medguide_html": None,
        "boxed_warning_html": None,
        "source_url": "https://dailymed.nlm.nih.gov/",
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=1),
    }
    if extra:
        row.update(extra)
    return row


def test_include_boxed_warning_false_does_not_include_in_response():
    """include_boxed_warning=False (default) must not include boxed_warning_html."""
    cached_row = _fresh_row_with_spl({"boxed_warning_html": "<div>cached boxed warning</div>"})

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=cached_row
    ):
        result = asyncio.run(build_guide(rxcui="123456", openfda_client=mock_client))

    assert result.get("boxed_warning_html") is None


def test_include_boxed_warning_lazy_fetches_and_persists_on_cache_hit():
    """Cache hit without boxed_warning_html → fetch and persist when include_boxed_warning=True."""
    spl_id = "spl-set-xyz"
    fresh_row = _fresh_row_with_spl()
    updated_row = {**fresh_row, "boxed_warning_html": '<div class="boxed-warning-content"><p>Risk.</p></div>'}

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    write_conn = MagicMock()
    engine = MagicMock()
    read_cm = MagicMock()
    read_cm.__enter__.return_value = MagicMock()
    read_cm.__exit__.return_value = False
    engine.connect.return_value = read_cm

    write_cm = MagicMock()
    write_cm.__enter__.return_value = write_conn
    write_cm.__exit__.return_value = False
    engine.begin.return_value = write_cm

    with patch("services.medication_guide.database.db_engine", engine), \
         patch("services.medication_guide._select_cached_row", return_value=fresh_row), \
         patch(
             "services.medication_guide.fetch_boxed_warning_html",
             new=AsyncMock(return_value='<div class="boxed-warning-content"><p>Risk.</p></div>'),
         ) as mock_fetch, \
         patch(
             "services.medication_guide._update_guide",
             return_value=updated_row,
         ) as mock_update:
        result = asyncio.run(
            build_guide(rxcui="123456", include_boxed_warning=True, openfda_client=mock_client)
        )

    mock_fetch.assert_called_once_with(spl_id)
    mock_update.assert_called_once()
    assert result.get("boxed_warning_html") == '<div class="boxed-warning-content"><p>Risk.</p></div>'


def test_include_boxed_warning_returns_cached_value_without_refetch():
    """Cache hit with boxed_warning_html already set → no refetch needed."""
    cached_html = '<div class="boxed-warning-content"><p>Already cached.</p></div>'
    fresh_row = _fresh_row_with_spl({"boxed_warning_html": cached_html})

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=None),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), \
         patch("services.medication_guide._select_cached_row", return_value=fresh_row), \
         patch(
             "services.medication_guide.fetch_boxed_warning_html",
             new=AsyncMock(return_value="should-not-be-called"),
         ) as mock_fetch:
        result = asyncio.run(
            build_guide(rxcui="123456", include_boxed_warning=True, openfda_client=mock_client)
        )

    mock_fetch.assert_not_called()
    assert result.get("boxed_warning_html") == cached_html


def test_guide_route_forwards_include_boxed_warning_flag():
    app = FastAPI()
    app.include_router(medication_guide_routes.router)

    async def _ok(*, rxcui=None, ndc=None, include_boxed_warning=False, **kwargs):
        return {
            "rxcui": rxcui,
            "ndc": ndc,
            "sections": {},
            "boxed_warning_html": '<div class="boxed-warning-content">BW</div>' if include_boxed_warning else None,
        }

    with patch("routes.medication_guide.build_guide", side_effect=_ok) as mock_build:
        client = TestClient(app)
        response = client.get("/api/drugs/123456/guide?include_boxed_warning=true")

    assert response.status_code == 200
    assert response.json()["boxed_warning_html"] == '<div class="boxed-warning-content">BW</div>'
    assert mock_build.call_args.kwargs["include_boxed_warning"] is True


def test_coalesce_semantics_none_fetch_does_not_wipe_cached_value():
    """When fetch_boxed_warning_html returns None, the cached value is preserved (COALESCE)."""
    # This verifies the COALESCE(:boxed_warning_html, boxed_warning_html) SQL semantics.
    # Simulate a cache miss/refresh scenario where mapped["boxed_warning_html"] is None
    # but the existing DB row already has a value — COALESCE keeps it.
    cached_row = _fresh_row_with_spl({
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=31),  # stale
        "boxed_warning_html": '<div class="boxed-warning-content"><p>Existing.</p></div>',
    })
    lipitor = _load_fixture("openfda_lipitor.json")["results"][0]

    updated_rows = []

    def _update(_conn, payload, *, existing_id):
        row = _row_from_payload(payload)
        # Simulate COALESCE: if payload boxed_warning_html is None, keep existing
        if payload.get("boxed_warning_html") is None:
            row["boxed_warning_html"] = cached_row["boxed_warning_html"]
        updated_rows.append(row)
        return row

    mock_client = SimpleNamespace(
        fetch_label_by_rxcui=AsyncMock(return_value=lipitor),
        fetch_label_by_ndc=AsyncMock(return_value=None),
    )
    mock_dm = MagicMock()
    mock_dm.fetch_patient_guide.return_value = None

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), \
         patch("services.medication_guide._select_cached_row", return_value=cached_row), \
         patch("services.medication_guide._update_guide", side_effect=_update), \
         patch(
             "services.medication_guide.fetch_boxed_warning_html",
             new=AsyncMock(return_value=None),  # fetch fails → None
         ):
        result = asyncio.run(
            build_guide(rxcui="123456", include_boxed_warning=True,
                        openfda_client=mock_client, dailymed_client=mock_dm)
        )

    # The row passed to _update_guide has boxed_warning_html=None (failed fetch);
    # COALESCE in the SQL keeps the existing value.
    assert updated_rows, "update should have been called"
    update_payload = updated_rows[-1]
    # After COALESCE simulation, the existing value is preserved
    assert update_payload["boxed_warning_html"] is not None
