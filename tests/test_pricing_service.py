from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services.pricing_service import NADACPricingService, PricingNotFoundError, PricingServiceError


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


def test_request_json_retries_on_429_with_retry_after():
    svc = NADACPricingService()
    throttled = _response(429, {"error": "too many requests"})
    throttled.headers["Retry-After"] = "1"
    ok = _response(200, {"results": [{"id": 1}]})

    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[throttled, ok])) as mock_get:
        payload = asyncio.run(svc._request_json("https://example.test"))

    assert payload == {"results": [{"id": 1}]}
    assert mock_get.call_count == 2


def test_request_json_surfaces_http_status_error_details_and_logs_exception():
    svc = NADACPricingService()
    body = "x" * 600
    response = httpx.Response(
        status_code=404,
        text=body,
        request=httpx.Request("GET", "https://data.medicaid.gov/api/1/datastore/query/mock/0"),
    )

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=response)), \
         patch("services.pricing_service.logger.exception") as mock_log:
        with pytest.raises(PricingServiceError) as exc_info:
            asyncio.run(svc._request_json("https://example.test"))

    detail = str(exc_info.value)
    assert "HTTPStatusError 404" in detail
    assert "https://data.medicaid.gov/api/1/datastore/query/mock/0" in detail
    assert "x" * 500 in detail
    assert "x" * 501 not in detail
    mock_log.assert_called_once()


def test_request_json_surfaces_request_error_message():
    svc = NADACPricingService()
    request = httpx.Request("GET", "https://example.test")
    exc = httpx.ConnectError("dns failed", request=request)

    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[exc, exc, exc])):
        with pytest.raises(PricingServiceError, match=r"ConnectError — dns failed"):
            asyncio.run(svc._request_json("https://example.test"))


def test_extract_dataset_id_prefers_distribution_identifier_and_download_url():
    svc = NADACPricingService()

    assert svc._extract_dataset_id(
        {
            "identifier": "dataset-123",
            "distribution": [{"identifier": "distribution-456"}],
        }
    ) == "distribution-456"
    assert svc._extract_dataset_id(
        {
            "identifier": "dataset-123",
            "distribution": [
                {
                    "%Ref:downloadURL": "https://data.medicaid.gov/api/1/datastore/query/fbb83258-11c7-47f5-8b18-5f8e79f7e704/0"
                }
            ],
        }
    ) == "fbb83258-11c7-47f5-8b18-5f8e79f7e704"


def test_get_latest_dataset_metadata_uses_latest_effective_date_row():
    svc = NADACPricingService()
    catalog_payload = {
        "results": [
            {
                "title": "NADAC (National Average Drug Acquisition Cost) Weekly",
                "identifier": "dataset-123",
                "modified": "2026-05-18",
            }
        ]
    }
    with patch.object(svc, "_request_json", new=AsyncMock(return_value=catalog_payload)), \
         patch.object(svc, "_fetch_latest_effective_date", new=AsyncMock(return_value=datetime(2026, 5, 14).date())):
        metadata = asyncio.run(svc._get_latest_dataset_metadata())

    assert metadata["dataset_id"] == "dataset-123"
    assert metadata["as_of_week"] == "2026-05-14"


def test_get_latest_dataset_metadata_accepts_catalog_list_payload():
    svc = NADACPricingService()
    catalog_payload = [
        {
            "title": "NADAC (National Average Drug Acquisition Cost) Weekly",
            "identifier": "dataset-list-123",
            "modified": "2026-05-18",
        }
    ]

    with patch.object(svc, "_request_json", new=AsyncMock(return_value=catalog_payload)), \
         patch.object(svc, "_fetch_latest_effective_date", new=AsyncMock(return_value=datetime(2026, 5, 14).date())):
        metadata = asyncio.run(svc._get_latest_dataset_metadata())

    assert metadata["dataset_id"] == "dataset-list-123"
    assert metadata["as_of_week"] == "2026-05-14"


def test_get_dataset_columns_returns_first_row_keys_and_caches():
    svc = NADACPricingService()
    payload = {
        "results": [
            {
                "ndc": "00002140102",
                "ndc_description": "LISINOPRIL",
                "effective_date": "2026-05-14",
                "nadac_per_unit": "0.5",
                "pricing_unit": "EA",
            }
        ]
    }

    with patch.object(svc, "_request_datastore_query", new=AsyncMock(return_value=payload)) as mock_query:
        columns_first = asyncio.run(svc._get_dataset_columns("dist-123"))
        columns_second = asyncio.run(svc._get_dataset_columns("dist-123"))

    assert columns_first == ["ndc", "ndc_description", "effective_date", "nadac_per_unit", "pricing_unit"]
    assert columns_second == columns_first
    assert mock_query.await_count == 1


