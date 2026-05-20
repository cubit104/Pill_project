"""Tests for the probe=True / probe=False logging behaviour in _request_json."""
from __future__ import annotations

import asyncio
import logging
import os
from unittest.mock import AsyncMock, patch

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services.pricing_service import NADACPricingService, PricingServiceError


def _400_response(message: str = "Column not found.") -> httpx.Response:
    request = httpx.Request("POST", "https://data.medicaid.gov/api/1/datastore/query/mock/0")
    return httpx.Response(
        status_code=400,
        json={"message": message},
        request=request,
    )


def test_request_datastore_query_probe_true_logs_info_not_exception(caplog):
    """With probe=True a 400 must raise PricingServiceError but log at INFO only."""
    svc = NADACPricingService()

    with patch(
        "httpx.AsyncClient.request",
        new=AsyncMock(return_value=_400_response()),
    ):
        with caplog.at_level(logging.DEBUG, logger="services.pricing_service"):
            with pytest.raises(PricingServiceError):
                asyncio.run(
                    svc._request_datastore_query(
                        "mock",
                        conditions=[{"resource": "t", "property": "ndc", "value": "00002140102", "operator": "="}],
                        probe=True,
                    )
                )

    # Should have at least one INFO record about the failure.
    info_records = [r for r in caplog.records if r.levelno == logging.INFO]
    assert info_records, "Expected at least one INFO log record for a probe 400"

    # Must NOT have any ERROR record (no full traceback noise in Render logs).
    error_records = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert not error_records, f"Unexpected ERROR log records for probe 400: {error_records}"


def test_request_datastore_query_probe_false_logs_exception(caplog):
    """With probe=False (default) a 400 must raise PricingServiceError and log at ERROR."""
    svc = NADACPricingService()

    with patch(
        "httpx.AsyncClient.request",
        new=AsyncMock(return_value=_400_response()),
    ):
        with caplog.at_level(logging.DEBUG, logger="services.pricing_service"):
            with pytest.raises(PricingServiceError):
                asyncio.run(
                    svc._request_datastore_query(
                        "mock",
                        conditions=[{"resource": "t", "property": "ndc", "value": "00002140102", "operator": "="}],
                        probe=False,
                    )
                )

    error_records = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert error_records, "Expected at least one ERROR log record for non-probe 400"


def test_request_datastore_query_probe_true_non_column_error_logs_exception(caplog):
    """With probe=True, non-column 400s must remain ERROR-level."""
    svc = NADACPricingService()

    with patch(
        "httpx.AsyncClient.request",
        new=AsyncMock(return_value=_400_response(message="Bad request")),
    ):
        with caplog.at_level(logging.DEBUG, logger="services.pricing_service"):
            with pytest.raises(PricingServiceError):
                asyncio.run(
                    svc._request_datastore_query(
                        "mock",
                        conditions=[{"resource": "t", "property": "ndc", "value": "00002140102", "operator": "="}],
                        probe=True,
                    )
                )

    error_records = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert error_records, "Expected at least one ERROR log record for probe non-column 400"
