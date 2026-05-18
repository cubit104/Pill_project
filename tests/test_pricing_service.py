from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services.pricing_service import NADACPricingService, PricingNotFoundError


def _response(status_code: int, payload: dict):
    request = httpx.Request("GET", "https://data.medicaid.gov/api/1/datastore/query/mock/0")
    return httpx.Response(status_code=status_code, json=payload, request=request)


def test_request_json_retries_on_5xx():
    svc = NADACPricingService()

    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(
            side_effect=[
                _response(500, {"error": "down"}),
                _response(502, {"error": "still down"}),
                _response(200, {"results": []}),
            ]
        ),
    ) as mock_get:
        payload = asyncio.run(svc._request_json("https://example.test"))

    assert payload == {"results": []}
    assert mock_get.call_count == 3


def test_get_price_happy_path_and_fair_range():
    svc = NADACPricingService()

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"as_of_week": "2026-05-14"})), \
         patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(
             svc,
             "_fetch_nadac_latest_for_ndc",
             new=AsyncMock(
                 return_value={
                     "ndc": "00002140102",
                     "price_per_unit": 0.5,
                     "unit": "EA",
                     "effective_date": "2026-05-14",
                     "source": "NADAC (CMS)",
                     "as_of_week": "2026-05-14",
                     "raw_payload": {},
                 }
             ),
         ), \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        result = asyncio.run(svc.get_price("00002-1401-02", days_supply=30, units_per_day=1))

    assert result["ndc"] == "00002140102"
    assert result["total_acquisition_cost"] == 15.0
    assert result["fair_retail_low"] == 22.5
    assert result["fair_retail_high"] == 45.0


def test_get_price_raises_not_found():
    svc = NADACPricingService()

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={})), \
         patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_fetch_nadac_latest_for_ndc", new=AsyncMock(side_effect=PricingNotFoundError("missing"))):
        with pytest.raises(PricingNotFoundError):
            asyncio.run(svc.get_price("00002-1401-02"))


def test_get_price_cache_hit_skips_upstream_fetch():
    svc = NADACPricingService()

    cached = {
        "ndc": "00002140102",
        "price_per_unit": 0.25,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC",
        "raw_payload": {},
        "fetched_at": datetime.now(timezone.utc),
    }

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"as_of_week": "2026-05-14"})), \
         patch.object(svc, "_get_cached_price", return_value=cached), \
         patch.object(svc, "_cache_fresh", return_value=True), \
         patch.object(svc, "_fetch_nadac_latest_for_ndc", new=AsyncMock()) as mock_fetch:
        result = asyncio.run(svc.get_price("00002-1401-02"))

    assert result["price_per_unit"] == 0.25
    mock_fetch.assert_not_called()


def test_get_price_cache_miss_when_stale_refreshes():
    svc = NADACPricingService()

    cached = {
        "ndc": "00002140102",
        "price_per_unit": 0.25,
        "unit": "EA",
        "effective_date": "2026-05-01",
        "source": "NADAC",
        "raw_payload": {},
        "fetched_at": datetime.now(timezone.utc),
    }

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"as_of_week": "2026-05-14"})), \
         patch.object(svc, "_get_cached_price", return_value=cached), \
         patch.object(svc, "_cache_fresh", return_value=False), \
         patch.object(
             svc,
             "_fetch_nadac_latest_for_ndc",
             new=AsyncMock(
                 return_value={
                     "ndc": "00002140102",
                     "price_per_unit": 0.6,
                     "unit": "EA",
                     "effective_date": "2026-05-14",
                     "source": "NADAC (CMS)",
                     "as_of_week": "2026-05-14",
                     "raw_payload": {},
                 }
             ),
         ) as mock_fetch, \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        result = asyncio.run(svc.get_price("00002-1401-02"))

    assert result["price_per_unit"] == 0.6
    mock_fetch.assert_called_once()


def test_get_price_history_uses_cache_when_present():
    svc = NADACPricingService()

    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.__exit__.return_value = False
    mock_engine.connect.return_value = mock_conn

    rows = [
        {"ndc": "00002140102", "effective_date": "2026-05-08", "price_per_unit": 0.45, "unit": "EA"},
        {"ndc": "00002140102", "effective_date": "2026-05-01", "price_per_unit": 0.4, "unit": "EA"},
    ]
    mock_result = MagicMock()
    mock_result.mappings.return_value.all.return_value = rows
    mock_conn.execute.return_value = mock_result

    with patch("database.db_engine", mock_engine), patch.object(svc, "_ensure_db", return_value=None):
        history = asyncio.run(svc.get_price_history("00002-1401-02", weeks=2))

    assert [h["effective_date"] for h in history] == ["2026-05-01", "2026-05-08"]
