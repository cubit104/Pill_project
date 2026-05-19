from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from services.pricing_service import PricingNotFoundError


@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


def test_get_price_success(client):
    payload = {
        "ndc": "00002140102",
        "price_per_unit": 0.5,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "as_of_week": "2026-05-14",
        "days_supply": 30,
        "units_per_day": 1.0,
        "total_acquisition_cost": 15.0,
        "fair_retail_low": 22.5,
        "fair_retail_high": 45.0,
        "disclaimers": ["a", "b", "c"],
    }

    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ndc"] == "00002140102"
    assert data["fair_retail_high"] == 45.0
    assert "match_type" not in data
    assert "disclaimers" in data and len(data["disclaimers"]) == 3


def test_get_price_success_includes_equivalent_fields_when_present(client):
    payload = {
        "ndc": "00002140102",
        "price_per_unit": 0.5,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "as_of_week": "2026-05-14",
        "days_supply": 30,
        "units_per_day": 1.0,
        "total_acquisition_cost": 15.0,
        "fair_retail_low": 22.5,
        "fair_retail_high": 45.0,
        "match_type": "equivalent",
        "matched_ndc": "00378018101",
        "equivalent_count": 3,
        "is_stale": True,
        "disclaimers": ["a", "b", "c"],
    }

    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02")

    assert resp.status_code == 200
    data = resp.json()
    assert data["match_type"] == "equivalent"
    assert data["matched_ndc"] == "00378018101"
    assert data["equivalent_count"] == 3
    assert data["is_stale"] is True


def test_get_price_invalid_ndc_returns_400(client):
    resp = client.get("/api/prices/not-an-ndc")
    assert resp.status_code == 400


def test_get_price_returns_404_when_missing(client):
    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(side_effect=PricingNotFoundError("missing"))):
        resp = client.get("/api/prices/00002-1401-02")
    assert resp.status_code == 404


def test_get_price_sets_cache_headers_and_second_hit_is_fast(client):
    miss_payload = {
        "ndc": "00002140102",
        "price_per_unit": 0.5,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "as_of_week": "2026-05-14",
        "days_supply": 30,
        "units_per_day": 1.0,
        "total_acquisition_cost": 15.0,
        "fair_retail_low": 22.5,
        "fair_retail_high": 45.0,
        "cache_status": "miss",
        "cache_duration_ms": 4.2,
        "fetch_duration_ms": 532.1,
        "disclaimers": ["a", "b", "c"],
    }
    hit_payload = {
        **miss_payload,
        "cache_status": "hit",
        "cache_duration_ms": 1.2,
        "fetch_duration_ms": 0.0,
    }

    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(side_effect=[miss_payload, hit_payload])):
        first = client.get("/api/prices/00002-1401-02")
        second = client.get("/api/prices/00002-1401-02")

    assert first.status_code == 200
    assert first.headers["X-Price-Cache"] == "miss"
    assert "cache;dur=4.20" in first.headers["Server-Timing"]
    assert second.status_code == 200
    assert second.headers["X-Price-Cache"] == "hit"
    assert "fetch;dur=0.00" in second.headers["Server-Timing"]


def test_get_alternatives_success(client):
    payload = {
        "ingredient": "LISINOPRIL",
        "ingredient_rxcui": "1234",
        "alternatives": [
            {"ndc": "00002140102", "price_per_unit": 0.25, "unit": "EA", "effective_date": "2026-05-14", "source": "NADAC (CMS)", "is_cheapest": True}
        ],
    }
    with patch("routes.prices.pricing_service.get_alternatives_by_ingredient", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02/alternatives")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ingredient"] == "LISINOPRIL"
    assert len(data["alternatives"]) == 1
    assert len(data["disclaimers"]) == 3