def test_resolve_column_map_picks_expected_columns_from_nadac_schema():
    svc = NADACPricingService()
    columns = ["ndc", "ndc_description", "nadac_per_unit", "effective_date", "pricing_unit"]

    with patch.object(svc, "_get_dataset_columns", new=AsyncMock(return_value=columns)):
        resolved = asyncio.run(svc._resolve_column_map("dist-123"))

    assert resolved["ndc"] == "ndc"
    assert resolved["effective_date"] == "effective_date"
    assert resolved["price"] == "nadac_per_unit"
    assert resolved["unit"] == "pricing_unit"
    assert resolved["all_columns"] == columns


def test_fetch_nadac_latest_for_ndc_posts_datastore_query_body():
    svc = NADACPricingService()

    with patch.object(
        svc,
        "_get_latest_dataset_metadata",
        new=AsyncMock(return_value={"dataset_id": "dataset-123", "as_of_week": "2026-05-14"}),
    ), patch.object(
        svc,
        "_request_json",
        new=AsyncMock(
            return_value={
                "results": [
                    {
                        "ndc": "00002140102",
                        "effective_date": "2026-05-14",
                        "nadac_per_unit": "0.50",
                        "pricing_unit": "EA",
                    }
                ]
            }
        ),
    ) as mock_request:
        result = asyncio.run(svc._fetch_nadac_latest_for_ndc("00002140102"))

    assert result["price_per_unit"] == 0.5
    assert mock_request.await_args.kwargs["method"] == "POST"
    assert mock_request.await_args.kwargs["json_body"] == {
        "conditions": [{"resource": "t", "property": "ndc", "value": "00002140102", "operator": "="}],
        "sorts": [{"resource": "t", "property": "effective_date", "order": "desc"}],
        "limit": 1,
    }


def test_fetch_nadac_latest_for_ndc_retries_next_column_when_first_400s():
    svc = NADACPricingService()

    async def _datastore_side_effect(*args, **kwargs):
        conditions = kwargs.get("conditions") or []
        property_name = conditions[0]["property"] if conditions else None
        if property_name == "ndc":
            raise PricingServiceError(
                'Request failed: POST https://data.medicaid.gov/api/1/datastore/query/mock/0 — HTTPStatusError 400 — {"message":"Column not found."}'
            )
        return {
            "results": [
                {
                    "ndc_11": "00002140102",
                    "effective_date": "2026-05-14",
                    "nadac_per_unit": "0.50",
                    "pricing_unit": "EA",
                }
            ]
        }

    with patch.object(
        svc,
        "_get_latest_dataset_metadata",
        new=AsyncMock(return_value={"dataset_id": "dataset-123", "as_of_week": "2026-05-14"}),
    ), patch.object(
        svc,
        "_resolve_column_map",
        new=AsyncMock(
            return_value={
                "ndc": "ndc",
                "effective_date": "effective_date",
                "price": "nadac_per_unit",
                "unit": "pricing_unit",
                "all_columns": ["ndc", "ndc_11", "effective_date", "nadac_per_unit", "pricing_unit"],
            }
        ),
    ), patch.object(svc, "_request_datastore_query", new=AsyncMock(side_effect=_datastore_side_effect)) as mock_query:
        result = asyncio.run(svc._fetch_nadac_latest_for_ndc("00002140102"))

    assert result["price_per_unit"] == 0.5
    attempted_columns = [
        call.kwargs["conditions"][0]["property"]
        for call in mock_query.await_args_list
        if call.kwargs.get("conditions")
    ]
    assert attempted_columns[:2] == ["ndc", "ndc_11"]


def test_fetch_nadac_latest_for_ndc_raises_not_found_when_all_candidates_column_not_found():
    svc = NADACPricingService()

    with patch.object(
        svc,
        "_get_latest_dataset_metadata",
        new=AsyncMock(return_value={"dataset_id": "dataset-123", "as_of_week": "2026-05-14"}),
    ), patch.object(
        svc,
        "_resolve_column_map",
        new=AsyncMock(
            return_value={
                "ndc": "ndc",
                "effective_date": "effective_date",
                "price": "nadac_per_unit",
                "unit": "pricing_unit",
                "all_columns": [],
            }
        ),
    ), patch.object(
        svc,
        "_request_datastore_query",
        new=AsyncMock(
            side_effect=PricingServiceError(
                'Request failed: POST https://data.medicaid.gov/api/1/datastore/query/mock/0 — HTTPStatusError 400 — {"message":"Column not found."}'
            )
        ),
    ):
        with pytest.raises(PricingNotFoundError):
            asyncio.run(svc._fetch_nadac_latest_for_ndc("00002140102"))


