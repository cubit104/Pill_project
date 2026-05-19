from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient

import database
import main as app_module
from routes.admin.auth import get_admin_user


class _Pool:
    _max_overflow = 2

    def size(self):
        return 5

    def checkedout(self):
        return 3

    def overflow(self):
        return 0

    def checkedin(self):
        return 2


class _Url:
    drivername = "postgresql"
    host = "aws-0-us-east-1.pooler.supabase.com"
    port = 6543
    database = "postgres"


class _Engine:
    pool = _Pool()
    url = _Url()


def test_admin_db_pool_route_returns_expected_keys():
    app_module.app.dependency_overrides[get_admin_user] = lambda: {"email": "admin@test.com", "role": "superuser"}
    original_engine = database.db_engine
    database.db_engine = _Engine()
    try:
        with TestClient(app_module.app) as client:
            response = client.get("/api/admin/db/pool")
    finally:
        database.db_engine = original_engine
        app_module.app.dependency_overrides.pop(get_admin_user, None)

    assert response.status_code == 200
    payload = response.json()
    assert set(payload.keys()) == {
        "pool_size",
        "checked_out",
        "overflow",
        "checked_in",
        "max_overflow",
        "total",
        "engine_url_redacted",
    }


def test_admin_db_pool_route_redacts_url():
    app_module.app.dependency_overrides[get_admin_user] = lambda: {"email": "admin@test.com", "role": "superuser"}
    original_engine = database.db_engine
    database.db_engine = _Engine()
    try:
        with TestClient(app_module.app) as client:
            response = client.get("/api/admin/db/pool")
    finally:
        database.db_engine = original_engine
        app_module.app.dependency_overrides.pop(get_admin_user, None)

    assert response.status_code == 200
    redacted = response.json()["engine_url_redacted"]
    assert redacted == "postgresql://***@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
    assert "test:test" not in redacted
