import os
from unittest.mock import patch

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


def test_api_trending_returns_empty_shape_when_no_rows(client):
    import routes.trending as trending

    with trending._CACHE_LOCK:
      trending._CACHE.clear()

    with patch.object(trending, "_load_trending_pills", return_value=[]):
        response = client.get("/api/trending")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pills"] == []
    assert payload["window_days"] == 7
    assert payload["as_of"].endswith("Z")


def test_api_trending_returns_ranked_pill_rows(client):
    import routes.trending as trending

    with trending._CACHE_LOCK:
      trending._CACHE.clear()

    with patch.object(
        trending,
        "_load_trending_pills",
        return_value=[
            {
                "slug": "metformin-500-1172",
                "drug_name": "Metformin",
                "strength": "500 mg",
                "color": "White",
                "shape": "Round",
                "view_count": 2341,
                "rank": 1,
            }
        ],
    ):
        response = client.get("/api/trending?limit=1&days=14")

    assert response.status_code == 200
    payload = response.json()
    assert payload["window_days"] == 14
    assert payload["pills"] == [
        {
            "slug": "metformin-500-1172",
            "drug_name": "Metformin",
            "strength": "500 mg",
            "color": "White",
            "shape": "Round",
            "view_count": 2341,
            "rank": 1,
        }
    ]
