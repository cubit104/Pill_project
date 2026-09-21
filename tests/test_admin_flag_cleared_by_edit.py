"""A save on a flagged draft pill clears the "what's missing?" tags, unless the flagger did the saving."""
from __future__ import annotations

import os
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient

import database
import main as app_module
from routes.admin.auth import get_admin_user

REVIEWER = {"id": "rev-1", "email": "Rev@test.com", "role": "reviewer"}
EDITOR = {"id": "ed-1", "email": "ed@test.com", "role": "editor"}
PILL = "11111111-1111-4111-8111-111111111111"


class _Row(tuple):
    _fields = ("id", "slug", "splimprint")


class _Conn:
    """Enough of a connection for update_pill: the pill exists, one flag row set by the reviewer."""

    def __init__(self, log):
        self.log = log
        self.flag_by = "rev@test.com"

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        s = " ".join(str(sql).lower().split())
        params = params or {}
        self.log.append((s, params))
        result = MagicMock()
        if s.startswith("select updated_at, published, slug from pillfinder"):
            result.fetchone.return_value = (None, False, "amoxicillin-x-1")
        elif s.startswith("select * from pillfinder"):
            result.fetchone.return_value = _Row((PILL, "amoxicillin-x-1", "X 1"))
        elif s.startswith("delete from pill_review_flags") and "returning" in s:
            same = (params.get("email") or "").lower() == self.flag_by
            result.fetchone.return_value = None if same else (["images"], "add photos", self.flag_by)
        return result


@contextmanager
def _client(admin):
    log: list = []
    conn = _Conn(log)
    engine = MagicMock()

    @contextmanager
    def cm():
        yield conn

    engine.connect.side_effect = cm
    engine.begin.side_effect = cm
    app_module.app.dependency_overrides[get_admin_user] = lambda: admin
    original = database.db_engine
    database.db_engine = engine
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None), patch(
            "routes.admin.pills._best_effort_ensure_synonym_mapping", return_value=None
        ), patch("routes.admin.pills.can_submit_pill_slug_to_indexnow", return_value=False):
            with TestClient(app_module.app) as client:
                yield client, log
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


def _flag_deletes(log):
    return [(s, p) for s, p in log if s.startswith("delete from pill_review_flags")]


def _audit_actions(log):
    return [p.get("action") for s, p in log if "insert into audit_log" in s]


def test_editor_save_clears_the_reviewers_flag():
    with _client(EDITOR) as (client, log):
        r = client.put(f"/api/admin/pills/{PILL}", json={"splimprint": "X 1"})
    assert r.status_code == 200, r.text
    deletes = _flag_deletes(log)
    assert len(deletes) == 1
    assert "flagged_by" in deletes[0][0] and deletes[0][1]["email"] == "ed@test.com"
    assert "pill_flag_cleared_by_edit" in _audit_actions(log)


def test_flaggers_own_save_keeps_the_flag():
    with _client(REVIEWER) as (client, log):
        r = client.put(f"/api/admin/pills/{PILL}", json={"splimprint": "X 1"})
    assert r.status_code == 200, r.text
    assert len(_flag_deletes(log)) == 1  # the guarded delete runs, matches nothing
    assert "pill_flag_cleared_by_edit" not in _audit_actions(log)


def test_publishing_clears_unconditionally():
    with _client(REVIEWER) as (client, log):
        r = client.put(f"/api/admin/pills/{PILL}?publish=true", json={"splimprint": "X 1"})
    assert r.status_code == 200, r.text
    deletes = _flag_deletes(log)
    assert len(deletes) == 1 and "flagged_by" not in deletes[0][0]
