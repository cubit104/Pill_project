"""Tests for the admin NDC backfill API endpoints."""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


# ---------------------------------------------------------------------------
# Re-use auth helpers from test_admin_api
# ---------------------------------------------------------------------------

FAKE_USER_PAYLOAD = {"id": "00000000-0000-0000-0000-000000000001", "email": "super@test.com"}
FAKE_SUPERUSER_PROFILE = ("superuser",)
FAKE_EDITOR_PROFILE = ("editor",)

MOCK_SUMMARY = {
    "processed": 2,
    "updated": 1,
    "skipped_multi": 0,
    "skipped_none": 1,
    "errors": 0,
    "dry_run": False,
    "rows": [],
}

MOCK_DRY_SUMMARY = {**MOCK_SUMMARY, "dry_run": True}


def _make_auth_engine(profile_row):
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    def _execute(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "profiles" in sql_str and "user_role" in sql_str:
            result.fetchone.return_value = profile_row
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = _execute
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


def _auth_headers():
    return {"Authorization": "Bearer fake-token"}


# ---------------------------------------------------------------------------
# Helper: patch JWT + DB for a request
# ---------------------------------------------------------------------------

def _patched_request(client, method, url, profile_row, mock_summary=MOCK_SUMMARY, **kwargs):
    import database as db_module

    engine = _make_auth_engine(profile_row)
    db_module.db_engine = engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
         patch("services.ndc_backfill.run_backfill", return_value=mock_summary):
        resp = getattr(client, method)(url, headers=_auth_headers(), **kwargs)
    return resp


# ---------------------------------------------------------------------------
# Preview endpoint tests
# ---------------------------------------------------------------------------

class TestPreviewEndpoint:
    def test_returns_200_for_superuser(self, client):
        resp = _patched_request(
            client, "get", "/api/admin/backfill/ndc/preview",
            FAKE_SUPERUSER_PROFILE, MOCK_DRY_SUMMARY,
        )
        assert resp.status_code == 200

    def test_returns_json_summary(self, client):
        resp = _patched_request(
            client, "get", "/api/admin/backfill/ndc/preview",
            FAKE_SUPERUSER_PROFILE, MOCK_DRY_SUMMARY,
        )
        data = resp.json()
        assert "processed" in data
        assert "updated" in data
        assert data["dry_run"] is True

    def test_non_superuser_gets_403(self, client):
        import database as db_module
        engine = _make_auth_engine(FAKE_EDITOR_PROFILE)
        db_module.db_engine = engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.get(
                "/api/admin/backfill/ndc/preview",
                headers=_auth_headers(),
            )
        assert resp.status_code == 403

    def test_unauthenticated_gets_401(self, client):
        resp = client.get("/api/admin/backfill/ndc/preview")
        assert resp.status_code == 401

    def test_limit_out_of_range_gets_422(self, client):
        import database as db_module
        engine = _make_auth_engine(FAKE_SUPERUSER_PROFILE)
        db_module.db_engine = engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.get(
                "/api/admin/backfill/ndc/preview?limit=999",
                headers=_auth_headers(),
            )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Run endpoint tests
# ---------------------------------------------------------------------------

class TestRunEndpoint:
    def test_returns_200_for_superuser(self, client):
        resp = _patched_request(
            client, "post", "/api/admin/backfill/ndc/run",
            FAKE_SUPERUSER_PROFILE,
        )
        assert resp.status_code == 200

    def test_returns_summary_counts(self, client):
        resp = _patched_request(
            client, "post", "/api/admin/backfill/ndc/run",
            FAKE_SUPERUSER_PROFILE,
        )
        data = resp.json()
        assert "processed" in data
        assert "updated" in data
        assert "errors" in data
        assert data["dry_run"] is False

    def test_non_superuser_gets_403(self, client):
        import database as db_module
        engine = _make_auth_engine(FAKE_EDITOR_PROFILE)
        db_module.db_engine = engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.post(
                "/api/admin/backfill/ndc/run",
                headers=_auth_headers(),
            )
        assert resp.status_code == 403

    def test_unauthenticated_gets_401(self, client):
        resp = client.post("/api/admin/backfill/ndc/run")
        assert resp.status_code == 401

    def test_limit_out_of_range_gets_422(self, client):
        import database as db_module
        engine = _make_auth_engine(FAKE_SUPERUSER_PROFILE)
        db_module.db_engine = engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.post(
                "/api/admin/backfill/ndc/run?limit=9999",
                headers=_auth_headers(),
            )
        assert resp.status_code == 422
