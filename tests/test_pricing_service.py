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


def test_ingredient_for_rxcui_uses_literal_plus_in_tty_param():
    svc = NADACPricingService()
    payload = {
        "relatedGroup": {
            "conceptGroup": [
                {"conceptProperties": [{"name": "clopidogrel", "rxcui": "32968"}]},
            ]
        }
    }

    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(
            return_value=httpx.Response(
                200,
                json=payload,
                request=httpx.Request("GET", "https://rxnav.nlm.nih.gov/REST/rxcui/213169/related.json?tty=IN+PIN"),
            )
        ),
    ) as mock_get:
        result = asyncio.run(svc._ingredient_for_rxcui("213169"))

    called_url = str(mock_get.await_args.args[0])
    assert "tty=IN+PIN" in called_url
    assert "tty=IN%2BPIN" not in called_url
    assert mock_get.await_args.kwargs["params"] is None
    assert result == {"name": "clopidogrel", "rxcui": "32968"}


def test_related_product_rxcuis_uses_literal_plus_in_tty_param():
    svc = NADACPricingService()
    payload = {
        "relatedGroup": {
            "conceptGroup": [
                {"conceptProperties": [{"name": "Clopidogrel 75 MG Oral Tablet", "rxcui": "111", "tty": "SCD"}]},
            ]
        }
    }

    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(
            return_value=httpx.Response(
                200,
                json=payload,
                request=httpx.Request(
                    "GET",
                    "https://rxnav.nlm.nih.gov/REST/rxcui/32968/related.json?tty=SCD+SBD+GPCK+BPCK",
                ),
            )
        ),
    ) as mock_get:
        result = asyncio.run(svc._related_product_rxcuis("32968"))

    called_url = str(mock_get.await_args.args[0])
    assert "tty=SCD+SBD+GPCK+BPCK" in called_url
    assert "tty=SCD%2BSBD%2BGPCK%2BBPCK" not in called_url
    assert mock_get.await_args.kwargs["params"] is None
    assert result == [{"rxcui": "111", "name": "Clopidogrel 75 MG Oral Tablet", "tty": "SCD"}]


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


def test_get_price_falls_back_to_equivalent_when_exact_ndc_missing():
    svc = NADACPricingService()
    siblings = ["11111111111", "22222222222", "33333333333"]
    rows_by_ndc = {
        "11111111111": {
            "ndc": "11111111111",
            "effective_date": "2026-05-14",
            "nadac_per_unit": "0.60",
            "pricing_unit": "EA",
        },
        "22222222222": {
            "ndc": "22222222222",
            "effective_date": "2026-05-14",
            "nadac_per_unit": "0.25",
            "pricing_unit": "EA",
        },
    }

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_fetch_nadac_latest_for_ndc", new=AsyncMock(side_effect=PricingNotFoundError("missing"))), \
         patch.object(svc, "_sibling_ndcs_for_ndc", new=AsyncMock(return_value=siblings)), \
         patch.object(
             svc,
             "_resolve_column_map",
             new=AsyncMock(
                 return_value={
                     "ndc": "ndc",
                     "effective_date": "effective_date",
                     "price": "nadac_per_unit",
                     "unit": "pricing_unit",
                 }
             ),
         ), \
         patch.object(svc, "_bulk_query_nadac_for_ndcs", new=AsyncMock(return_value=rows_by_ndc)) as mock_bulk, \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        result = asyncio.run(svc.get_price("00002-1401-02"))

    assert result["match_type"] == "equivalent"
    assert result["matched_ndc"] == "22222222222"
    assert result["equivalent_count"] == 3
    assert result["ndc"] == "00002140102"
    assert result["price_per_unit"] == 0.25
    mock_bulk.assert_awaited_once()


def test_get_price_returns_exact_when_present():
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
         patch.object(svc, "_fetch_nadac_equivalent_for_ndc", new=AsyncMock()) as mock_equivalent, \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        result = asyncio.run(svc.get_price("00002-1401-02"))

    assert "match_type" not in result
    mock_equivalent.assert_not_awaited()


