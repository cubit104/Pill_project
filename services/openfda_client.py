"""Async client for openFDA drug label lookups."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"


class OpenFDAUpstreamError(RuntimeError):
    """Raised when openFDA fails after retry attempts."""


class OpenFDAClient:
    """Thin async client for openFDA /drug/label.json queries."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        """Initialize client configuration.

        Args:
            api_key: Optional openFDA API key for higher rate limits.
        """
        self.api_key = api_key or os.getenv("OPENFDA_API_KEY") or None
        self.timeout = httpx.Timeout(connect=10.0, read=20.0, write=20.0, pool=20.0)

    async def fetch_label_by_rxcui(self, rxcui: str) -> Optional[dict[str, Any]]:
        """Fetch one label by RxCUI — prefers records with a medication_guide field."""
        try:
            result = await self._fetch_label(search=f"openfda.rxcui:{rxcui} AND _exists_:medication_guide")
            if result is not None:
                return result
        except OpenFDAUpstreamError:
            logger.debug(
                "medication_guide filter failed for rxcui=%s, falling back to plain search",
                rxcui,
            )
        return await self._fetch_label(search=f"openfda.rxcui:{rxcui}")

    async def fetch_label_by_ndc(self, ndc: str) -> Optional[dict[str, Any]]:
        """Fetch one label by NDC — prefers records with a medication_guide field."""
        escaped_ndc = ndc.replace('"', '\\"')
        try:
            result = await self._fetch_label(
                search=f'openfda.product_ndc:"{escaped_ndc}" AND _exists_:medication_guide'
            )
            if result is not None:
                return result
        except OpenFDAUpstreamError:
            logger.debug(
                "medication_guide filter failed for ndc=%s, falling back to plain search",
                ndc,
            )
        return await self._fetch_label(search=f'openfda.product_ndc:"{escaped_ndc}"')

    async def _fetch_label(self, search: str) -> Optional[dict[str, Any]]:
        """Fetch one openFDA label record with a single retry on transient errors."""
        params: dict[str, Any] = {"search": search, "limit": 1}
        if self.api_key:
            params["api_key"] = self.api_key

        last_error: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(OPENFDA_LABEL_URL, params=params)

                if response.status_code == 404:
                    return None

                if response.status_code >= 400:
                    response.raise_for_status()

                payload = response.json()
                results = payload.get("results") or []
                return results[0] if results else None
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status_code = exc.response.status_code if exc.response else None
                if status_code is not None and 500 <= status_code < 600:
                    logger.warning("openFDA 5xx response (%s) for search=%s", status_code, search)
                else:
                    break
                if attempt == 0:
                    await asyncio.sleep(1)
                    continue
                break
            except httpx.RequestError as exc:
                last_error = exc
                if attempt == 0:
                    await asyncio.sleep(1)
                    continue
                break

        raise OpenFDAUpstreamError(f"openFDA request failed for search '{search}'") from (
            last_error or RuntimeError("openFDA request failed")
        )
