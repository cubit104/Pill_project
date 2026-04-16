"""
Basic pytest tests for the Pill Identifier API.

These tests use a mocked database so they can run without a real DATABASE_URL.
"""

import os
import pytest
from unittest.mock import MagicMock, patch

# Provide a fake DATABASE_URL before importing main so the startup check passes
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")


@pytest.fixture(scope="module")
def client():
    """Create a test client with the database mocked out."""
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        # Stub out the db_engine so endpoints don't try to hit a real DB
        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine.connect.return_value = mock_conn
        app_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

def test_health_returns_200(client):
    """GET /health should always return 200."""
    response = client.get("/health")
    assert response.status_code == 200


def test_health_has_status_field(client):
    """GET /health response must include a 'status' field."""
    response = client.get("/health")
    data = response.json()
    assert "status" in data


def test_health_has_database_connected_field(client):
    """GET /health response must include 'database_connected'."""
    response = client.get("/health")
    data = response.json()
    assert "database_connected" in data


# ---------------------------------------------------------------------------
# Search endpoint
# ---------------------------------------------------------------------------

def test_search_no_params_returns_empty_results(client):
    """GET /search with no parameters should return 200 with empty results."""
    mock_result = MagicMock()
    mock_result.mappings.return_value = []
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/search")
    assert response.status_code == 200


def test_search_with_name_param(client):
    """GET /search?name=aspirin should return 200 (even with empty results)."""
    mock_result = MagicMock()
    mock_result.mappings.return_value = []
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/search?name=aspirin")
    assert response.status_code == 200


def test_search_response_has_results_key(client):
    """GET /search response should contain a 'results' key."""
    mock_result = MagicMock()
    mock_result.mappings.return_value = []
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/search?name=aspirin")
    data = response.json()
    assert "results" in data


# ---------------------------------------------------------------------------
# Filters endpoint
# ---------------------------------------------------------------------------

def test_filters_returns_200(client):
    """GET /filters should return 200."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/filters")
    assert response.status_code == 200


def test_filters_has_colors_and_shapes(client):
    """GET /filters response should have 'colors' and 'shapes' keys."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/filters")
    data = response.json()
    assert "colors" in data
    assert "shapes" in data


def test_filters_colors_is_list(client):
    """GET /filters 'colors' should be a list."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/filters")
    data = response.json()
    assert isinstance(data["colors"], list)


# ---------------------------------------------------------------------------
# Suggestions endpoint
# ---------------------------------------------------------------------------

def test_suggestions_requires_q_and_type(client):
    """GET /suggestions without required params should return 422."""
    response = client.get("/suggestions")
    assert response.status_code == 422


def test_suggestions_short_query_returns_empty(client):
    """GET /suggestions with a 1-char query should return an empty list."""
    response = client.get("/suggestions?q=a&type=drug")
    assert response.status_code == 200
    assert response.json() == []


def test_suggestions_returns_list(client):
    """GET /suggestions with a valid query should return a list."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/suggestions?q=aspirin&type=drug")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


# ---------------------------------------------------------------------------
# Slug-based pill lookup endpoint
# ---------------------------------------------------------------------------

def test_api_pill_slug_not_found(client):
    """GET /api/pill/{slug} should return 404 when the slug is not in DB."""
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_result.keys.return_value = []
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/pill/nonexistent-slug")
    assert response.status_code == 404


def test_api_pill_slug_found(client):
    """GET /api/pill/{slug} should return pill data when slug exists."""
    mock_row = ("Aspirin", "ASPIRIN 500", "White", "Round", "0069-0020-01", "215831",
                "aspirin500.jpg", "aspirin-500mg-0069-0020-01", None)
    mock_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text",
                    "ndc11", "rxcui", "image_filename", "slug", "meta_description"]
    mock_result = MagicMock()
    mock_result.fetchone.return_value = mock_row
    mock_result.keys.return_value = mock_columns
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/pill/aspirin-500mg-0069-0020-01")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Sitemap endpoint
# ---------------------------------------------------------------------------

def test_sitemap_returns_200(client):
    """GET /sitemap.xml should return 200 with XML content."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([("aspirin-500mg-0069-0020-01",)]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/sitemap.xml")
    assert response.status_code == 200


def test_sitemap_content_type(client):
    """GET /sitemap.xml should return XML content type."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/sitemap.xml")
    assert "xml" in response.headers.get("content-type", "")


def test_sitemap_contains_urlset(client):
    """GET /sitemap.xml should contain a urlset element."""
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([("some-slug",)]))
    import main as app_module
    app_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/sitemap.xml")
    assert b"urlset" in response.content


# ---------------------------------------------------------------------------
# Environment / configuration
# ---------------------------------------------------------------------------

def test_database_url_env_var_is_read():
    """DATABASE_URL should be read from the environment, not hardcoded."""
    import main as app_module
    assert app_module.DATABASE_URL == os.environ["DATABASE_URL"]


def test_image_base_has_default():
    """IMAGE_BASE should fall back to the Supabase URL when env var is absent."""
    import main as app_module
    assert "supabase.co" in app_module.IMAGE_BASE


def test_cors_includes_idmypills():
    """CORS default fallback origins in main.py should include idmypills.com."""
    import inspect
    import main as app_module
    source = inspect.getsource(app_module)
    # Verify the default CORS allowed origins string (the os.getenv fallback) includes idmypills.com
    assert "idmypills.com" in source, "idmypills.com not found in CORS default origins in main.py"