def test_get_price_raises_not_found_when_no_siblings_have_prices():
    svc = NADACPricingService()

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_fetch_nadac_latest_for_ndc", new=AsyncMock(side_effect=PricingNotFoundError("missing"))), \
         patch.object(svc, "_sibling_ndcs_for_ndc", new=AsyncMock(return_value=["11111111111", "22222222222"])), \
         patch.object(
             svc,
             "_resolve_column_map",
             new=AsyncMock(
                 return_value={
                     "ndc": "ndc",
                     "effective_date": "effective_date",
                     "price": "nadac_per_unit",
                     "unit": "pricing_unit",
                 }
             ),
         ), \
         patch.object(svc, "_bulk_query_nadac_for_ndcs", new=AsyncMock(return_value={})), \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        with pytest.raises(PricingNotFoundError):
            asyncio.run(svc.get_price("00002-1401-02"))


def test_equivalent_match_is_cached_under_original_ndc():
    svc = NADACPricingService()
    cached_rows = [None]
    now = datetime.now(timezone.utc)

    def _get_cached(_ndc):
        return cached_rows[0]

    def _upsert(price):
        cached_rows[0] = {
            "ndc": price["ndc"],
            "price_per_unit": price["price_per_unit"],
            "unit": price["unit"],
            "effective_date": price["effective_date"],
            "source": "NADAC",
            "raw_payload": {
                "match_type": price["match_type"],
                "matched_ndc": price["matched_ndc"],
                "equivalent_count": price["equivalent_count"],
            },
            "fetched_at": now,
        }

    with patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"as_of_week": "2026-05-14"})), \
         patch.object(svc, "_get_cached_price", side_effect=_get_cached), \
         patch.object(svc, "_cache_fresh", return_value=True), \
         patch.object(svc, "_fetch_nadac_latest_for_ndc", new=AsyncMock(side_effect=PricingNotFoundError("missing"))), \
         patch.object(
             svc,
             "_fetch_nadac_equivalent_for_ndc",
             new=AsyncMock(
                 return_value={
                     "ndc": "00002140102",
                     "price_per_unit": 0.25,
                     "unit": "EA",
                     "effective_date": "2026-05-14",
                     "source": "NADAC (CMS)",
                     "as_of_week": "2026-05-14",
                     "raw_payload": {"ndc": "22222222222"},
                     "match_type": "equivalent",
                     "matched_ndc": "22222222222",
                     "equivalent_count": 3,
                 }
             ),
         ) as mock_equivalent, \
         patch.object(svc, "_upsert_price_cache", side_effect=_upsert) as mock_upsert, \
         patch.object(svc, "_bulk_query_nadac_for_ndcs", new=AsyncMock()) as mock_bulk:
        first = asyncio.run(svc.get_price("00002-1401-02"))
        second = asyncio.run(svc.get_price("00002-1401-02"))

    assert first["match_type"] == "equivalent"
    assert first["ndc"] == "00002140102"
    assert second["match_type"] == "equivalent"
    assert second["matched_ndc"] == "22222222222"
    assert mock_upsert.call_count == 1
    mock_equivalent.assert_awaited_once()
    mock_bulk.assert_not_awaited()


def test_get_price_by_rxcui_returns_cheapest_sibling():
    svc = NADACPricingService()
    siblings = ["11111111111", "22222222222", "33333333333"]
    rows_by_ndc = {
        "11111111111": {
            "ndc": "11111111111",
            "effective_date": "2026-05-14",
            "nadac_per_unit": "0.60",
            "pricing_unit": "EA",
        },
        "22222222222": {
            "ndc": "22222222222",
            "effective_date": "2026-05-14",
            "nadac_per_unit": "0.25",
            "pricing_unit": "EA",
        },
    }

    with patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_ndcs_for_rxcui", new=AsyncMock(return_value=siblings)), \
         patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(
             svc,
             "_resolve_column_map",
             new=AsyncMock(return_value={"ndc": "ndc", "effective_date": "effective_date", "price": "nadac_per_unit", "unit": "pricing_unit"}),
         ), \
         patch.object(svc, "_bulk_query_nadac_for_ndcs", new=AsyncMock(return_value=rows_by_ndc)), \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        result = asyncio.run(svc.get_price_by_rxcui("6809"))

    assert result["price_per_unit"] == 0.25
    assert result["ndc"] == "22222222222"
    assert result["matched_ndc"] == "22222222222"
    assert result["source_rxcui"] == "6809"
    assert result["match_type"] == "equivalent"


