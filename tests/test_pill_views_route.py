import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
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
