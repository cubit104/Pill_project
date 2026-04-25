"""Tests for the admin analytics API endpoints.

Tests cover:
- Auth gating (401/403 without a valid token or admin role)
- ``configured: false`` responses when env vars are absent
- Page-health endpoint basic functionality
"""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

FAKE_USER_PAYLOAD = {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@test.com"}
FAKE_SUPERUSER_PROFILE = ("superuser",)
FAKE_EDITOR_PROFILE = ("editor",)
AUTH_HEADERS = {"Authorization": "Bearer fake-token"}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_auth_engine(profile_row=FAKE_SUPERUSER_PROFILE, fetchall_result=None):
    """Return a mock SQLAlchemy engine for auth + optional DB data."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    def _execute(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "profiles" in sql_str and "where id" in sql_str:
            # Profile-based auth lookup: SELECT role FROM profiles WHERE id = :id
            result.fetchone.return_value = profile_row
            result.fetchall.return_value = []
        elif "admin_users" in sql_str:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
        else:
            # Business query (page health scan, etc.)
            result.fetchone.return_value = None
            result.fetchall.return_value = fetchall_result if fetchall_result is not None else []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = _execute
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


# ─────────────────────────────────────────────────────────────────────────────
# Auth gating — 401 without token
# ─────────────────────────────────────────────────────────────────────────────

ANALYTICS_GET_ENDPOINTS = [
    "/api/admin/analytics/ga4/overview",
    "/api/admin/analytics/search-console/overview",
    "/api/admin/analytics/page-health",
]


@pytest.mark.parametrize("path", ANALYTICS_GET_ENDPOINTS)
def test_analytics_endpoint_requires_auth(client, path):
    """Analytics GET endpoints return 401 when no token is provided."""
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        resp = client.get(path)
    assert resp.status_code == 401, f"GET {path} should require auth"


def test_pagespeed_endpoint_requires_auth(client):
    """POST /pagespeed/run returns 401 when no token is provided."""
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        resp = client.post("/api/admin/analytics/pagespeed/run", json={"url": "https://example.com"})
    assert resp.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# ``configured: false`` when env vars are missing
# ─────────────────────────────────────────────────────────────────────────────

class TestGA4NotConfigured:
    def _get(self, client, range_param="28d"):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        env = {
            "GA4_PROPERTY_ID": "",
            "GA4_SERVICE_ACCOUNT_JSON": "",
        }
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, env, clear=False):
            return client.get(
                f"/api/admin/analytics/ga4/overview?range={range_param}",
                headers=AUTH_HEADERS,
            )

    def test_returns_200(self, client):
        resp = self._get(client)
        assert resp.status_code == 200

    def test_configured_false(self, client):
        data = self._get(client).json()
        assert data["configured"] is False

    def test_message_present(self, client):
        data = self._get(client).json()
        assert "message" in data and data["message"]

    def test_invalid_range_returns_422(self, client):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.get(
                "/api/admin/analytics/ga4/overview?range=invalid",
                headers=AUTH_HEADERS,
            )
        assert resp.status_code == 422


class TestSearchConsoleNotConfigured:
    def _get(self, client):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        env = {
            "SEARCH_CONSOLE_SITE_URL": "",
            "GA4_SERVICE_ACCOUNT_JSON": "",
        }
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, env, clear=False):
            return client.get(
                "/api/admin/analytics/search-console/overview",
                headers=AUTH_HEADERS,
            )

    def test_returns_200(self, client):
        assert self._get(client).status_code == 200

    def test_configured_false(self, client):
        assert self._get(client).json()["configured"] is False


class TestPageSpeedNotConfigured:
    def _post(self, client):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, {"PAGESPEED_API_KEY": ""}, clear=False):
            return client.post(
                "/api/admin/analytics/pagespeed/run",
                json={"url": "https://pillseek.com", "strategy": "mobile"},
                headers=AUTH_HEADERS,
            )

    def test_returns_200(self, client):
        assert self._post(client).status_code == 200

    def test_configured_false(self, client):
        assert self._post(client).json()["configured"] is False


# ─────────────────────────────────────────────────────────────────────────────
# Page Health — functional tests
# ─────────────────────────────────────────────────────────────────────────────

# A DB row: (id, slug, medicine_name, meta_title, meta_description, noindex)
_GOOD_ROW = (1, "aspirin", "Aspirin", "Aspirin 500mg – Trusted Pain Relief Tablet", "Aspirin 500mg is used to relieve pain and reduce fever. Commonly recommended by doctors for headaches, body aches, and mild pain.", None)
_GARBAGE_ROW = (2, "garbage", "12 Ethinyl Estradiol Norethindrone 9 Ethinyl Estradiol 7 Inert Ingredients Active Ingredients junk", None, None, None)
_MISSING_META_ROW = (3, "ibuprofen", "Ibuprofen", None, None, None)
_NOINDEX_ROW = (4, "some-drug", "Some Drug", "Some Drug Title Tag Here", "Some Drug description that is long enough to pass the minimum character check for meta description.", True)


def _make_page_health_engine(rows):
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    def _execute(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        # Auth lookups
        if "profiles" in sql_str and "where id" in sql_str:
            result.fetchone.return_value = FAKE_SUPERUSER_PROFILE
            result.fetchall.return_value = []
        elif "admin_users" in sql_str:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
        else:
            # Business query (page health scan)
            result.fetchall.return_value = rows
            result.fetchone.return_value = None
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = _execute
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine


class TestPageHealth:
    def _get(self, client, rows):
        import database as db_module
        db_module.db_engine = _make_page_health_engine(rows)
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            return client.get("/api/admin/analytics/page-health", headers=AUTH_HEADERS)

    def test_returns_200(self, client):
        resp = self._get(client, [_GOOD_ROW])
        assert resp.status_code == 200

    def test_configured_true(self, client):
        data = self._get(client, [_GOOD_ROW]).json()
        assert data["configured"] is True

    def test_has_required_keys(self, client):
        data = self._get(client, [_GOOD_ROW]).json()
        for key in ("issues", "total_pages_checked", "total_issues", "critical_count", "warning_count"):
            assert key in data, f"Missing key: {key}"

    def test_no_issues_for_good_row(self, client):
        data = self._get(client, [_GOOD_ROW]).json()
        assert data["total_issues"] == 0

    def test_garbage_drug_name_flagged_as_critical(self, client):
        data = self._get(client, [_GARBAGE_ROW]).json()
        garbage_issues = [i for i in data["issues"] if i["issue_type"] == "garbage_drug_name"]
        assert len(garbage_issues) >= 1
        assert garbage_issues[0]["severity"] == "critical"

    def test_missing_meta_title_flagged(self, client):
        data = self._get(client, [_MISSING_META_ROW]).json()
        title_issues = [i for i in data["issues"] if i["issue_type"] == "missing_meta_title"]
        assert len(title_issues) == 1
        assert title_issues[0]["severity"] == "critical"

    def test_missing_meta_description_flagged(self, client):
        data = self._get(client, [_MISSING_META_ROW]).json()
        desc_issues = [i for i in data["issues"] if i["issue_type"] == "missing_meta_description"]
        assert len(desc_issues) == 1

    def test_noindex_flagged_as_warning(self, client):
        data = self._get(client, [_NOINDEX_ROW]).json()
        noindex_issues = [i for i in data["issues"] if i["issue_type"] == "noindex"]
        assert len(noindex_issues) == 1
        assert noindex_issues[0]["severity"] == "warning"

    def test_total_pages_checked(self, client):
        rows = [_GOOD_ROW, _MISSING_META_ROW, _NOINDEX_ROW]
        data = self._get(client, rows).json()
        assert data["total_pages_checked"] == 3

    def test_critical_count_matches_issues(self, client):
        data = self._get(client, [_MISSING_META_ROW]).json()
        critical = [i for i in data["issues"] if i["severity"] == "critical"]
        assert data["critical_count"] == len(critical)

    def test_empty_db_returns_zero_issues(self, client):
        data = self._get(client, []).json()
        assert data["total_issues"] == 0
        assert data["total_pages_checked"] == 0
