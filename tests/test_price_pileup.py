"""Price lookups can no longer pile up until the server runs out of memory (the 2026-09-24 outages).

The price card's "strengths" call asked RxNav about every related product of a drug at once, on every visit,
and each call waiting for a connection was retried. These check the limits that stop that.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from routes import prices  # noqa: E402
from services import pricing_service as ps  # noqa: E402
from services.pricing_service import NADACPricingService, PricingBusyError, PricingServiceError  # noqa: E402


def _json_response(payload: dict, url: str = "https://example.test") -> httpx.Response:
    return httpx.Response(200, json=payload, request=httpx.Request("GET", url))


def test_calls_beyond_the_waiting_line_fail_at_once():
    svc = NADACPricingService()
    release = asyncio.Event()
    calls = 0

    async def slow_get(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        await release.wait()
        return _json_response({"ok": True})

    async def scenario():
        with patch.object(ps, "OUTBOUND_CONCURRENCY", 1), patch.object(ps, "OUTBOUND_MAX_WAITING", 1), patch(
            "httpx.AsyncClient.get", new=slow_get
        ):
            first = asyncio.create_task(svc._request_json("https://example.test/1"))  # in flight
            await asyncio.sleep(0)
            second = asyncio.create_task(svc._request_json("https://example.test/2"))  # waits in line
            await asyncio.sleep(0)
            with pytest.raises(PricingBusyError):
                await svc._request_json("https://example.test/3")  # line full: refused at once
            assert calls == 1
            release.set()
            assert await first == {"ok": True}
            assert await second == {"ok": True}
        await svc.close()

    asyncio.run(scenario())


def test_a_full_connection_pool_is_not_retried():
    svc = NADACPricingService()
    get = AsyncMock(side_effect=httpx.PoolTimeout("pool full"))
    with patch("httpx.AsyncClient.get", new=get), pytest.raises(PricingServiceError):
        asyncio.run(svc._request_json("https://example.test"))
    assert get.await_count == 1  # it used to try three times, with pauses, while still holding memory
    asyncio.run(svc.close())


def test_rxnav_answers_are_remembered():
    svc = NADACPricingService()
    get = AsyncMock(return_value=_json_response({"ndcStatus": {"rxcui": "861004"}}))
    with patch("httpx.AsyncClient.get", new=get):
        assert asyncio.run(svc._ndc_to_rxcui("00591566101")) == "861004"
        assert asyncio.run(svc._ndc_to_rxcui("00591566101")) == "861004"
        assert asyncio.run(svc._ndc_to_rxcui("00093721401")) == "861004"  # another NDC is its own question
    assert get.await_count == 2
    asyncio.run(svc.close())


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _Engine:
    """drug_prices first, then pillfinder, as get_ndc_strengths asks."""

    def __init__(self, ndcs):
        self.ndcs = ndcs
        self.queries = 0

    @contextmanager
    def connect(self):
        engine = self

        class Conn:
            def execute(self, sql, params=None):
                engine.queries += 1
                if "FROM drug_prices" in str(sql):
                    return _Rows([{"ndc": n, "price_per_unit": 0.1, "unit": "EA", "effective_date": "2026-09-17"} for n in engine.ndcs])
                return _Rows([{"slug": f"pill-{n}", "medicine_name": "Metformin", "spl_strength": f"{i + 1}00 mg", "ndc_digits": n} for i, n in enumerate(engine.ndcs)])

        yield Conn()


def test_strengths_are_capped_throttled_and_kept_for_the_ingredient():
    prices._strengths_cache.clear()
    in_flight = 0
    most_at_once = 0
    asked: list[str] = []

    async def ndcs_for(rxcui: str) -> list[str]:
        nonlocal in_flight, most_at_once
        asked.append(rxcui)
        in_flight += 1
        most_at_once = max(most_at_once, in_flight)
        await asyncio.sleep(0.001)
        in_flight -= 1
        return ["00591566101"] if rxcui == "p0" else ["00093721401"] if rxcui == "p1" else []

    related = [{"rxcui": f"p{i}", "name": f"product {i}", "tty": "SCD"} for i in range(60)]
    engine = _Engine(["00591566101", "00093721401"])
    svc = prices.pricing_service
    with patch.object(svc, "_ndc_to_rxcui", new=AsyncMock(return_value="861004")), patch.object(
        svc, "_ingredient_for_rxcui", new=AsyncMock(return_value={"name": "Metformin", "rxcui": "6809"})
    ), patch.object(svc, "_related_product_rxcuis", new=AsyncMock(return_value=related)) as related_mock, patch.object(
        svc, "_ndcs_for_rxcui", new=ndcs_for
    ), patch.object(prices.database, "db_engine", engine):
        first = asyncio.run(prices.get_ndc_strengths("00591-5661-01"))
        second = asyncio.run(prices.get_ndc_strengths("00093-7214-01"))  # another pill of the same ingredient

    assert len(asked) == ps.MAX_RELATED_RXCUIS  # 60 related products, 40 asked
    assert most_at_once <= prices.STRENGTHS_NDC_LOOKUPS_AT_ONCE
    assert related_mock.await_count == 1 and engine.queries == 2  # the second visit asked nobody
    assert [s["ndc"] for s in first["strengths"]] == ["00591566101", "00093721401"]
    assert [s["is_current"] for s in first["strengths"]] == [True, False]
    assert second["ndc"] == "00093721401" and [s["is_current"] for s in second["strengths"]] == [False, True]
    prices._strengths_cache.clear()


def test_a_partial_strengths_list_is_not_kept():
    prices._strengths_cache.clear()
    svc = prices.pricing_service

    async def ndcs_for(rxcui: str) -> list[str]:
        if rxcui == "p1":
            raise PricingBusyError("busy")
        return ["00591566101"]

    with patch.object(svc, "_ndc_to_rxcui", new=AsyncMock(return_value="861004")), patch.object(
        svc, "_ingredient_for_rxcui", new=AsyncMock(return_value={"name": "Metformin", "rxcui": "6809"})
    ), patch.object(svc, "_related_product_rxcuis", new=AsyncMock(return_value=[{"rxcui": "p0"}, {"rxcui": "p1"}])), patch.object(
        svc, "_ndcs_for_rxcui", new=ndcs_for
    ), patch.object(prices.database, "db_engine", _Engine(["00591566101"])):
        result = asyncio.run(prices.get_ndc_strengths("00591-5661-01"))
    assert [s["ndc"] for s in result["strengths"]] == ["00591566101"]
    assert "6809" not in prices._strengths_cache
