"""Label builds must not stop the server's event loop (the 2026-09-30 freeze)."""

import asyncio
import json
import os
import threading
import time
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

import database  # noqa: E402
from routes import details  # noqa: E402
from routes import medication_guide as guide_routes  # noqa: E402
from services import guide_runner  # noqa: E402


async def _value(v):
    return v


def test_a_blocking_label_build_leaves_the_event_loop_free():
    async def blocking_build():
        time.sleep(0.6)  # like `requests.get` to a slow DailyMed, or a wait for a database connection
        return {"ok": True}

    async def server():
        ticks = 0

        async def heartbeat():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.05)
                ticks += 1

        beat = asyncio.create_task(heartbeat())
        # FastAPI runs a plain `def` route on a worker thread, as here.
        result = await asyncio.to_thread(guide_runner.run_guide_build, blocking_build)
        beat.cancel()
        return result, ticks

    result, ticks = asyncio.run(server())
    assert result == {"ok": True}
    assert ticks >= 8  # the loop kept serving the whole time


def test_busy_when_every_slot_is_taken(monkeypatch):
    monkeypatch.setattr(guide_runner, "_slots", threading.BoundedSemaphore(1))
    monkeypatch.setattr(guide_runner, "SLOT_WAIT_SECONDS", 0.1)
    started, release = threading.Event(), threading.Event()

    async def slow_build():
        started.set()
        release.wait(2)
        return 1

    holder = threading.Thread(target=guide_runner.run_guide_build, args=(slow_build,))
    holder.start()
    assert started.wait(2)
    made = []
    with pytest.raises(guide_runner.GuideBusyError):
        guide_runner.run_guide_build(lambda: made.append("built"))
    release.set()
    holder.join(2)
    assert made == []  # a refused build is never even started
    assert guide_runner.run_guide_build(lambda: _value(5)) == 5  # the slot is free again


def _guide_app():
    app = FastAPI()
    app.include_router(guide_routes.router)
    return TestClient(app)


def test_guide_route_builds_on_a_worker_thread(monkeypatch):
    async def fake_build(**kwargs):
        time.sleep(0.05)
        return {"rxcui": kwargs["rxcui"], "include_medguide": kwargs["include_medguide"]}

    monkeypatch.setattr(guide_routes, "build_guide", fake_build)
    response = _guide_app().get("/api/drugs/153165/guide?include_medguide=true")
    assert response.status_code == 200
    assert response.json() == {"rxcui": "153165", "include_medguide": True}


def test_guide_route_answers_busy_instead_of_queueing(monkeypatch):
    def always_busy(make_build):
        raise guide_runner.GuideBusyError("busy")

    monkeypatch.setattr(guide_routes, "run_guide_build", always_busy)
    response = _guide_app().get("/api/drugs/by-setid/abc/guide")
    assert response.status_code == 503
    assert response.headers["retry-after"] == "30"


def test_dosage_route_is_a_plain_function_that_builds_off_the_loop(monkeypatch):
    row = ("Aspirin", "1191", "00000000000", None, "set-1", "TABLET", None, None)
    result = MagicMock()
    result.fetchone.return_value = row
    result.keys.return_value = [
        "medicine_name", "rxcui", "ndc11", "ndc9", "spl_set_id", "dosage_form",
        "dailymed_pharma_class_epc", "pharmclass_fda_epc",
    ]
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value.execute.return_value = result
    monkeypatch.setattr(database, "db_engine", engine)

    async def fake_resolve(pill_info):
        assert pill_info["spl_set_id"] == "set-1"
        return {"dosage_administration": " Take one tablet daily. ", "spl_set_id": "set-1"}

    monkeypatch.setattr(details, "_resolve_dosage_guide_data", fake_resolve)
    assert not asyncio.iscoroutinefunction(details.get_pill_dosage_by_slug)
    assert not asyncio.iscoroutinefunction(details.get_pill_adverse_reactions_by_slug)
    response = details.get_pill_dosage_by_slug("aspirin-81")
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["dosage_administration"] == "Take one tablet daily."
    assert body["spl_set_id"] == "set-1"