def test_get_price_by_rxcui_raises_not_found_when_no_siblings():
    svc = NADACPricingService()

    with patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_ndcs_for_rxcui", new=AsyncMock(return_value=[])):
        with pytest.raises(PricingNotFoundError, match="No NDCs found for RxCUI 6809"):
            asyncio.run(svc.get_price_by_rxcui("6809"))


def test_get_price_by_rxcui_raises_not_found_when_siblings_have_no_nadac_rows():
    svc = NADACPricingService()

    with patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_ndcs_for_rxcui", new=AsyncMock(return_value=["11111111111"])), \
         patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(
             svc,
             "_resolve_column_map",
             new=AsyncMock(return_value={"ndc": "ndc", "effective_date": "effective_date", "price": "nadac_per_unit", "unit": "pricing_unit"}),
         ), \
         patch.object(svc, "_bulk_query_nadac_for_ndcs", new=AsyncMock(return_value={})):
        with pytest.raises(PricingNotFoundError, match="No NADAC pricing found for any NDC of RxCUI 6809"):
            asyncio.run(svc.get_price_by_rxcui("6809"))


def test_get_price_by_rxcui_uses_cache_on_second_call():
    svc = NADACPricingService()
    cached_rows = [None]
    now = datetime.now(timezone.utc)

    def _get_cached(_key):
        return cached_rows[0]

    def _upsert(price, **kwargs):
        key = kwargs.get("cache_key") or price["ndc"]
        cached_rows[0] = {
            "ndc": key,
            "price_per_unit": price["price_per_unit"],
            "unit": price["unit"],
            "effective_date": price["effective_date"],
            "source": "NADAC",
            "raw_payload": {
                "ndc": "22222222222",
                "match_type": "equivalent",
                "matched_ndc": "22222222222",
                "source_rxcui": "6809",
                "equivalent_count": 2,
            },
            "fetched_at": now,
        }

    with patch.object(svc, "_get_cached_price", side_effect=_get_cached), \
         patch.object(svc, "_cache_fresh", return_value=True), \
         patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(svc, "_ndcs_for_rxcui", new=AsyncMock(return_value=["11111111111", "22222222222"])) as mock_siblings, \
         patch.object(
             svc,
             "_resolve_column_map",
             new=AsyncMock(return_value={"ndc": "ndc", "effective_date": "effective_date", "price": "nadac_per_unit", "unit": "pricing_unit"}),
         ), \
         patch.object(
             svc,
             "_bulk_query_nadac_for_ndcs",
             new=AsyncMock(
                 return_value={
                     "22222222222": {
                         "ndc": "22222222222",
                         "effective_date": "2026-05-14",
                         "nadac_per_unit": "0.25",
                         "pricing_unit": "EA",
                     }
                 }
             ),
         ), \
         patch.object(svc, "_upsert_price_cache", side_effect=_upsert):
        first = asyncio.run(svc.get_price_by_rxcui("6809"))
        second = asyncio.run(svc.get_price_by_rxcui("6809"))

    assert first["matched_ndc"] == "22222222222"
    assert second["matched_ndc"] == "22222222222"
    mock_siblings.assert_awaited_once()


