import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
# Allow Vercel preview URLs via regex — must be set before main is imported.
os.environ.setdefault(
    "ALLOWED_ORIGINS_REGEX",
    r"https://pill-project-git-[a-z0-9\-]+\.vercel\.app",
)
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


@pytest.fixture()
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


def test_pill_views_returns_ok_even_when_db_unavailable(client):
    import routes.pill_views as pill_views_mod

    with patch.object(pill_views_mod, "database") as mock_db:
        mock_db.db_engine = None
        mock_db.connect_to_database.return_value = False
        response = client.post("/api/pill-views", json={"slug": "aspirin-325"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["recorded"] is False


def test_pill_views_records_new_view(client):
    import routes.pill_views as pill_views_mod

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchone.return_value = None  # no dedup hit
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__ = lambda s: mock_conn
    mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

    with patch.object(pill_views_mod, "database") as mock_db:
        mock_db.db_engine = mock_engine
        response = client.post("/api/pill-views", json={"slug": "aspirin-325"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["recorded"] is True


def test_pill_views_dedup_skips_recent(client):
    import routes.pill_views as pill_views_mod

    mock_conn = MagicMock()
    # dedup check returns a row → already recorded
    mock_conn.execute.return_value.fetchone.return_value = (1,)
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__ = lambda s: mock_conn
    mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

    with patch.object(pill_views_mod, "database") as mock_db:
        mock_db.db_engine = mock_engine
        response = client.post("/api/pill-views", json={"slug": "aspirin-325"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["recorded"] is False


def test_pill_views_rejects_empty_slug(client):
    response = client.post("/api/pill-views", json={"slug": ""})
    # Pydantic validation: min_length=1
    assert response.status_code == 422


def test_pill_views_rejects_missing_slug(client):
    response = client.post("/api/pill-views", json={})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# CORS preflight tests — verify the OPTIONS preflight for /api/pill-views
# returns the correct status and Access-Control-Allow-* headers.
# ---------------------------------------------------------------------------

def test_pill_views_preflight_from_allowed_static_origin(client):
    """OPTIONS preflight from a whitelisted origin (ALLOWED_ORIGINS) returns
    200/204 with the correct CORS headers."""
    response = client.options(
        "/api/pill-views",
        headers={
            "Origin": "http://testserver",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code in (200, 204), (
        f"Expected 200 or 204 for allowed origin, got {response.status_code}"
    )
    assert response.headers.get("access-control-allow-origin") == "http://testserver"
    allow_methods = response.headers.get("access-control-allow-methods", "")
    assert "POST" in allow_methods


def test_pill_views_preflight_from_vercel_preview_origin(client):
    """OPTIONS preflight from a Vercel preview URL matching ALLOWED_ORIGINS_REGEX
    returns 200/204 — this is the core fix for Bug 1."""
    vercel_preview = "https://pill-project-git-feature-abc123.vercel.app"
    response = client.options(
        "/api/pill-views",
        headers={
            "Origin": vercel_preview,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code in (200, 204), (
        f"Expected 200 or 204 for Vercel preview origin, got {response.status_code}. "
        "Check that ALLOWED_ORIGINS_REGEX matches Vercel preview URL format."
    )
    assert response.headers.get("access-control-allow-origin") == vercel_preview
    allow_methods = response.headers.get("access-control-allow-methods", "")
    assert "POST" in allow_methods


def test_pill_views_preflight_from_disallowed_origin_returns_400(client):
    """OPTIONS preflight from an origin that matches neither ALLOWED_ORIGINS nor the
    regex pattern should return 400 (Starlette CORSMiddleware behaviour for
    disallowed origins on preflight requests)."""
    response = client.options(
        "/api/pill-views",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 400
