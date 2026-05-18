from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from services.pricing_service import PricingNotFoundError


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _PricingHealthConn:
    def __init__(self, price_count: int, history_count: int):
        self._price_count = price_count
        self._history_count = history_count

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, statement):
        query = str(statement)
        if "SELECT 1" in query:
            return _ScalarResult(1)
        if "FROM drug_prices" in query:
            return _ScalarResult(self._price_count)
        if "FROM drug_price_history" in query:
            return _ScalarResult(self._history_count)
        raise AssertionError(f"Unexpected query: {query}")


class _PricingHealthEngine:
    def __init__(self, price_count: int, history_count: int):
        self._price_count = price_count
        self._history_count = history_count

    def connect(self):
        return _PricingHealthConn(self._price_count, self._history_count)


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
    assert "disclaimers" in data and len(data["disclaimers"]) == 3


def test_get_price_invalid_ndc_returns_400(client):
    resp = client.get("/api/prices/not-an-ndc")
    assert resp.status_code == 400


def test_get_price_returns_404_when_missing(client):
    with patch("routes.prices.pricing_service.get_price", new=AsyncMock(side_effect=PricingNotFoundError("missing"))):
        resp = client.get("/api/prices/00002-1401-02")
    assert resp.status_code == 404


def test_get_alternatives_success(client):
    payload = {
        "ingredient": "LISINOPRIL",
        "ingredient_rxcui": "1234",
        "alternatives": [
            {"ndc": "00002140102", "price_per_unit": 0.25, "unit": "EA", "effective_date": "2026-05-14", "source": "NADAC (CMS)"}
        ],
    }
    with patch("routes.prices.pricing_service.get_alternatives_by_ingredient", new=AsyncMock(return_value=payload)):
        resp = client.get("/api/prices/00002-1401-02/alternatives")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ingredient"] == "LISINOPRIL"
    assert len(data["alternatives"]) == 1
    assert len(data["disclaimers"]) == 3


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


def test_prices_health_ok_shape(client):
    rxnav_response = httpx.Response(
        200,
        json={"version": "ok"},
        request=httpx.Request("GET", "https://rxnav.nlm.nih.gov/REST/version.json"),
    )

    with patch("routes.prices.database.db_engine", _PricingHealthEngine(0, 0)), \
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
    with patch("routes.prices.database.db_engine", _PricingHealthEngine(4, 8)), \
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