def test_get_price_by_name_resolves_to_rxcui_then_to_price():
    svc = NADACPricingService()

    with patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_resolve_ingredient", new=AsyncMock(return_value={"name": "metformin", "rxcui": "6809"})), \
         patch.object(
             svc,
             "get_price_by_rxcui",
             new=AsyncMock(
                 return_value={
                     "ndc": "22222222222",
                     "price_per_unit": 0.25,
                     "unit": "EA",
                     "effective_date": "2026-05-14",
                     "source": "NADAC (CMS)",
                     "as_of_week": "2026-05-14",
                     "match_type": "equivalent",
                     "matched_ndc": "22222222222",
                     "source_rxcui": "6809",
                     "equivalent_count": 2,
                     "total_acquisition_cost": 7.5,
                     "fair_retail_low": 11.25,
                     "fair_retail_high": 22.5,
                     "days_supply": 30,
                     "units_per_day": 1.0,
                     "disclaimers": [],
                 }
             ),
         ), \
         patch.object(svc, "_upsert_price_cache", return_value=None):
        result = asyncio.run(svc.get_price_by_name("metformin"))

    assert result["match_type"] == "approximate"
    assert result["resolved_ingredient"] == "metformin"
    assert result["resolved_rxcui"] == "6809"


def test_get_price_by_name_resolves_successfully():
    svc = NADACPricingService()

    async def _mock_request_json(url, *, method="GET", params=None, json_body=None):
        if url.endswith("/REST/drugs.json"):
            return {
                "drugGroup": {
                    "conceptGroup": [
                        {"conceptProperties": [{"rxcui": "213169", "name": "Plavix 75 MG Oral Tablet"}]},
                    ]
                }
            }
        if url.endswith("/REST/rxcui/213169/related.json?tty=IN+PIN"):
            return {
                "relatedGroup": {
                    "conceptGroup": [
                        {"conceptProperties": [{"rxcui": "32968", "name": "clopidogrel"}]},
                    ]
                }
            }
        if url.endswith("/REST/rxcui/32968/ndcs.json"):
            return {"ndcGroup": {"ndcList": {"ndc": ["00074-2130-13", "00074-2130-90"]}}}
        raise AssertionError(f"Unexpected URL: {url} params={params} method={method} json_body={json_body}")

    with patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_get_latest_dataset_metadata", new=AsyncMock(return_value={"dataset_id": "ds", "as_of_week": "2026-05-14"})), \
         patch.object(
             svc,
             "_resolve_column_map",
             new=AsyncMock(return_value={"ndc": "ndc", "effective_date": "effective_date", "price": "nadac_per_unit", "unit": "pricing_unit"}),
         ), \
         patch.object(
             svc,
             "_request_datastore_query",
             new=AsyncMock(
                 return_value={
                     "results": [
                         {
                             "ndc": "00074213013",
                             "effective_date": "2026-05-14",
                             "nadac_per_unit": "0.85",
                             "pricing_unit": "EA",
                         },
                         {
                             "ndc": "00074213090",
                             "effective_date": "2026-05-14",
                             "nadac_per_unit": "0.65",
                             "pricing_unit": "EA",
                         },
                     ]
                 }
             ),
         ), \
         patch.object(svc, "_upsert_price_cache", return_value=None), \
         patch.object(svc, "_request_json", new=AsyncMock(side_effect=_mock_request_json)):
        result = asyncio.run(svc.get_price_by_name("plavix"))

    assert result["match_type"] == "approximate"
    assert result["resolved_ingredient"] == "clopidogrel"
    assert result["resolved_rxcui"] == "32968"
    assert result["price_per_unit"] == 0.65
    assert result["total_acquisition_cost"] == 19.5


def test_get_price_by_name_raises_when_ingredient_unresolvable():
    svc = NADACPricingService()

    with patch.object(svc, "_get_cached_price", return_value=None), \
         patch.object(svc, "_resolve_ingredient", new=AsyncMock(return_value=None)):
        with pytest.raises(PricingNotFoundError, match="Could not resolve RxCUI for drug name 'missing drug'"):
            asyncio.run(svc.get_price_by_name("missing drug"))


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
