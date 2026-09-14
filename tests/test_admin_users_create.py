"""Admin "Add user": the profile row must carry the email (NOT NULL since the
member-accounts migration) and a failed role write must not report success."""
import os
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

import database
import main as app_module
from routes.admin.auth import get_admin_user

SUPER = {"id": "00000000-0000-0000-0000-000000000001", "email": "boss@pillseek.com", "role": "superuser"}
NEW_ID = "b1c33526-bd08-47a0-80e4-16602218ab07"


class _Conn:
    def __init__(self, log, fail=False):
        self.log, self.fail = log, fail

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        self.log.append((str(sql), params or {}))
        if self.fail and "INSERT INTO profiles" in str(sql):
            raise SQLAlchemyError("null value in column \"email\"")
        return MagicMock()


@contextmanager
def _client(monkeypatch, fail=False):
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    log: list = []
    engine = MagicMock()

    @contextmanager
    def begin():
        yield _Conn(log, fail)

    engine.begin = begin
    created = MagicMock(status_code=201)
    created.json.return_value = {"id": NEW_ID, "email": "new@pillseek.com"}
    original = database.db_engine
    database.db_engine = engine
    app_module.app.dependency_overrides[get_admin_user] = lambda: SUPER
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None), \
                patch("routes.admin.users._sb_post", return_value=created):
            with TestClient(app_module.app) as client:
                yield client, log
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


def test_add_user_writes_the_email_and_role(monkeypatch):
    with _client(monkeypatch) as (client, log):
        resp = client.post(
            "/api/admin/users",
            json={"email": "new@pillseek.com", "password": "Secret-12345", "role": "reviewer"},
            headers={"Authorization": "Bearer test-token"},
        )
    assert resp.status_code == 201, resp.text
    assert resp.json() == {"id": NEW_ID, "email": "new@pillseek.com", "role": "reviewer", "created": True}
    inserts = [(s, p) for s, p in log if "INSERT INTO profiles" in s]
    assert len(inserts) == 1
    sql, params = inserts[0]
    assert "email" in sql and "ON CONFLICT (id) DO UPDATE" in sql
    assert params["email"] == "new@pillseek.com" and params["role"] == "reviewer" and params["id"] == NEW_ID
    assert any("audit_log" in s for s, _ in log)


def test_add_user_reports_a_failed_role_write(monkeypatch):
    with _client(monkeypatch, fail=True) as (client, _log):
        resp = client.post(
            "/api/admin/users",
            json={"email": "new@pillseek.com", "password": "Secret-12345", "role": "reviewer"},
            headers={"Authorization": "Bearer test-token"},
        )
    assert resp.status_code == 502
    assert "member" in resp.json()["detail"]
