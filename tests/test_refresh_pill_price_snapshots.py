from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import patch

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
