from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")


from services.pricing_service import PricingNotFoundError  # noqa: E402
from services.snapshot_resolver import resolve_pill_to_snapshot  # noqa: E402


WEGOVY_PILL = {
    "id": "00000000-0000-0000-0000-000000000001",
    "slug": "Wegovy-1-5-mg",
    "medicine_name": "Wegovy",
    "ndc11": "00169440113",
    "ndc9": "001694401",
    "rxcui": "111111",
    "spl_strength": "1.5 mg",
}

WEGOVY_9MG_PILL = {
    "id": "00000000-0000-0000-0000-000000000009",
    "slug": "Wegovy-9-mg",
    "medicine_name": "Wegovy",
    "ndc11": "00169440913",
    "ndc9": "001694409",
    "rxcui": "999999",
    "spl_strength": "9 mg",
}


def test_resolve_exact_snapshot_sets_schema_valid_true():
    priced = {
        "ndc": "00169440113",
        "match_type": "exact",
        "price_per_unit": 33.16,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "total_acquisition_cost": 994.8,
        "fair_retail_low": 1492.2,
        "fair_retail_high": 2984.4,
    }

    with patch("services.snapshot_resolver.pricing_service._fetch_nadac_latest_for_ndc", new=AsyncMock(return_value={"ndc": "00169440113"})), \
         patch("services.snapshot_resolver.pricing_service._add_totals", return_value=priced), \
         patch(
             "services.snapshot_resolver._fetch_snapshot_downstream",
             new=AsyncMock(return_value=([{"effective_date": "2026-05-01", "price_per_unit": 33.16, "unit": "EA"}], "00169440113", [], [])),
         ):
        snapshot = asyncio.run(resolve_pill_to_snapshot(WEGOVY_PILL))

    assert snapshot["match_type"] == "exact"
    assert snapshot["resolved_via"] == "self"
    assert snapshot["resolved_ndc11"] == "00169440113"
    assert snapshot["schema_offers_valid"] is True


def test_resolve_wegovy_9mg_uses_sibling_family_match():
    sibling_price = {
        "ndc": "00169442531",
        "match_type": "equivalent",
        "matched_ndc": "00169442531",
        "price_per_unit": 33.16,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "total_acquisition_cost": 994.8,
        "fair_retail_low": 1492.21,
        "fair_retail_high": 2984.42,
    }

    with patch(
        "services.snapshot_resolver.pricing_service._fetch_nadac_latest_for_ndc",
        new=AsyncMock(side_effect=[PricingNotFoundError("missing"), {"ndc": "00169442531"}]),
    ), patch("services.snapshot_resolver.pricing_service._add_totals", return_value=sibling_price), \
         patch("services.snapshot_resolver._sibling_family_candidates", return_value=["00169442531"]), \
         patch(
             "services.snapshot_resolver._fetch_snapshot_downstream",
             new=AsyncMock(return_value=([{"effective_date": "2026-05-01", "price_per_unit": 33.16, "unit": "EA"}], "00169442531", [], [])),
         ):
        snapshot = asyncio.run(resolve_pill_to_snapshot(WEGOVY_9MG_PILL))

    assert snapshot["match_type"] == "equivalent"
    assert snapshot["resolved_via"] == "sibling"
    assert snapshot["resolved_ndc11"] == "00169442531"
    assert snapshot["schema_offers_valid"] is True
    assert "sibling" in (snapshot["display_disclaimer"] or "").lower()


def test_resolve_no_match_sets_webpage_safe_snapshot():
    with patch("services.snapshot_resolver._try_exact_price", new=AsyncMock(return_value=None)), \
         patch("services.snapshot_resolver._try_sibling_family", new=AsyncMock(return_value=None)), \
         patch("services.snapshot_resolver._try_rxcui_price", new=AsyncMock(return_value=None)), \
         patch("services.snapshot_resolver._try_name_price", new=AsyncMock(return_value=None)):
        snapshot = asyncio.run(resolve_pill_to_snapshot(
            {
                "id": "00000000-0000-0000-0000-000000000404",
                "slug": "No-Match",
                "medicine_name": "No Match",
                "spl_strength": "10 mg",
            }
        ))

    assert snapshot["match_type"] == "none"
    assert snapshot["resolved_via"] is None
    assert snapshot["schema_offers_valid"] is False
    assert snapshot["history_52w"] == []
    assert snapshot["alternatives"] == []


@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


def test_snapshot_route_returns_cached_row(client):
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.first.return_value = {
        "slug": "Wegovy-9-mg",
        "pill_id": "00000000-0000-0000-0000-000000000009",
        "resolved_ndc11": "00169442531",
        "match_type": "equivalent",
        "resolved_via": "sibling",
        "price_per_unit": 33.16,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "total_acquisition_cost": 994.8,
        "fair_retail_low": 1492.21,
        "fair_retail_high": 2984.42,
        "history_52w": [{"effective_date": "2026-05-01", "price_per_unit": 33.16, "unit": "EA"}],
        "history_source_ndc": "00169442531",
        "alternatives": [],
        "is_estimate": False,
        "estimate_basis": "Sibling family match with the same strength",
        "display_disclaimer": "Pricing resolved from a sibling NDC.",
        "schema_offers_valid": True,
        "resolved_at": "2026-05-23T00:00:00+00:00",
        "resolver_version": 1,
        "resolver_notes": "Resolved via sibling family match 00169442531.",
        "created_at": "2026-05-23T00:00:00+00:00",
        "updated_at": "2026-05-23T00:00:00+00:00",
    }
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = conn

    with patch("routes.snapshot.database.db_engine", engine):
        response = client.get("/api/snapshot/Wegovy-9-mg")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "public, max-age=300, stale-while-revalidate=300"
    assert response.json()["schema_offers_valid"] is True