def test_get_latest_dataset_metadata_uses_fallback_when_catalog_raises_unexpected_error():
    svc = NADACPricingService()

    with patch("services.pricing_service.NADAC_FALLBACK_DATASET_ID", "fallback-dataset"), \
         patch.object(
             svc,
             "_request_json",
             new=AsyncMock(side_effect=AttributeError("list has no get")),
         ), \
         patch.object(svc, "_fetch_latest_effective_date", new=AsyncMock(side_effect=RuntimeError("date lookup failed"))):
        metadata = asyncio.run(svc._get_latest_dataset_metadata())

    assert metadata["dataset_id"] == "fallback-dataset"
    assert metadata["as_of_week"] is None


def test_get_latest_dataset_metadata_raises_pricing_service_error_when_no_fallback_and_catalog_fails():
    svc = NADACPricingService()

    with patch("services.pricing_service.NADAC_FALLBACK_DATASET_ID", ""), \
         patch("services.pricing_service.os.getenv", return_value=""), \
         patch.object(svc, "_request_json", new=AsyncMock(side_effect=AttributeError("list has no get"))):
        with pytest.raises(PricingServiceError, match="NADAC catalog unavailable and no fallback configured"):
            asyncio.run(svc._get_latest_dataset_metadata())


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


def test_get_price_history_refreshes_when_cache_incomplete():
    svc = NADACPricingService()

    mock_engine = MagicMock()
    read_conn = MagicMock()
    read_conn.__enter__.return_value = read_conn
    read_conn.__exit__.return_value = False
    mock_engine.connect.return_value = read_conn

    write_conn = MagicMock()
    write_conn.__enter__.return_value = write_conn
    write_conn.__exit__.return_value = False
    mock_engine.begin.return_value = write_conn

    cached_rows = [
        {"ndc": "00002140102", "effective_date": "2026-05-08", "price_per_unit": 0.45, "unit": "EA"},
    ]
    read_result = MagicMock()
    read_result.mappings.return_value.all.return_value = cached_rows
    read_conn.execute.return_value = read_result

    upstream_rows = [
        {"ndc": "00002140102", "effective_date": "2026-05-01", "nadac_per_unit": "0.40", "pricing_unit": "EA"},
        {"ndc": "00002140102", "effective_date": "2026-05-08", "nadac_per_unit": "0.45", "pricing_unit": "EA"},
    ]

    with patch("database.db_engine", mock_engine), \
         patch.object(svc, "_ensure_db", return_value=None), \
         patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(svc, "_request_json", new=AsyncMock(return_value={"results": upstream_rows})):
        history = asyncio.run(svc.get_price_history("00002-1401-02", weeks=2))

    assert len(history) == 2
    assert [h["effective_date"] for h in history] == ["2026-05-01", "2026-05-08"]


def test_get_alternatives_prefers_fresh_bulk_cache():
    svc = NADACPricingService()

    fresh_cached = {
        "ndc": "00002140102",
        "price_per_unit": 0.25,
        "unit": "EA",
        "effective_date": "2026-05-14",
        "source": "NADAC",
        "fetched_at": datetime.now(timezone.utc),
    }

    with patch.object(svc, "_resolve_ingredient", new=AsyncMock(return_value={"name": "Lisinopril", "rxcui": "123"})), \
         patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"as_of_week": "2026-05-14"})), \
         patch.object(svc, "_related_product_rxcuis", new=AsyncMock(return_value=[{"rxcui": "111", "name": "Lisinopril", "tty": "SCD"}])), \
         patch.object(svc, "_ndcs_for_rxcui", new=AsyncMock(return_value=["00002140102"])), \
         patch.object(svc, "_get_cached_prices_bulk", return_value={"00002140102": fresh_cached}), \
         patch.object(svc, "_cache_fresh", return_value=True), \
         patch.object(svc, "get_price", new=AsyncMock()) as mock_get_price:
        result = asyncio.run(svc.get_alternatives_by_ingredient("123"))

    assert result["ingredient"] == "Lisinopril"
    assert len(result["alternatives"]) == 1
    assert result["alternatives"][0]["ndc"] == "00002140102"
    mock_get_price.assert_not_called()
