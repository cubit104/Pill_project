"""'What's missing?' tags on draft pills: set, read, clear, and who may do it."""
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
from routes.admin.auth import get_admin_user

REVIEWER = {"id": "rev-1", "email": "rev@test.com", "role": "reviewer"}
NOW = datetime(2026, 9, 13, 9, 0, tzinfo=timezone.utc)
PILL = "11111111-1111-4111-8111-111111111111"
MISSING_PILL = "22222222-2222-4222-8222-222222222222"


class _Conn:
    def __init__(self, flags, log):
        self.flags = flags  # pill_id -> (missing, note, by, at)
        self.log = log

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        s = " ".join(str(sql).lower().split())
        params = params or {}
        self.log.append((s, params))
        result = MagicMock()
        if "insert into audit_log" in s:
            return result
        if s.startswith("select 1 from pillfinder"):
            result.fetchone.return_value = (1,) if params.get("id") == PILL else None
        elif s.startswith("select missing"):
            row = self.flags.get(params.get("id"))
            result.fetchone.return_value = row
        elif s.startswith("insert into pill_review_flags"):
            result.fetchone.return_value = (params["missing"], params["note"], params["by"], NOW)
        elif s.startswith("delete from pill_review_flags"):
            result.rowcount = 1 if params.get("id") in self.flags else 0
        return result


@contextmanager
def _client(flags=None, admin=REVIEWER):
    log: list = []
    conn = _Conn(dict(flags or {}), log)
    engine = MagicMock()

    @contextmanager
    def cm():
        yield conn

    engine.connect.side_effect = cm
    engine.begin.side_effect = cm
    if admin is not None:
        app_module.app.dependency_overrides[get_admin_user] = lambda: admin
    original = database.db_engine
    database.db_engine = engine
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
            with TestClient(app_module.app) as client:
                yield client, log
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


def test_requires_admin():
    with _client(admin=None) as (client, _):
        assert client.get(f"/api/admin/pills/{PILL}/review-flags").status_code == 401


def test_get_is_empty_until_flagged():
    with _client() as (client, _):
        assert client.get(f"/api/admin/pills/{PILL}/review-flags").json() == {
            "missing": [], "note": None, "flagged_by": None, "flagged_at": None,
        }
    with _client(flags={PILL: (["images"], "no back photo", "ed@test.com", NOW)}) as (client, _):
        body = client.get(f"/api/admin/pills/{PILL}/review-flags").json()
    assert body["missing"] == ["images"] and body["note"] == "no back photo" and body["flagged_by"] == "ed@test.com"
    assert body["flagged_at"].startswith("2026-09-13")


def test_reviewer_can_flag_and_tags_are_deduped_in_fixed_order():
    with _client() as (client, log):
        resp = client.put(
            f"/api/admin/pills/{PILL}/review-flags",
            json={"missing": ["other", "images", "images"], "note": "  needs the 5 mg strength "},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["missing"] == ["images", "other"] and body["note"] == "needs the 5 mg strength"
    assert body["flagged_by"] == "rev@test.com"
    upsert = next(p for s, p in log if s.startswith("insert into pill_review_flags"))
    assert upsert["missing"] == ["images", "other"] and upsert["by"] == "rev@test.com"
    audit = next(p for s, p in log if "insert into audit_log" in s)
    assert audit["action"] == "pill_flagged" and audit["entity_id"] == PILL


def test_nothing_ticked_still_marks_the_pill_as_opened():
    with _client() as (client, log):
        resp = client.put(f"/api/admin/pills/{PILL}/review-flags", json={})
    assert resp.status_code == 200 and resp.json()["missing"] == [] and resp.json()["flagged_at"]
    assert any(s.startswith("insert into pill_review_flags") for s, _ in log)


def test_validation():
    with _client() as (client, _):
        bad = client.put(f"/api/admin/pills/{PILL}/review-flags", json={"missing": ["photos"]})
        assert bad.status_code == 422 and "photos" in bad.json()["detail"]
        assert client.put(f"/api/admin/pills/{MISSING_PILL}/review-flags", json={"missing": ["images"]}).status_code == 404
        assert client.put("/api/admin/pills/not-a-uuid/review-flags", json={"missing": []}).status_code == 422


def test_clear_removes_row_and_audits():
    with _client(flags={PILL: (["imprint"], None, "rev@test.com", NOW)}) as (client, log):
        resp = client.delete(f"/api/admin/pills/{PILL}/review-flags")
    assert resp.status_code == 200 and resp.json()["cleared"] is True
    assert any(s.startswith("delete from pill_review_flags") for s, _ in log)
    assert any(p.get("action") == "pill_flags_cleared" for _, p in log)


def test_clear_is_idempotent():
    with _client() as (client, log):
        resp = client.delete(f"/api/admin/pills/{PILL}/review-flags")
    assert resp.status_code == 200 and resp.json()["cleared"] is False
    assert not any("insert into audit_log" in s for s, _ in log)