def test_get_alternatives_returns_at_most_5_rows_sorted_ascending(client):
    """Alternatives endpoint forwards the already-deduped/sorted/limited list from the service."""
    alts = [
        {"ndc": f"0000000000{i}", "name": f"Drug {i}", "kind": "generic",
         "price_per_unit": float(i) * 0.10, "unit": "EA",
         "effective_date": "2026-05-14", "source": "NADAC (CMS)",
         "is_cheapest": i == 1}
        for i in range(1, 6)
    ]
    payload = {
        "ingredient": "TEST",
        "ingredient_rxcui": "9999",
        "alternatives": alts,
    }
    with patch("routes.prices.pricing_service.get_alternatives_by_ingredient", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02/alternatives")

    assert resp.status_code == 200
    data = resp.json()
    result_alts = data["alternatives"]
    assert len(result_alts) <= 5
    prices = [a["price_per_unit"] for a in result_alts]
    assert prices == sorted(prices), "Alternatives must be sorted ascending by price"
    assert result_alts[0].get("is_cheapest") is True, "First row must have is_cheapest=True"


def test_get_alternatives_includes_generic_vs_brand_ratio_when_present(client):
    payload = {
        "ingredient": "CLOPIDOGREL",
        "ingredient_rxcui": "32968",
        "alternatives": [
            {"ndc": "00093012301", "name": "clopidogrel 75 MG Oral Tablet", "kind": "generic",
             "price_per_unit": 0.05, "unit": "EA", "effective_date": "2026-05-14", "is_cheapest": True},
            {"ndc": "00071015423", "name": "Plavix 75 MG Oral Tablet", "kind": "brand",
             "price_per_unit": 8.06, "unit": "EA", "effective_date": "2026-05-14", "is_cheapest": False},
        ],
        "generic_vs_brand_ratio": 161,
    }
    with patch("routes.prices.pricing_service.get_alternatives_by_ingredient", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02/alternatives")

    assert resp.status_code == 200
    data = resp.json()
    assert data.get("generic_vs_brand_ratio") == 161


def test_get_alternatives_no_ratio_when_omitted(client):
    payload = {
        "ingredient": "METFORMIN",
        "ingredient_rxcui": "6809",
        "alternatives": [
            {"ndc": "00093102901", "name": "metformin 500 MG Oral Tablet", "kind": "generic",
             "price_per_unit": 0.04, "unit": "EA", "effective_date": "2026-05-14", "is_cheapest": True},
        ],
    }
    with patch("routes.prices.pricing_service.get_alternatives_by_ingredient", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02/alternatives")

    assert resp.status_code == 200
    data = resp.json()
    assert "generic_vs_brand_ratio" not in data


def test_get_alternatives_404(client):
    with patch(
        "routes.prices.pricing_service.get_alternatives_by_ingredient",
        new=AsyncMock(side_effect=PricingNotFoundError("none")),
    ):
        resp = client.get("/api/prices/00002-1401-02/alternatives")
    assert resp.status_code == 404


def test_get_history_success(client):
    payload = [
        {"ndc": "00002140102", "effective_date": "2026-05-01", "price_per_unit": 0.42, "unit": "EA"},
        {"ndc": "00002140102", "effective_date": "2026-05-08", "price_per_unit": 0.45, "unit": "EA"},
    ]
    with patch("routes.prices.pricing_service.get_price_history", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02/history?weeks=2")

    assert resp.status_code == 200
    data = resp.json()
    assert data["weeks"] == 2
    assert len(data["history"]) == 2
    assert len(data["disclaimers"]) == 3


def test_get_history_invalid_ndc_returns_400(client):
    resp = client.get("/api/prices/not-an-ndc/history")
    assert resp.status_code == 400


def test_get_history_404(client):
    with patch("routes.prices.pricing_service.get_price_history", new=AsyncMock(side_effect=PricingNotFoundError("none"))):
        resp = client.get("/api/prices/00002-1401-02/history")
    assert resp.status_code == 404


def test_get_price_unexpected_error_returns_503_with_exception_type(client):
    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(side_effect=RuntimeError("boom"))):
        resp = client.get("/api/prices/00002-1401-02")

    assert resp.status_code == 503
    assert "RuntimeError: boom" in resp.json()["detail"]


def test_get_price_by_rxcui_success(client):
    payload = {
        "ndc": "00378018101",
        "price_per_unit": 0.25,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "as_of_week": "2026-05-14",
        "days_supply": 30,
        "units_per_day": 1.0,
        "total_acquisition_cost": 7.5,
        "fair_retail_low": 11.25,
        "fair_retail_high": 22.5,
        "match_type": "equivalent",
        "matched_ndc": "00378018101",
        "source_rxcui": "6809",
        "equivalent_count": 5,
        "disclaimers": ["a", "b", "c"],
    }

    with patch("routes.prices.pricing_service.get_price_by_rxcui", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/by-rxcui/6809")

    assert resp.status_code == 200
    data = resp.json()
    assert data["match_type"] == "equivalent"
    assert data["source_rxcui"] == "6809"


def test_get_price_by_rxcui_404(client):
    with patch(
        "routes.prices.pricing_service.get_price_by_rxcui",
        new=AsyncMock(side_effect=PricingNotFoundError("not found")),
    ):
        resp = client.get("/api/prices/by-rxcui/6809")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "not found"


def test_get_price_by_rxcui_400(client):
    with patch(
        "routes.prices.pricing_service.get_price_by_rxcui",
        new=AsyncMock(side_effect=ValueError("Invalid RxCUI format")),
    ):
        resp = client.get("/api/prices/by-rxcui/invalid")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid RxCUI format"


def test_get_price_by_name_success(client):
    payload = {
        "ndc": "00378018101",
        "price_per_unit": 0.25,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC (CMS)",
        "as_of_week": "2026-05-14",
        "days_supply": 30,
        "units_per_day": 1.0,
        "total_acquisition_cost": 7.5,
        "fair_retail_low": 11.25,
        "fair_retail_high": 22.5,
        "match_type": "approximate",
        "resolved_ingredient": "metformin",
        "resolved_rxcui": "6809",
        "disclaimers": ["a", "b", "c"],
    }

    with patch("routes.prices.pricing_service.get_price_by_name", new=AsyncMock(return_value=payload)) as mock_lookup:
        resp = client.get("/api/prices/by-name/metformin%20hcl")

    assert resp.status_code == 200
    data = resp.json()
    assert data["match_type"] == "approximate"
    assert data["resolved_ingredient"] == "metformin"
    mock_lookup.assert_awaited_once_with("metformin hcl", days_supply=30, units_per_day=1.0)


def test_get_price_by_name_404(client):
    with patch(
        "routes.prices.pricing_service.get_price_by_name",
        new=AsyncMock(side_effect=PricingNotFoundError("name missing")),
    ):
        resp = client.get("/api/prices/by-name/metformin%20hcl")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "name missing"


def test_prices_health_ok_shape(client):
    class _Result:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, statement):
            query = str(statement)
            if "SELECT 1" in query:
                return _Result(1)
            if "FROM drug_prices" in query:
                return _Result(0)
            if "FROM drug_price_history" in query:
                return _Result(0)
            raise AssertionError(f"Unexpected query: {query}")

    class _Engine:
        def connect(self):
            return _Conn()

    rxnav_response = httpx.Response(
        200,
        json={"version": "ok"},
        request=httpx.Request("GET", "https://rxnav.nlm.nih.gov/REST/version.json"),
    )

    with patch("routes.prices.database.db_engine", _Engine()), \
         patch("routes.prices.pricing_service._get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds1", "as_of_week": "2026-05-14"})), \
         patch("routes.prices.httpx.AsyncClient.get", new=AsyncMock(return_value=rxnav_response)):
        resp = client.get("/api/prices/health")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["overall"] == "ok"
    assert set(payload["checks"].keys()) == {
        "database",
        "drug_prices_table",
        "drug_price_history_table",
        "nadac_catalog",
        "rxnav",
    }
    assert payload["checks"]["nadac_catalog"]["dataset_id"] == "ds1"
    assert payload["checks"]["drug_prices_table"]["row_count"] == 0
    assert payload["checks"]["rxnav"]["ok"] is True


def test_prices_health_degraded_when_external_checks_fail(client):
    class _Result:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, statement):
            query = str(statement)
            if "SELECT 1" in query:
                return _Result(1)
            if "FROM drug_prices" in query:
                return _Result(4)
            if "FROM drug_price_history" in query:
                return _Result(8)
            raise AssertionError(f"Unexpected query: {query}")

    class _Engine:
        def connect(self):
            return _Conn()

    with patch("routes.prices.database.db_engine", _Engine()), \
         patch("routes.prices.pricing_service._get_latest_dataset_metadata", new=AsyncMock(side_effect=RuntimeError("catalog down"))), \
         patch(
             "routes.prices.httpx.AsyncClient.get",
             new=AsyncMock(
                 return_value=httpx.Response(
                     503,
                     request=httpx.Request("GET", "https://rxnav.nlm.nih.gov/REST/version.json"),
                 )
             ),
         ):
        resp = client.get("/api/prices/health")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["overall"] == "degraded"
    assert payload["checks"]["database"]["ok"] is True
    assert payload["checks"]["drug_prices_table"]["ok"] is True
    assert payload["checks"]["drug_price_history_table"]["ok"] is True
    assert payload["checks"]["nadac_catalog"]["ok"] is False
    assert payload["checks"]["rxnav"]["ok"] is False


def test_prices_health_route_is_not_captured_by_ndc_param(client):
    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(side_effect=AssertionError("should not run"))):
        resp = client.get("/api/prices/health")
    assert resp.status_code == 200
