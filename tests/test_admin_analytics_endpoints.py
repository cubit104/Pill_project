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
    "/api/admin/analytics/posthog/live",
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

# DB rows: (id, slug, medicine_name, meta_title, meta_description[, color, shape, strength, imprint])
# The code pads shorter rows with None for the trailing extra columns, so 5-col tuples are accepted.
_GOOD_ROW = (1, "aspirin", "Aspirin", "Aspirin 500mg – Trusted Pain Relief Tablet", "Aspirin 500mg is used to relieve pain and reduce fever. Commonly recommended by doctors for headaches, body aches, and mild pain.")
_GARBAGE_ROW = (2, "garbage", "12 Ethinyl Estradiol Norethindrone 9 Ethinyl Estradiol 7 Inert Ingredients Active Ingredients junk", None, None)
# Truly empty pill — no medicine_name, no identifying fields → effective_title is empty → missing_meta_title IS flagged
_MISSING_META_ROW = (3, "unknown-pill", None, None, None)
# Pill with medicine_name but no stored meta_title → effective_title auto-generated → NOT flagged
_HAS_NAME_NO_STORED_TITLE_ROW = (5, "ibuprofen", "Ibuprofen", None, None)
_EXTRA_ROW = (4, "some-drug", "Some Drug", "Some Drug Title Tag Here", "Some Drug description that is long enough to pass the minimum character check for meta description.")


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
        # Truly empty row (no medicine_name, no identifying fields) → effective_title is empty
        data = self._get(client, [_MISSING_META_ROW]).json()
        title_issues = [i for i in data["issues"] if i["issue_type"] == "missing_meta_title"]
        assert len(title_issues) == 1
        assert title_issues[0]["severity"] == "critical"

    def test_pill_with_name_but_no_stored_title_not_flagged(self, client):
        # Pill has medicine_name — effective_title falls back to auto-generated → NOT flagged
        data = self._get(client, [_HAS_NAME_NO_STORED_TITLE_ROW]).json()
        title_issues = [i for i in data["issues"] if i["issue_type"] == "missing_meta_title"]
        assert len(title_issues) == 0

    def test_missing_meta_description_flagged(self, client):
        data = self._get(client, [_MISSING_META_ROW]).json()
        desc_issues = [i for i in data["issues"] if i["issue_type"] == "missing_meta_description"]
        assert len(desc_issues) == 1

    def test_total_pages_checked(self, client):
        rows = [_GOOD_ROW, _MISSING_META_ROW, _EXTRA_ROW]
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
    - hourly timeseries query → ts_rows  (toStartOfHour, for 1d range)
    - daily timeseries query  → ts_rows  (toStartOfDay)
    - stats query       → stats_rows
    - everything else   → extra_rows (default: empty results)
    """
    default_rows = extra_rows if extra_rows is not None else []

    def _side_effect(api_key, project_id, host, payload):
        q = payload.get("query", {})
        sql = q.get("query", "")
        if "toStartOfHour" in sql or "toStartOfDay" in sql:
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

    # ── 24h / hourly path ─────────────────────────────────────────────────────

    def test_1d_timeseries_has_24_points(self, client):
        """range=1d must produce exactly 24 hourly buckets."""
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "1d", side_effect).json()
        assert len(data["timeseries"]) == 24

    def test_1d_timeseries_all_zeros_when_no_events(self, client):
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "1d", side_effect).json()
        assert all(p["pageviews"] == 0 for p in data["timeseries"])

    def test_1d_timeseries_shape(self, client):
        """Each bucket must have 'date' and 'pageviews' keys."""
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "1d", side_effect).json()
        for point in data["timeseries"]:
            assert "date" in point
            assert "pageviews" in point
            assert isinstance(point["pageviews"], int)

    def test_1d_timeseries_date_format(self, client):
        """Bucket dates must follow 'YYYY-MM-DD HH:00' (space, not T)."""
        import re
        side_effect = _make_ph_query_side_effect(ts_rows=[], stats_rows=[])
        data = self._get(client, "1d", side_effect).json()
        pattern = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:00$")
        for point in data["timeseries"]:
            assert pattern.match(point["date"]), f"Unexpected date format: {point['date']}"

    def test_1d_timeseries_iso_t_separator_normalized(self, client):
        """PostHog ISO strings with 'T' separator must be matched to the scaffold."""
        from datetime import datetime, timezone
        current_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        # Simulate PostHog returning a row with a 'T' separator in the timestamp.
        iso_ts = current_hour.strftime("%Y-%m-%dT%H:00:00")
        side_effect = _make_ph_query_side_effect(
            ts_rows=[[iso_ts, 42]],
            stats_rows=[],
        )
        data = self._get(client, "1d", side_effect).json()
        # The current hour bucket should have been filled with the pageview count.
        current_hour_key = current_hour.strftime("%Y-%m-%d %H:00")
        matching = [p for p in data["timeseries"] if p["date"] == current_hour_key]
        assert len(matching) == 1
        assert matching[0]["pageviews"] == 42

    def test_1d_timeseries_space_separator_normalized(self, client):
        """PostHog strings with a space separator must also match the scaffold."""
        from datetime import datetime, timezone
        current_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        space_ts = current_hour.strftime("%Y-%m-%d %H:00:00")
        side_effect = _make_ph_query_side_effect(
            ts_rows=[[space_ts, 7]],
            stats_rows=[],
        )
        data = self._get(client, "1d", side_effect).json()
        current_hour_key = current_hour.strftime("%Y-%m-%d %H:00")
        matching = [p for p in data["timeseries"] if p["date"] == current_hour_key]
        assert len(matching) == 1
        assert matching[0]["pageviews"] == 7


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


# ─────────────────────────────────────────────────────────────────────────────
# PostHog Visitor Locations
# ─────────────────────────────────────────────────────────────────────────────

class TestPostHogVisitorLocations:
    """Tests for GET /api/admin/analytics/posthog/visitor-locations."""

    _PATH = "/api/admin/analytics/posthog/visitor-locations"

    def _get(self, client, range_param, ph_query_result):
        import database as db_module
        import routes.admin.posthog as ph_module

        db_module.db_engine = _make_auth_engine()
        with ph_module._CACHE_LOCK:
            ph_module._CACHE.clear()

        env = {"POSTHOG_PERSONAL_API_KEY": "phx_fake_key"}
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.posthog._ph_query", return_value=ph_query_result), \
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

    # ── Happy path ────────────────────────────────────────────────────────────

    def test_happy_path_configured_true(self, client):
        resp = self._get(client, "28d", {"results": []})
        assert resp.status_code == 200
        assert resp.json()["configured"] is True

    def test_happy_path_required_keys(self, client):
        data = self._get(client, "28d", {"results": []}).json()
        for key in ("configured", "range", "locations"):
            assert key in data, f"Missing key: {key}"

    def test_happy_path_locations_shape(self, client):
        """Each location row must contain the expected fields."""
        rows = [
            ["1.2.3.4", "New York", "New York", "United States", "US", "2024-01-15T10:30:00", 42, 10],
            ["5.6.7.8", "London", "England", "United Kingdom", "GB", "2024-01-15T09:00:00", 15, 5],
        ]
        data = self._get(client, "7d", {"results": rows}).json()
        assert len(data["locations"]) == 2
        for row in data["locations"]:
            for field in ("ip", "city", "region", "country", "country_code", "last_seen", "pageviews", "users"):
                assert field in row, f"Missing field: {field}"

    def test_happy_path_location_values(self, client):
        rows = [["1.2.3.4", "Paris", "Île-de-France", "France", "FR", "2024-01-15T12:00:00", 7, 3]]
        data = self._get(client, "7d", {"results": rows}).json()
        loc = data["locations"][0]
        assert loc["ip"] == "1.2.3.4"
        assert loc["city"] == "Paris"
        assert loc["region"] == "Île-de-France"
        assert loc["country"] == "France"
        assert loc["country_code"] == "FR"
        assert loc["last_seen"] == "2024-01-15T12:00:00"
        assert loc["pageviews"] == 7
        assert loc["users"] == 3

    def test_happy_path_range_echoed(self, client):
        data = self._get(client, "7d", {"results": []}).json()
        assert data["range"] == "7d"

    # ── Null/missing values ───────────────────────────────────────────────────

    def test_null_fields_default_to_unknown(self, client):
        """None values from HogQL must default to 'Unknown'/''/0 rather than null."""
        rows = [[None, None, None, None, None, None, None, None]]
        data = self._get(client, "28d", {"results": rows}).json()
        loc = data["locations"][0]
        assert loc["ip"] == ""
        assert loc["city"] == "Unknown"
        assert loc["region"] == "Unknown"
        assert loc["country"] == "Unknown"
        assert loc["country_code"] == ""
        assert loc["last_seen"] is None
        assert loc["pageviews"] == 0
        assert loc["users"] == 0

    def test_empty_results_returns_empty_list(self, client):
        data = self._get(client, "28d", {"results": []}).json()
        assert data["locations"] == []


# ─────────────────────────────────────────────────────────────────────────────
# PostHog Replays — range parameter forwarding
# ─────────────────────────────────────────────────────────────────────────────

class TestPostHogReplays:
    """Tests for GET /api/admin/analytics/posthog/replays."""

    _PATH = "/api/admin/analytics/posthog/replays"

    def _get(self, client, range_param, ph_get_result, captured_params=None):
        """Make a GET request to /replays, optionally capturing the params passed to _ph_get."""
        import database as db_module
        import routes.admin.posthog as ph_module

        db_module.db_engine = _make_auth_engine()
        with ph_module._CACHE_LOCK:
            ph_module._CACHE.clear()

        env = {"POSTHOG_PERSONAL_API_KEY": "phx_fake_key"}

        def _fake_ph_get(api_key, url, params=None):
            if captured_params is not None:
                captured_params.update(params or {})
            return ph_get_result

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.posthog._ph_get", side_effect=_fake_ph_get), \
             patch.dict(os.environ, env, clear=False):
            return client.get(f"{self._PATH}?range={range_param}", headers=AUTH_HEADERS)

    # ── date_from mapping ─────────────────────────────────────────────────────

    @pytest.mark.parametrize("range_param,expected_date_from", [
        ("1d",  "-1d"),
        ("7d",  "-7d"),
        ("28d", "-28d"),
        ("90d", "-90d"),
    ])
    def test_date_from_matches_range(self, client, range_param, expected_date_from):
        """Backend must forward the correct date_from for each range value."""
        captured = {}
        self._get(client, range_param, {"results": []}, captured_params=captured)
        assert captured.get("date_from") == expected_date_from, (
            f"range={range_param} should produce date_from={expected_date_from!r}, "
            f"got {captured.get('date_from')!r}"
        )

    # ── cache key varies by range ─────────────────────────────────────────────

    def test_cache_key_varies_by_range(self, client):
        """Different ranges must produce independent cache entries."""
        import routes.admin.posthog as ph_module
        import database as db_module

        db_module.db_engine = _make_auth_engine()
        env = {"POSTHOG_PERSONAL_API_KEY": "phx_fake_key"}

        call_count = {"n": 0}

        def _fake_ph_get(api_key, url, params=None):
            call_count["n"] += 1
            return {"results": []}

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.posthog._ph_get", side_effect=_fake_ph_get), \
             patch.dict(os.environ, env, clear=False):

            with ph_module._CACHE_LOCK:
                ph_module._CACHE.clear()

            client.get(f"{self._PATH}?range=7d",  headers=AUTH_HEADERS)
            client.get(f"{self._PATH}?range=28d", headers=AUTH_HEADERS)
            client.get(f"{self._PATH}?range=90d", headers=AUTH_HEADERS)

        # Each distinct range should have triggered its own upstream request.
        assert call_count["n"] == 3, (
            "Expected 3 upstream calls for 3 distinct ranges; "
            f"got {call_count['n']} (cache key is not range-specific)"
        )

    # ── not-configured ────────────────────────────────────────────────────────

    def test_not_configured_returns_200(self, client):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, {"POSTHOG_PERSONAL_API_KEY": ""}, clear=False):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["configured"] is False

    # ── response shape ────────────────────────────────────────────────────────

    def test_happy_path_configured_true(self, client):
        data = self._get(client, "28d", {"results": []}).json()
        assert data["configured"] is True

    def test_happy_path_replays_key_present(self, client):
        data = self._get(client, "7d", {"results": []}).json()
        assert "replays" in data

    def test_happy_path_replay_shape(self, client):
        """Each replay entry must contain the expected fields."""
        fake_rec = {
            "id": "abc123",
            "start_time": "2025-01-10T10:00:00Z",
            "end_time": "2025-01-10T10:05:00Z",
            "recording_duration": 300,
            "distinct_id": "user_1",
            "click_count": 5,
            "keypress_count": 12,
            "start_url": "https://example.com/",
            "urls": ["https://example.com/"],
        }
        data = self._get(client, "28d", {"results": [fake_rec]}).json()
        assert len(data["replays"]) == 1
        replay = data["replays"][0]
        for field in ("session_id", "start_time", "end_time", "duration", "distinct_id",
                      "click_count", "keypress_count", "start_url", "replay_url"):
            assert field in replay, f"Missing field: {field}"



# ─────────────────────────────────────────────────────────────────────────────
# Search Console — Index Coverage (/search-console/indexing)
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchConsoleIndexing:
    _PATH = "/api/admin/analytics/search-console/indexing"

    def _get(self, client, extra_env=None):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        env = {
            "SEARCH_CONSOLE_SITE_URL": "",
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
            **(extra_env or {}),
        }
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, env, clear=False):
            return client.get(self._PATH, headers=AUTH_HEADERS)

    def test_requires_auth(self, client):
        """Returns 401 when no token is provided."""
        with patch("routes.admin.auth._verify_jwt", return_value=None):
            resp = client.get(self._PATH)
        assert resp.status_code == 401

    def test_not_configured_returns_200(self, client):
        """Returns HTTP 200 even when env vars are missing."""
        assert self._get(client).status_code == 200

    def test_not_configured_flag(self, client):
        """Returns configured=false when site URL is absent."""
        assert self._get(client).json()["configured"] is False

    def test_not_configured_message_present(self, client):
        data = self._get(client).json()
        assert "message" in data and data["message"]

    def test_configured_calls_gsc_api(self, client):
        """When env vars are present, uses Search Analytics page count as indexed and sitemaps for submitted."""
        import database as db_module
        import routes.admin.analytics as analytics_module
        db_module.db_engine = _make_auth_engine()

        fake_sitemaps = [
            {
                "path": "https://pillseek.com/sitemap.xml",
                "lastSubmitted": "2025-01-01T00:00:00Z",
                "lastDownloaded": "2025-01-02T00:00:00Z",
                "isSitemapsIndex": False,
                "warnings": 0,
                "errors": 0,
                "contents": [{"submitted": "100", "indexed": "80"}],
            }
        ]

        # 90 distinct pages returned by Search Analytics — these are the confirmed indexed count.
        # Fewer than rowLimit=25000 so pagination stops after the first page.
        fake_analytics_rows = [{"keys": [f"https://pillseek.com/pill/drug-{i}"]} for i in range(90)]

        mock_service = MagicMock()
        mock_service.sitemaps().list().execute.return_value = {"sitemap": fake_sitemaps}
        mock_service.searchanalytics().query().execute.return_value = {"rows": fake_analytics_rows}

        env = {
            "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
            "GOOGLE_OAUTH_CLIENT_ID": "cid",
            "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
        }

        # Clear cache so we always hit the API
        with analytics_module._INDEXING_CACHE_LOCK:
            analytics_module._INDEXING_CACHE.clear()

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.analytics._build_oauth2_credentials", return_value=MagicMock()), \
             patch("googleapiclient.discovery.build", return_value=mock_service), \
             patch.dict(os.environ, env, clear=False):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)

        data = resp.json()
        assert data["configured"] is True
        assert data["indexed"] == 90  # from Search Analytics page count
        assert data["submitted"] == 100  # from sitemaps API
        assert data["not_indexed"] == 10  # max(0, 100 - 90)
        assert len(data["sitemaps"]) == 1

    def test_configured_falls_back_to_sitemaps_indexed_when_no_analytics_rows(self, client):
        """Falls back to sitemaps API indexed value when Search Analytics returns no rows."""
        import database as db_module
        import routes.admin.analytics as analytics_module
        db_module.db_engine = _make_auth_engine()

        fake_sitemaps = [
            {
                "path": "https://pillseek.com/sitemap.xml",
                "lastSubmitted": "2025-01-01T00:00:00Z",
                "lastDownloaded": "2025-01-02T00:00:00Z",
                "isSitemapsIndex": False,
                "warnings": 0,
                "errors": 0,
                "contents": [{"submitted": "100", "indexed": "80"}],
            }
        ]

        mock_service = MagicMock()
        mock_service.sitemaps().list().execute.return_value = {"sitemap": fake_sitemaps}
        # Search Analytics returns no rows (new site / no impressions yet)
        mock_service.searchanalytics().query().execute.return_value = {"rows": []}

        env = {
            "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
            "GOOGLE_OAUTH_CLIENT_ID": "cid",
            "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
        }

        with analytics_module._INDEXING_CACHE_LOCK:
            analytics_module._INDEXING_CACHE.clear()

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.analytics._build_oauth2_credentials", return_value=MagicMock()), \
             patch("googleapiclient.discovery.build", return_value=mock_service), \
             patch.dict(os.environ, env, clear=False):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)

        data = resp.json()
        assert data["configured"] is True
        assert data["indexed"] == 80  # falls back to sitemaps API indexed
        assert data["submitted"] == 100
        assert data["not_indexed"] == 20

    def test_configured_falls_back_to_sitemaps_indexed_when_analytics_raises(self, client):
        """Falls back to sitemaps indexed when the Search Analytics query throws (e.g. quota/403)."""
        import database as db_module
        import routes.admin.analytics as analytics_module
        db_module.db_engine = _make_auth_engine()

        fake_sitemaps = [
            {
                "path": "https://pillseek.com/sitemap.xml",
                "lastSubmitted": "2025-01-01T00:00:00Z",
                "lastDownloaded": "2025-01-02T00:00:00Z",
                "isSitemapsIndex": False,
                "warnings": 0,
                "errors": 0,
                "contents": [{"submitted": "100", "indexed": "80"}],
            }
        ]

        mock_service = MagicMock()
        mock_service.sitemaps().list().execute.return_value = {"sitemap": fake_sitemaps}
        mock_service.searchanalytics().query().execute.side_effect = Exception("quota exceeded")

        env = {
            "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
            "GOOGLE_OAUTH_CLIENT_ID": "cid",
            "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
        }

        with analytics_module._INDEXING_CACHE_LOCK:
            analytics_module._INDEXING_CACHE.clear()

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.analytics._build_oauth2_credentials", return_value=MagicMock()), \
             patch("googleapiclient.discovery.build", return_value=mock_service), \
             patch.dict(os.environ, env, clear=False):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)

        data = resp.json()
        assert data["configured"] is True
        assert "error" not in data  # endpoint still succeeds
        assert data["indexed"] == 80  # falls back to sitemaps API indexed
        assert data["submitted"] == 100
        assert data["not_indexed"] == 20


# ─────────────────────────────────────────────────────────────────────────────
# Search Console — URL Inspection (/search-console/inspect-url)
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchConsoleInspectUrl:
    _PATH = "/api/admin/analytics/search-console/inspect-url"

    def _post(self, client, payload=None, extra_env=None):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        env = {
            "SEARCH_CONSOLE_SITE_URL": "",
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
            **(extra_env or {}),
        }
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, env, clear=False):
            return client.post(self._PATH, json=payload or {}, headers=AUTH_HEADERS)

    def test_requires_auth(self, client):
        """Returns 401 when no token is provided."""
        with patch("routes.admin.auth._verify_jwt", return_value=None):
            resp = client.post(self._PATH, json={"url": "https://pillseek.com/pill/aspirin"})
        assert resp.status_code == 401

    def test_not_configured_returns_200(self, client):
        assert self._post(client, {"url": "https://pillseek.com/pill/aspirin"}).status_code == 200

    def test_not_configured_flag(self, client):
        data = self._post(client, {"url": "https://pillseek.com/pill/aspirin"}).json()
        assert data["configured"] is False

    def test_missing_url_returns_error(self, client):
        """Returns configured=True with error when url is absent."""
        extra_env = {
            "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
            "GOOGLE_OAUTH_CLIENT_ID": "cid",
            "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
        }
        data = self._post(client, {}, extra_env=extra_env).json()
        assert data.get("configured") is True
        assert "error" in data

    def test_mismatched_hostname_returns_error(self, client):
        """Rejects URLs from a different hostname than the configured site."""
        extra_env = {
            "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
            "GOOGLE_OAUTH_CLIENT_ID": "cid",
            "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
        }
        data = self._post(
            client,
            {"url": "https://evil.example.com/pill/aspirin"},
            extra_env=extra_env,
        ).json()
        assert data.get("configured") is True
        assert "error" in data
        assert "evil.example.com" in data["error"]

    def test_configured_calls_gsc_api(self, client):
        """When env vars are present and URL matches, calls urlInspection API."""
        import database as db_module
        db_module.db_engine = _make_auth_engine()

        fake_result = {
            "inspectionResult": {
                "indexStatusResult": {
                    "verdict": "PASS",
                    "coverageState": "Submitted and indexed",
                    "robotsTxtState": "ALLOWED",
                    "indexingState": "INDEXING_ALLOWED",
                    "lastCrawlTime": "2025-01-10T08:00:00Z",
                    "pageFetchState": "SUCCESSFUL",
                    "googleCanonical": "https://pillseek.com/pill/aspirin",
                    "userCanonical": "https://pillseek.com/pill/aspirin",
                    "sitemap": [],
                    "referringUrls": [],
                },
                "mobileUsabilityResult": {"verdict": "PASS"},
            }
        }

        mock_service = MagicMock()
        mock_service.urlInspection().index().inspect().execute.return_value = fake_result

        env = {
            "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
            "GOOGLE_OAUTH_CLIENT_ID": "cid",
            "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
        }

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.analytics._build_oauth2_credentials", return_value=MagicMock()), \
             patch("googleapiclient.discovery.build", return_value=mock_service), \
             patch.dict(os.environ, env, clear=False):
            resp = client.post(
                self._PATH,
                json={"url": "https://pillseek.com/pill/aspirin"},
                headers=AUTH_HEADERS,
            )

        data = resp.json()
        assert data["configured"] is True
        assert data["verdict"] == "PASS"
        assert data["coverage_state"] == "Submitted and indexed"
        assert data["mobile_usability_verdict"] == "PASS"


# ─────────────────────────────────────────────────────────────────────────────
# Search Console — Submit URL for Indexing (/search-console/submit-indexing)
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchConsoleSubmitIndexing:
    _PATH = "/api/admin/analytics/search-console/submit-indexing"

    _CONFIGURED_ENV = {
        "SEARCH_CONSOLE_SITE_URL": "https://pillseek.com",
        "GOOGLE_OAUTH_CLIENT_ID": "cid",
        "GOOGLE_OAUTH_CLIENT_SECRET": "csecret",
        "GOOGLE_OAUTH_REFRESH_TOKEN": "rtoken",
    }

    def _post(self, client, payload=None, extra_env=None):
        import database as db_module
        db_module.db_engine = _make_auth_engine()
        env = {
            "SEARCH_CONSOLE_SITE_URL": "",
            "GOOGLE_OAUTH_CLIENT_ID": "",
            "GOOGLE_OAUTH_CLIENT_SECRET": "",
            "GOOGLE_OAUTH_REFRESH_TOKEN": "",
            **(extra_env or {}),
        }
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch.dict(os.environ, env, clear=False):
            return client.post(self._PATH, json=payload or {}, headers=AUTH_HEADERS)

    def test_requires_auth(self, client):
        """Returns 401 when no token is provided."""
        with patch("routes.admin.auth._verify_jwt", return_value=None):
            resp = client.post(self._PATH, json={"url": "https://pillseek.com/pill/aspirin"})
        assert resp.status_code == 401

    def test_not_configured_returns_200(self, client):
        """Returns HTTP 200 even when OAuth env vars are absent."""
        resp = self._post(client, {"url": "https://pillseek.com/pill/aspirin"})
        assert resp.status_code == 200

    def test_not_configured_flag(self, client):
        """Returns configured=False when OAuth env vars are absent."""
        data = self._post(client, {"url": "https://pillseek.com/pill/aspirin"}).json()
        assert data["configured"] is False

    def test_missing_url_returns_error(self, client):
        """Returns error when url field is absent."""
        data = self._post(client, {}, extra_env=self._CONFIGURED_ENV).json()
        assert data.get("configured") is True
        assert "error" in data

    def test_non_https_url_rejected(self, client):
        """Rejects non-http(s) URLs (e.g. ftp://)."""
        data = self._post(
            client,
            {"url": "ftp://pillseek.com/pill/aspirin"},
            extra_env=self._CONFIGURED_ENV,
        ).json()
        assert data.get("configured") is True
        assert "error" in data

    def test_mismatched_hostname_returns_error(self, client):
        """Rejects URLs from a different hostname than the configured site."""
        data = self._post(
            client,
            {"url": "https://evil.example.com/pill/aspirin"},
            extra_env=self._CONFIGURED_ENV,
        ).json()
        assert data.get("configured") is True
        assert "error" in data
        assert "evil.example.com" in data["error"]

    def test_successful_submission(self, client):
        """On successful Indexing API call, returns submitted=True."""
        import database as db_module
        db_module.db_engine = _make_auth_engine()

        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_resp.status_code = 200
        mock_resp.content = b'{"urlNotificationMetadata": {}}'
        mock_resp.json.return_value = {"urlNotificationMetadata": {}}

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.analytics._build_indexing_credentials", return_value=MagicMock()), \
             patch("routes.admin.analytics._record_indexing_submission"), \
             patch("requests.post", return_value=mock_resp), \
             patch.dict(os.environ, self._CONFIGURED_ENV, clear=False):
            resp = client.post(
                self._PATH,
                json={"url": "https://pillseek.com/pill/aspirin"},
                headers=AUTH_HEADERS,
            )

        data = resp.json()
        assert resp.status_code == 200
        assert data["configured"] is True
        assert data["submitted"] is True

    def test_api_error_returns_submitted_false(self, client):
        """When Indexing API returns non-2xx, submitted is False with error info."""
        import database as db_module
        db_module.db_engine = _make_auth_engine()

        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 403
        mock_resp.content = b'{"error": {"message": "insufficient permissions"}}'
        mock_resp.json.return_value = {"error": {"message": "insufficient permissions"}}
        mock_resp.text = '{"error": {"message": "insufficient permissions"}}'

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.analytics._build_indexing_credentials", return_value=MagicMock()), \
             patch("routes.admin.analytics._record_indexing_submission"), \
             patch("requests.post", return_value=mock_resp), \
             patch.dict(os.environ, self._CONFIGURED_ENV, clear=False):
            resp = client.post(
                self._PATH,
                json={"url": "https://pillseek.com/pill/aspirin"},
                headers=AUTH_HEADERS,
            )

        data = resp.json()
        assert data["configured"] is True
        assert data["submitted"] is False
        assert "error" in data


# ─────────────────────────────────────────────────────────────────────────────
# Search Console — Indexing Stats (/search-console/indexing-stats)
# ─────────────────────────────────────────────────────────────────────────────

class TestSearchConsoleIndexingStats:
    _PATH = "/api/admin/analytics/search-console/indexing-stats"

    def test_requires_auth(self, client):
        """Returns 401 when no token is provided."""
        with patch("routes.admin.auth._verify_jwt", return_value=None):
            resp = client.get(self._PATH)
        assert resp.status_code == 401

    def test_returns_zeros_when_table_missing(self, client):
        """Returns zeros gracefully when google_indexing_submissions table doesn't exist."""
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        def _execute(sql, *args, **kwargs):
            sql_str = str(sql).lower()
            if "profiles" in sql_str or "admin_users" in sql_str:
                result = MagicMock()
                result.fetchone.return_value = FAKE_SUPERUSER_PROFILE
                return result
            # Simulate missing table
            raise Exception("relation 'google_indexing_submissions' does not exist")

        mock_conn.execute.side_effect = _execute
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert data["total_submitted"] == 0
        assert data["this_month"] == 0
        assert data["unique_pages"] == 0

    def test_returns_stats_from_db(self, client):
        """Returns real counts when the table exists."""
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        call_count = 0

        def _execute(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            sql_str = str(sql).lower()
            if "profiles" in sql_str or "admin_users" in sql_str:
                result.fetchone.return_value = FAKE_SUPERUSER_PROFILE
            else:
                # Stats query — return (total_submitted, this_month, unique_pages)
                result.fetchone.return_value = (42, 7, 15)
            return result

        mock_conn.execute.side_effect = _execute
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.get(self._PATH, headers=AUTH_HEADERS)

        assert resp.status_code == 200
        data = resp.json()
        assert data["total_submitted"] == 42
        assert data["this_month"] == 7
        assert data["unique_pages"] == 15


# ─────────────────────────────────────────────────────────────────────────────
# PostHog Live Visitors endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestPostHogLive:
    """Tests for GET /api/admin/analytics/posthog/live."""

    _PATH = "/api/admin/analytics/posthog/live"

    def _get(self, client, scalar_count_value=0, ph_query_result=None):
        import database as db_module
        import routes.admin.posthog as ph_module

        db_module.db_engine = _make_auth_engine()
        with ph_module._CACHE_LOCK:
            ph_module._CACHE.clear()

        if ph_query_result is None:
            ph_query_result = {"results": []}

        env = {"POSTHOG_PERSONAL_API_KEY": "phx_fake_key"}
        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
             patch("routes.admin.posthog._scalar_count", return_value=scalar_count_value), \
             patch("routes.admin.posthog._ph_query", return_value=ph_query_result), \
             patch.dict(os.environ, env, clear=False):
            return client.get(self._PATH, headers=AUTH_HEADERS)

    # ── Auth required ─────────────────────────────────────────────────────────

    def test_requires_auth(self, client):
        with patch("routes.admin.auth._verify_jwt", return_value=None):
            resp = client.get(self._PATH)
        assert resp.status_code == 401

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

    # ── Happy-path response shape ─────────────────────────────────────────────

    def test_happy_path_status_200(self, client):
        assert self._get(client).status_code == 200

    def test_happy_path_configured_true(self, client):
        assert self._get(client).json()["configured"] is True

    def test_happy_path_required_keys(self, client):
        data = self._get(client).json()
        for key in ("configured", "active_users", "events", "as_of"):
            assert key in data, f"Missing key: {key}"

    def test_happy_path_active_users_count(self, client):
        data = self._get(client, scalar_count_value=7).json()
        assert data["active_users"] == 7

    def test_happy_path_events_shape(self, client):
        rows = [
            ["2024-01-15T10:00:00", "/pills/aspirin", "United States", "US", "Desktop", "Chrome"],
            ["2024-01-15T09:55:00", "/pills/ibuprofen", "United Kingdom", "GB", "Mobile", "Safari"],
        ]
        data = self._get(client, scalar_count_value=2, ph_query_result={"results": rows}).json()
        assert len(data["events"]) == 2
        ev = data["events"][0]
        for field in ("timestamp", "path", "country", "country_code", "device", "browser"):
            assert field in ev, f"Missing event field: {field}"

    def test_happy_path_event_values(self, client):
        rows = [["2024-01-15T10:00:00", "/pills/aspirin", "United States", "US", "Desktop", "Chrome"]]
        data = self._get(client, scalar_count_value=1, ph_query_result={"results": rows}).json()
        ev = data["events"][0]
        assert ev["path"] == "/pills/aspirin"
        assert ev["country"] == "United States"
        assert ev["country_code"] == "US"
        assert ev["device"] == "Desktop"
        assert ev["browser"] == "Chrome"

    def test_happy_path_empty_events(self, client):
        data = self._get(client, scalar_count_value=0, ph_query_result={"results": []}).json()
        assert data["events"] == []
        assert data["active_users"] == 0

    def test_happy_path_as_of_present(self, client):
        data = self._get(client).json()
        assert data["as_of"] is not None
        assert "T" in data["as_of"] or "-" in data["as_of"]

    # ── No-cache headers ──────────────────────────────────────────────────────

    def test_no_cache_control_header(self, client):
        resp = self._get(client)
        cc = resp.headers.get("cache-control", "")
        assert "no-store" in cc
        assert "no-cache" in cc

    def test_pragma_no_cache_header(self, client):
        resp = self._get(client)
        assert resp.headers.get("pragma", "").lower() == "no-cache"

    def test_expires_zero_header(self, client):
        resp = self._get(client)
        assert resp.headers.get("expires") == "0"
