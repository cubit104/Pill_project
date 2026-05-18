from __future__ import annotations

from unittest.mock import patch

import httpx

from scripts import prewarm_price_cache as mod


def test_prewarm_hits_price_endpoint_and_counts_warmed_rows():
    calls: list[str] = []

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def get(self, url: str):
            calls.append(url)
            if "/api/pill/" in url:
                return httpx.Response(200, json={"ndc": "00002140102"}, request=httpx.Request("GET", url))
            if "/api/prices/" in url:
                return httpx.Response(
                    200,
                    json={"ok": True},
                    headers={"X-Price-Cache": "miss"},
                    request=httpx.Request("GET", url),
                )
            return httpx.Response(404, request=httpx.Request("GET", url))

    with patch.object(mod, "_top_slugs", return_value=["plavix-75-1171"]), \
         patch.object(mod.httpx, "Client", return_value=_Client()):
        summary = mod._prewarm(limit=1, api_base="http://localhost:8000")

    assert summary["requested"] == 1
    assert summary["warmed"] == 1
    assert any(path.endswith("/api/prices/00002140102") for path in calls)
