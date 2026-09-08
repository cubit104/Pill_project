"""Admin members endpoints: list public accounts, deactivate / reactivate."""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient

import database
import main as app_module
from routes.admin.auth import require_superuser

SUPER = {"id": "admin-1", "email": "super@test.com", "role": "superuser"}
NOW = datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)


class _Conn:
    """Fake connection: answers by looking at the SQL text."""

    def __init__(self, members, log):
        self.members = members
        self.log = log

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        s = str(sql).lower().strip()
        self.log.append((s, params or {}))
        result = MagicMock()
        if "insert into audit_log" in s:
            return result
        if s.startswith("select count(*),"):
            result.fetchone.return_value = (len(self.members), 2, 1, 1, 1)
        elif s.startswith("select count(*)"):
            result.scalar.return_value = len(self.members)
        elif s.startswith("select u.email"):
            wanted = (params or {}).get("id")
            match = [m for m in self.members if m[0] == wanted]
            result.fetchone.return_value = (match[0][1],) if match else None
        else:
            result.fetchall.return_value = self.members
        return result


def _engine(members, log):
    engine = MagicMock()
    conn = _Conn(members, log)

    @contextmanager
    def cm():
        yield conn

    engine.connect.side_effect = cm
    engine.begin.side_effect = cm
    return engine


MEMBERS = [
    ("u-1", "amy@example.com", NOW, NOW, False, 3, 1),
    ("u-2", "bob@example.com", NOW, None, True, 0, 0),
]


@contextmanager
def _client(members=MEMBERS):
    log: list = []
    app_module.app.dependency_overrides[require_superuser] = lambda: SUPER
    original = database.db_engine
    database.db_engine = _engine(members, log)
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
            with TestClient(app_module.app) as client:
                yield client, log
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(require_superuser, None)


def test_list_members_returns_summary_and_rows():
    with _client() as (client, log):
        resp = client.get("/api/admin/members")
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"] == {"total": 2, "active": 2, "new_7d": 1, "signed_in_30d": 1, "with_cabinet": 1}
    assert body["filtered"] == 2
    assert [m["email"] for m in body["members"]] == ["amy@example.com", "bob@example.com"]
    amy = body["members"][0]
    assert amy["cabinet_count"] == 3 and amy["reminder_count"] == 1 and amy["disabled"] is False
    assert amy["created_at"].startswith("2026-09-08")
    assert body["members"][1]["disabled"] is True
    # Only member rows are ever selected; cabinet contents are never queried.
    list_sql = [s for s, _ in log if "from auth.users" in s]
    assert list_sql and all("role::text = 'member'" in s for s in list_sql)
    assert not any("slug" in s for s, _ in log)


def test_list_members_filters_by_email():
    with _client() as (client, log):
        resp = client.get("/api/admin/members?q=Amy&page=2&limit=10")
    assert resp.status_code == 200
    list_call = next((s, p) for s, p in log if "order by u.created_at" in s)
    assert "ilike :pattern" in list_call[0]
    assert list_call[1] == {"pattern": "%amy%", "limit": 10, "offset": 10}
    assert resp.json()["page"] == 2


def test_deactivate_member_bans_and_audits():
    with patch("routes.admin.members._sb_put") as sb_put, patch("routes.admin.members._supabase_url", return_value="https://x.supabase.co"):
        sb_put.return_value = MagicMock(status_code=200)
        with _client() as (client, log):
            resp = client.post("/api/admin/members/u-1/deactivate")
    assert resp.status_code == 200
    assert resp.json() == {"id": "u-1", "disabled": True}
    sb_put.assert_called_once_with("/auth/v1/admin/users/u-1", {"ban_duration": "876600h"})
    audit = [p for s, p in log if "insert into audit_log" in s]
    assert audit and audit[0]["action"] == "deactivate_member"


def test_reactivate_member_lifts_ban():
    with patch("routes.admin.members._sb_put") as sb_put, patch("routes.admin.members._supabase_url", return_value="https://x.supabase.co"):
        sb_put.return_value = MagicMock(status_code=200)
        with _client() as (client, _log):
            resp = client.post("/api/admin/members/u-2/reactivate")
    assert resp.status_code == 200
    sb_put.assert_called_once_with("/auth/v1/admin/users/u-2", {"ban_duration": "none"})


def test_deactivate_unknown_or_admin_account_is_404():
    """Admin accounts are not members, so the lookup finds nothing and nothing is banned."""
    with patch("routes.admin.members._sb_put") as sb_put, patch("routes.admin.members._supabase_url", return_value="https://x.supabase.co"):
        with _client() as (client, _log):
            resp = client.post("/api/admin/members/admin-9/deactivate")
    assert resp.status_code == 404
    sb_put.assert_not_called()


def test_supabase_failure_is_502():
    with patch("routes.admin.members._sb_put") as sb_put, patch("routes.admin.members._supabase_url", return_value="https://x.supabase.co"):
        sb_put.return_value = MagicMock(status_code=500)
        with _client() as (client, _log):
            resp = client.post("/api/admin/members/u-1/deactivate")
    assert resp.status_code == 502


def test_requires_superuser():
    """Without the override the real guard runs and rejects an anonymous call."""
    original = database.db_engine
    database.db_engine = MagicMock()
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
            with TestClient(app_module.app) as client:
                resp = client.get("/api/admin/members")
    finally:
        database.db_engine = original
    assert resp.status_code in (401, 403)
