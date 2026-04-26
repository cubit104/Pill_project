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
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
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
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
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


# ─────────────────────────────────────────────────────────────────────────────
# PostHog Overview — response shape and no-events edge case
# ─────────────────────────────────────────────────────────────────────────────

def _make_ph_query_side_effect(ts_rows, stats_rows, extra_rows=None):
    """Return a side_effect function for patching routes.admin.posthog._ph_query.

    Dispatches based on the 'kind' and 'query' content of the payload:
    - timeseries query  → ts_rows
    - stats query       → stats_rows
    - everything else   → extra_rows (default: empty results)
    """
    default_rows = extra_rows if extra_rows is not None else []

    def _side_effect(api_key, project_id, host, payload):
        q = payload.get("query", {})
        sql = q.get("query", "")
        if "toStartOfDay" in sql:
            return {"results": ts_rows}
        if "count(DISTINCT properties.$session_id)" in sql:
            return {"results": stats_rows}
        # Top pages / events / referrers / countries / devices
        return {"results": default_rows}

    return _side_effect


class TestPostHogOverview:
    """Tests for GET /api/admin/analytics/posthog/overview."""

    _PATH = "/api/admin/analytics/posthog/overview"

    def _get(self, client, range_param, ph_query_side_effect):
        import database as db_module
        import routes.admin.posthog as ph_module

        db_module.db_engine = _make_auth_engine()
        # Each test uses a unique range label to avoid hitting the module-level cache.
        env = {"POSTHOG_PERSONAL_API_KEY": "phx_fake_key"}
        # Clear any cached entry that might exist from a previous run.
        with ph_module._CACHE_LOCK:
            ph_module._CACHE.clear()

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.posthog._ph_query", side_effect=ph_query_side_effect), \
             patch.dict(os.environ, env, clear=False):
            return client.get(f"{self._PATH}?range={range_param}", headers=AUTH_HEADERS)

    # ── Not-configured ────────────────────────────────────────────────────────

    def test_not_configured_returns_200(self, client):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, {"POSTHOG_PERSONAL_API_KEY": ""}, clear=False):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)
        assert resp.status_code == 200

    def test_not_configured_flag(self, client):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, {"POSTHOG_PERSONAL_API_KEY": ""}, clear=False):
            data = client.get(self._PATH, headers=AUTH_HEADERS).json()
        assert data["configured"] is False

    # ── Happy path — real data ────────────────────────────────────────────────

    def test_happy_path_summary_values(self, client):
        side_effect = _make_ph_query_side_effect(
            ts_rows=[["2025-01-10T00:00:00", 5], ["2025-01-11T00:00:00", 3]],
            stats_rows=[[10, 4, 3]],
        )
        data = self._get(client, "7d", side_effect).json()
        assert data["summary"]["pageviews"] == 10
        assert data["summary"]["sessions"] == 4
        assert data["summary"]["users"] == 3

    def test_happy_path_timeseries_length(self, client):
        """Timeseries must always contain exactly `days` entries (day-filled scaffold)."""
        side_effect = _make_ph_query_side_effect(
            ts_rows=[["2025-01-10T00:00:00", 5]],
            stats_rows=[[5, 2, 2]],
        )
        data = self._get(client, "7d", side_effect).json()
        assert len(data["timeseries"]) == 7

    def test_happy_path_timeseries_shape(self, client):
        side_effect = _make_ph_query_side_effect(
            ts_rows=[["2025-01-10T00:00:00", 5]],
            stats_rows=[[5, 2, 2]],
        )
        data = self._get(client, "7d", side_effect).json()
        for point in data["timeseries"]:
            assert "date" in point
            assert "pageviews" in point
            assert isinstance(point["pageviews"], int)

    def test_happy_path_configured_true(self, client):
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[[0, 0, 0]])
        data = self._get(client, "7d", side_effect).json()
        assert data["configured"] is True

    def test_happy_path_required_keys(self, client):
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[[0, 0, 0]])
        data = self._get(client, "7d", side_effect).json()
        for key in ("summary", "timeseries", "top_pages", "top_events", "top_referrers", "countries", "devices"):
            assert key in data, f"Missing key: {key}"

    # ── No-events edge case ───────────────────────────────────────────────────

    def test_no_events_summary_zeros(self, client):
        """When PostHog returns no rows, summary counts must all be 0."""
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "7d", side_effect).json()
        assert data["summary"]["pageviews"] == 0
        assert data["summary"]["sessions"] == 0
        assert data["summary"]["users"] == 0

    def test_no_events_timeseries_filled_with_zeros(self, client):
        """When there are no events, the timeseries must still have `days` zero entries."""
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "7d", side_effect).json()
        assert len(data["timeseries"]) == 7
        assert all(p["pageviews"] == 0 for p in data["timeseries"])

    def test_no_events_timeseries_28d_length(self, client):
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "28d", side_effect).json()
        assert len(data["timeseries"]) == 28

    def test_no_events_timeseries_90d_length(self, client):
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "90d", side_effect).json()
        assert len(data["timeseries"]) == 90


# ─────────────────────────────────────────────────────────────────────────────
# OAuth2 credential builder unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildOAuth2Credentials:
    """Unit tests for routes.admin.analytics._build_oauth2_credentials."""

    def _clear_cache(self):
        import routes.admin.analytics as analytics_module
        with analytics_module._TOKEN_LOCK:
            analytics_module._TOKEN_CACHE.clear()

    def test_raises_when_client_id_missing(self):
        self._clear_cache()
        import routes.admin.analytics as analytics_module
        env = {
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "secret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "token",
        }
        with patch.dict(os.environ, env, clear=False):
            with pytest.raises(RuntimeError) as exc_info:
                analytics_module._build_oauth2_credentials()
        assert "GOOGLE_OAUTH_CLIENT_ID" in str(exc_info.value)

    def test_raises_when_client_secret_missing(self):
        self._clear_cache()
        import routes.admin.analytics as analytics_module
        env = {
            "GOOGLE_OAUTH_CLIENT_ID": "client-id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "token",
        }
        with patch.dict(os.environ, env, clear=False):
            with pytest.raises(RuntimeError) as exc_info:
                analytics_module._build_oauth2_credentials()
        assert "GOOGLE_OAUTH_CLIENT_SECRET" in str(exc_info.value)

    def test_raises_when_refresh_token_missing(self):
        self._clear_cache()
        import routes.admin.analytics as analytics_module
        env = {
            "GOOGLE_OAUTH_CLIENT_ID": "client-id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "secret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
        }
        with patch.dict(os.environ, env, clear=False):
            with pytest.raises(RuntimeError) as exc_info:
                analytics_module._build_oauth2_credentials()
        assert "GOOGLE_OAUTH_REFRESH_TOKEN" in str(exc_info.value)

    def test_error_message_lists_all_missing_vars(self):
        self._clear_cache()
        import routes.admin.analytics as analytics_module
        env = {
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
        }
        with patch.dict(os.environ, env, clear=False):
            with pytest.raises(RuntimeError) as exc_info:
                analytics_module._build_oauth2_credentials()
        msg = str(exc_info.value)
        for var in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"):
            assert var in msg, f"Missing var name in error message: {var}"

