"""Client for RxNorm approximate term lookups."""

from __future__ import annotations

from typing import Any

import httpx

RXNORM_APPROXIMATE_URL = "https://rxnav.nlm.nih.gov/REST/approximateTerm.json"


class RxNormClient:
    """Thin client around RxNorm approximateTerm endpoint."""

    def __init__(self) -> None:
        """Initialize timeout configuration."""
        self.timeout = httpx.Timeout(10.0)

    async def search(self, term: str, limit: int = 10) -> list[dict[str, Any]]:
        """Search RxNorm and return a list of candidate results."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                RXNORM_APPROXIMATE_URL,
                params={"term": term, "maxEntries": limit},
            )
        response.raise_for_status()
        payload = response.json()
        group = payload.get("approximateGroup") or {}
        candidates = group.get("candidate") or []

        results: list[dict[str, Any]] = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            rxcui = candidate.get("rxcui")
            if not rxcui:
                continue
            score_raw = candidate.get("score", 0)
            try:
                score = int(score_raw)
            except (TypeError, ValueError):
                score = 0

            results.append(
                {
                    "rxcui": str(rxcui),
                    "name": candidate.get("rxstr") or candidate.get("name") or candidate.get("term") or "",
                    "score": score,
                }
            )

        return results
