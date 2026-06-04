from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from scripts import refresh_pill_price_snapshots as mod


def test_parse_args_concurrency_defaults_and_override():
    args_default = mod._parse_args([])
    assert args_default.concurrency == 20

    args_custom = mod._parse_args(["--concurrency", "7"])
    assert args_custom.concurrency == 7


def test_run_processes_pills_concurrently_and_tracks_summary():
    rows = [
        {"slug": "pill-a"},
        {"slug": "pill-b"},
        {"slug": "pill-fail"},
    ]
    state = {"in_flight": 0, "max_in_flight": 0}

    async def fake_resolve(pill):
        state["in_flight"] += 1
        state["max_in_flight"] = max(state["max_in_flight"], state["in_flight"])
        try:
            await asyncio.sleep(0.01)
            if pill["slug"] == "pill-fail":
                raise RuntimeError("boom")
            return {
                "slug": pill["slug"],
                "match_type": "exact",
                "resolved_via": "test",
                "price_per_unit": 1.23,
            }
        finally:
            state["in_flight"] -= 1

    args = SimpleNamespace(
        slug=None,
        limit=None,
        offset=0,
        only_missing=False,
        force=True,
        dry_run=False,
        concurrency=2,
    )

    with (
        patch.object(mod, "_select_pills", return_value=rows),
        patch.object(mod, "resolve_pill_to_snapshot", new=fake_resolve),
        patch.object(mod, "_upsert_snapshot") as upsert_mock,
    ):
        summary = asyncio.run(mod._run(args))

    assert summary == {"processed": 3, "updated": 2, "errors": 1, "dry_run": False}
    assert upsert_mock.call_count == 2
    assert state["max_in_flight"] >= 2


def test_run_dry_run_does_not_count_updates_or_write_snapshots():
    rows = [{"slug": "pill-a"}]

    async def fake_resolve(pill):
        return {
            "slug": pill["slug"],
            "match_type": "exact",
            "resolved_via": "test",
            "price_per_unit": 1.23,
        }

    args = SimpleNamespace(
        slug=None,
        limit=None,
        offset=0,
        only_missing=False,
        force=True,
        dry_run=True,
        concurrency=2,
    )

    with (
        patch.object(mod, "_select_pills", return_value=rows),
        patch.object(mod, "resolve_pill_to_snapshot", new=fake_resolve),
        patch.object(mod.asyncio, "to_thread", new_callable=AsyncMock) as to_thread_mock,
    ):
        summary = asyncio.run(mod._run(args))

    assert summary == {"processed": 1, "updated": 0, "errors": 0, "dry_run": True}
    to_thread_mock.assert_not_awaited()


def test_run_base_exception_does_not_crash_batch():
    """A BaseException raised inside process_one must not kill the whole batch."""
    rows = [
        {"slug": "pill-ok"},
        {"slug": "pill-cancelled"},
        {"slug": "pill-ok-2"},
    ]

    async def fake_resolve(pill):
        if pill["slug"] == "pill-cancelled":
            raise asyncio.CancelledError("simulated cancellation")
        return {
            "slug": pill["slug"],
            "match_type": "exact",
            "resolved_via": "test",
            "price_per_unit": 1.23,
        }

    args = SimpleNamespace(
        slug=None,
        limit=None,
        offset=0,
        only_missing=False,
        force=True,
        dry_run=False,
        concurrency=3,
    )

    with (
        patch.object(mod, "_select_pills", return_value=rows),
        patch.object(mod, "resolve_pill_to_snapshot", new=fake_resolve),
        patch.object(mod, "_upsert_snapshot"),
    ):
        summary = asyncio.run(mod._run(args))

    assert summary["processed"] == 3
    assert summary["updated"] == 2
    assert summary["errors"] == 1


def test_run_writes_snapshots_via_to_thread():
    rows = [{"slug": "pill-a"}]

    async def fake_resolve(pill):
        return {
            "slug": pill["slug"],
            "match_type": "exact",
            "resolved_via": "test",
            "price_per_unit": 1.23,
        }

    async def fake_to_thread(func, *args):
        func(*args)

    args = SimpleNamespace(
        slug=None,
        limit=None,
        offset=0,
        only_missing=False,
        force=True,
        dry_run=False,
        concurrency=1,
    )

    with (
        patch.object(mod, "_select_pills", return_value=rows),
        patch.object(mod, "resolve_pill_to_snapshot", new=fake_resolve),
        patch.object(mod.asyncio, "to_thread", side_effect=fake_to_thread) as to_thread_mock,
        patch.object(mod, "_upsert_snapshot") as upsert_mock,
    ):
        summary = asyncio.run(mod._run(args))

    assert summary == {"processed": 1, "updated": 1, "errors": 0, "dry_run": False}
    to_thread_mock.assert_awaited_once()
    upsert_mock.assert_called_once()
