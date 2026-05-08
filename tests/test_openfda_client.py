"""Unit tests for services.openfda_client."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, patch

import httpx

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services.openfda_client import OpenFDAClient, OpenFDAUpstreamError


def _response(status_code: int, payload: dict):
    request = httpx.Request("GET", "https://api.fda.gov/drug/label.json")
    return httpx.Response(status_code=status_code, json=payload, request=request)


def test_fetch_label_by_rxcui_returns_first_result():
    client = OpenFDAClient(api_key="key-123")
    payload = {"results": [{"id": "record-1"}, {"id": "record-2"}]}

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=_response(200, payload))) as mock_get:
        result = asyncio.run(client.fetch_label_by_rxcui("153165"))

    assert result == {"id": "record-1"}
    assert mock_get.call_count == 1
    sent_params = mock_get.call_args.kwargs["params"]
    assert sent_params["search"] == "openfda.rxcui:153165"
    assert sent_params["api_key"] == "key-123"


def test_fetch_label_by_ndc_returns_none_on_404():
    client = OpenFDAClient()

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=_response(404, {}))):
        result = asyncio.run(client.fetch_label_by_ndc("0071-0156-23"))

    assert result is None


def test_fetch_retries_once_on_5xx_then_succeeds():
    client = OpenFDAClient()
    failing = _response(500, {"error": "boom"})
    succeeding = _response(200, {"results": [{"id": "ok"}]})

    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[failing, succeeding])) as mock_get:
        result = asyncio.run(client.fetch_label_by_rxcui("29046"))

    assert result == {"id": "ok"}
    assert mock_get.call_count == 2


def test_fetch_raises_after_retry_exhausted():
    client = OpenFDAClient()
    req = httpx.Request("GET", "https://api.fda.gov/drug/label.json")
    network_error = httpx.RequestError("network", request=req)

    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[network_error, network_error])):
        try:
            asyncio.run(client.fetch_label_by_rxcui("99999"))
            raised = False
        except OpenFDAUpstreamError:
            raised = True

    assert raised is True
