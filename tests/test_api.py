"""
Basic pytest tests for the Pill Identifier API.

These tests use a mocked database so they can run without a real DATABASE_URL.
"""

import os
import pytest
from pathlib import Path
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
        import database as db_module

        # Stub out the db_engine so endpoints don't try to hit a real DB
        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

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
# Search endpoints
# ---------------------------------------------------------------------------

def test_search_no_params_returns_empty_results(client):
    """GET /api/search with no parameters should return 200 with empty results."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.mappings.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/search")
    assert response.status_code == 200


def test_search_with_name_param(client):
    """GET /api/search?name=aspirin should return 200 (even with empty results)."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.mappings.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/search?name=aspirin")
    assert response.status_code == 200


def test_search_response_has_results_key(client):
    """GET /api/search response should contain a 'results' key."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.mappings.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/search?name=aspirin")
    data = response.json()
    assert "results" in data


def test_search_returns_json(client):
    """GET /api/search should always return JSON."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_result.fetchall.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result

    response = client.get("/api/search", headers={"Accept": "*/*"})
    assert response.status_code == 200
    data = response.json()
    assert "results" in data


def test_search_no_accept_header_returns_json(client):
    """GET /api/search with no Accept header should return JSON."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.scalar.return_value = 0
    mock_result.fetchall.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result

    response = client.get("/api/search", headers={"Accept": ""})
    assert response.status_code == 200
    data = response.json()
    assert "results" in data


def test_search_result_includes_images_field(client):
    """Each search result should include an 'images' array and 'has_multiple_images' bool."""
    import database as db_module
    from utils import IMAGE_BASE

    # Row with a single image filename
    mock_row = (
        "Aspirin",          # medicine_name [0]
        "44 249",           # splimprint [1]
        "White",            # splcolor_text [2]
        "Round",            # splshape_text [3]
        "41163-0249-01",    # ndc11 [4]
        "215831",           # rxcui [5]
        "Aspirin.jpg",      # image_filename [6]
        "aspirin-44-249",   # slug [7]
        "325 mg",           # spl_strength [8]
    )
    # The second-pass image query iterates over img_rows; mock it to yield the same filename.
    mock_result = MagicMock()
    mock_result.scalar.return_value = 1
    mock_result.fetchall.return_value = [mock_row]
    mock_result.__iter__ = MagicMock(side_effect=lambda: iter([("Aspirin.jpg",)]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result

    response = client.get("/api/search?q=aspirin&type=drug")
    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 1

    result = data["results"][0]
    assert "images" in result
    assert isinstance(result["images"], list)
    assert len(result["images"]) == 1
    assert result["images"][0] == f"{IMAGE_BASE}/Aspirin.jpg"
    assert "has_multiple_images" in result
    assert result["has_multiple_images"] is False


def test_search_result_multiple_images(client):
    """Two DB rows for the same drug+imprint should produce images list with has_multiple_images=True."""
    import database as db_module
    from utils import IMAGE_BASE

    # First paginated row has one image; the second-pass query finds both rows' images.
    mock_row = (
        "Aspirin",                       # medicine_name [0]
        "44 249",                        # splimprint [1]
        "White",                         # splcolor_text [2]
        "Round",                         # splshape_text [3]
        "41163-0249-01",                 # ndc11 [4]
        "215831",                        # rxcui [5]
        "Aspirin.jpg",                   # image_filename [6] — first row's image
        "aspirin-44-249",                # slug [7]
        "325 mg",                        # spl_strength [8]
    )
    # The second-pass image query returns both images (from two separate DB rows).
    mock_result = MagicMock()
    mock_result.scalar.return_value = 1
    mock_result.fetchall.return_value = [mock_row]
    mock_result.__iter__ = MagicMock(
        side_effect=lambda: iter([("Aspirin.jpg",), ("Aspirin-1.jpeg",)])
    )
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result

    response = client.get("/api/search?q=aspirin&type=drug")
    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 1

    result = data["results"][0]
    assert "images" in result
    assert isinstance(result["images"], list)
    assert len(result["images"]) == 2
    assert result["images"][0] == f"{IMAGE_BASE}/Aspirin.jpg"
    assert result["images"][1] == f"{IMAGE_BASE}/Aspirin-1.jpeg"
    assert "has_multiple_images" in result
    assert result["has_multiple_images"] is True


# ---------------------------------------------------------------------------
# Filters endpoint
# ---------------------------------------------------------------------------

def test_filters_returns_200(client):
    """GET /filters should return 200."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/filters")
    assert response.status_code == 200


def test_filters_has_colors_and_shapes(client):
    """GET /filters response should have 'colors' and 'shapes' keys."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/filters")
    data = response.json()
    assert "colors" in data
    assert "shapes" in data


def test_filters_colors_is_list(client):
    """GET /filters 'colors' should be a list."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
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
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/suggestions?q=aspirin&type=drug")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


# ---------------------------------------------------------------------------
# Slug-based pill lookup endpoint
# ---------------------------------------------------------------------------

def test_api_pill_slug_not_found(client):
    """GET /api/pill/{slug} should return 404 when the slug is not in DB."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_result.keys.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/pill/nonexistent-slug")
    assert response.status_code == 404


def test_api_pill_slug_found(client):
    """GET /api/pill/{slug} should return pill data when slug exists."""
    import database as db_module
    mock_row = ("Aspirin", "ASPIRIN 500", "White", "Round", "0069-0020-01", "215831",
                "aspirin500.jpg", "aspirin-500mg-0069-0020-01", None)
    mock_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text",
                    "ndc11", "rxcui", "image_filename", "slug", "meta_description"]
    mock_result = MagicMock()
    mock_result.fetchone.return_value = mock_row
    mock_result.keys.return_value = mock_columns
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/pill/aspirin-500mg-0069-0020-01")
    assert response.status_code == 200


def test_api_pill_slug_meta_description_null_when_db_empty(client):
    """GET /api/pill/{slug} should return meta_description as null when the DB column is NULL."""
    import database as db_module
    mock_row = ("Aspirin", "ASPIRIN 500", "White", "Round", "0069-0020-01", "215831",
                "aspirin500.jpg", "aspirin-500mg-0069-0020-01", None)
    mock_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text",
                    "ndc11", "rxcui", "image_filename", "slug", "meta_description"]
    mock_result = MagicMock()
    mock_result.fetchone.return_value = mock_row
    mock_result.keys.return_value = mock_columns
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/pill/aspirin-500mg-0069-0020-01")
    assert response.status_code == 200
    data = response.json()
    assert "meta_description" in data
    assert data["meta_description"] is None


def test_api_pill_slug_meta_description_returned_when_set(client):
    """GET /api/pill/{slug} should return the stored meta_description string when present."""
    import database as db_module
    description = "This is a white round pill with imprint ASPIRIN 500, identified as Aspirin 500 mg."
    mock_row = ("Aspirin", "ASPIRIN 500", "White", "Round", "0069-0020-01", "215831",
                "aspirin500.jpg", "aspirin-500mg-0069-0020-01", description)
    mock_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text",
                    "ndc11", "rxcui", "image_filename", "slug", "meta_description"]
    mock_result = MagicMock()
    mock_result.fetchone.return_value = mock_row
    mock_result.keys.return_value = mock_columns
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/pill/aspirin-500mg-0069-0020-01")
    assert response.status_code == 200
    data = response.json()
    assert "meta_description" in data
    assert data["meta_description"] == description


# ---------------------------------------------------------------------------
# Sitemap endpoint
# ---------------------------------------------------------------------------

def test_sitemap_returns_200(client):
    """GET /sitemap.xml should return 200 with XML content."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([("aspirin-500mg-0069-0020-01",)]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/sitemap.xml")
    assert response.status_code == 200


def test_sitemap_content_type(client):
    """GET /sitemap.xml should return XML content type."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/sitemap.xml")
    assert "xml" in response.headers.get("content-type", "")


def test_sitemap_contains_urlset(client):
    """GET /sitemap.xml should contain a urlset element."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(return_value=iter([("some-slug",)]))
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/sitemap.xml")
    assert b"urlset" in response.content


# ---------------------------------------------------------------------------
# Slugs endpoint
# ---------------------------------------------------------------------------

def test_api_slugs_returns_200(client):
    """GET /api/slugs should return 200 with a JSON array."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(
        return_value=iter([("aspirin-500mg-01",), ("ibuprofen-200mg-02",)])
    )
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/slugs")
    assert response.status_code == 200


def test_api_slugs_returns_list_of_strings(client):
    """GET /api/slugs should return a JSON array of slug strings."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(
        return_value=iter([("aspirin-500mg-01",), ("ibuprofen-200mg-02",)])
    )
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/slugs")
    data = response.json()
    assert isinstance(data, list)
    assert all(isinstance(s, str) for s in data)


def test_api_slugs_filters_null_values(client):
    """GET /api/slugs should exclude null slugs from results."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(
        return_value=iter([("aspirin-500mg-01",), (None,), ("ibuprofen-200mg-02",)])
    )
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/slugs")
    data = response.json()
    assert None not in data
    assert len(data) == 2


def test_database_url_env_var_is_read():
    """DATABASE_URL should be read from the environment, not hardcoded."""
    import database as db_module
    assert db_module.DATABASE_URL == os.environ["DATABASE_URL"]


def test_image_base_has_default():
    """IMAGE_BASE should fall back to the Supabase URL when env var is absent."""
    from utils import IMAGE_BASE
    assert "supabase.co" in IMAGE_BASE


def test_cors_includes_pillseek():
    """CORS default fallback origins in main.py should include pillseek.com."""
    import inspect
    import main as app_module
    source = inspect.getsource(app_module)
    # Verify the default CORS allowed origins string (the os.getenv fallback) includes pillseek.com
    assert "pillseek.com" in source, "pillseek.com not found in CORS default origins in main.py"


# ---------------------------------------------------------------------------
# /api/related/{slug} endpoint
# ---------------------------------------------------------------------------

def test_api_related_not_found(client):
    """GET /api/related/{slug} should return 404 when slug does not exist."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/related/nonexistent-slug")
    assert response.status_code == 404


def test_api_related_no_pharma_class(client):
    """GET /api/related/{slug} should return empty related list when pill has no pharma class."""
    import database as db_module
    mock_result = MagicMock()
    # Row: (medicine_name, dailymed_pharma_class_epc, pharmclass_fda_epc) - both class cols None
    mock_result.fetchone.return_value = ("Aspirin", None, None)
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/related/aspirin-500mg")
    assert response.status_code == 200
    data = response.json()
    assert data["pharma_class"] is None
    assert data["related"] == []


def test_api_related_happy_path(client):
    """GET /api/related/{slug} should return related drugs list with expected keys."""
    import database as db_module

    pill_row = MagicMock()
    pill_row.__getitem__ = lambda self, i: ("Aspirin", "Salicylates", None)[i]

    related_rows = [
        ("Ibuprofen", "200mg", "ibuprofen-200mg", "White", "Round", None),
        ("Naproxen", "500mg", "naproxen-500mg", "Blue", "Oval", None),
    ]

    def execute_side_effect(query, params=None):
        mock_res = MagicMock()
        # First call: look up the pill row
        if params and "slug" in params and "cls" not in params:
            mock_res.fetchone.return_value = ("Aspirin", "Salicylates", None)
        else:
            mock_res.fetchall.return_value = related_rows
        return mock_res

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = execute_side_effect
    response = client.get("/api/related/aspirin-500mg")
    assert response.status_code == 200
    data = response.json()
    assert "pharma_class" in data
    assert "related" in data
    assert isinstance(data["related"], list)


def test_api_related_limit_too_large_rejected(client):
    """GET /api/related/{slug} with limit > 50 should return 422."""
    response = client.get("/api/related/aspirin-500mg?limit=999")
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# /api/classes endpoint
# ---------------------------------------------------------------------------

def test_api_classes_returns_200(client):
    """GET /api/classes should return 200 with a JSON array."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [
        ("Salicylates", 5),
        ("ACE Inhibitors", 12),
    ]
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/api/classes")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_api_classes_response_shape(client):
    """GET /api/classes should return items with class_name, slug, count."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [("Salicylates", 5)]
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
    response = client.get("/api/classes")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    item = data[0]
    assert item["class_name"] == "Salicylates"
    assert item["slug"] == "salicylates"
    assert item["count"] == 5


# ---------------------------------------------------------------------------
# /api/class/{class_slug} endpoint
# ---------------------------------------------------------------------------

def test_api_class_not_found(client):
    """GET /api/class/{class_slug} should return 404 for an unknown class slug."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.scalar.return_value = None
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
    response = client.get("/api/class/nonexistent-class")
    assert response.status_code == 404


def test_api_class_happy_path(client):
    """GET /api/class/{class_slug} should return class info and drug list."""
    import database as db_module

    drug_rows = [
        ("Ibuprofen", "200mg", "ibuprofen-200mg", "White", "Round", None),
    ]

    def execute_side_effect(query, params=None):
        mock_res = MagicMock()
        if params and "class_slug" in params:
            mock_res.scalar.return_value = "Salicylates"
        else:
            mock_res.fetchall.return_value = drug_rows
        return mock_res

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = execute_side_effect
    response = client.get("/api/class/salicylates")
    assert response.status_code == 200
    data = response.json()
    assert data["class_name"] == "Salicylates"
    assert data["slug"] == "salicylates"
    assert "drugs" in data
    assert isinstance(data["drugs"], list)


def test_api_class_limit_too_large_rejected(client):
    """GET /api/class/{class_slug} with limit > 500 should return 422."""
    response = client.get("/api/class/salicylates?limit=9999")
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# /api/pill/{slug}/similar endpoint
# ---------------------------------------------------------------------------

def test_api_pill_similar_not_found(client):
    """GET /api/pill/{slug}/similar should return 404 when slug does not exist."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
    response = client.get("/api/pill/nonexistent-slug/similar")
    assert response.status_code == 404


def test_api_pill_similar_no_color_shape_returns_empty(client):
    """GET /api/pill/{slug}/similar should return empty list when pill is missing color or shape."""
    import database as db_module
    mock_result = MagicMock()
    # source_row: (medicine_name, splimprint, splcolor_text, splshape_text)
    # Missing shape — cannot reliably match visually similar pills without both fields.
    mock_result.fetchone.return_value = ("Aspirin", "BAYER", "White", None)
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
    response = client.get("/api/pill/aspirin-500mg/similar")
    assert response.status_code == 200
    data = response.json()
    assert data["similar"] == []


def test_api_pill_similar_returns_similar_key(client):
    """GET /api/pill/{slug}/similar response must include a 'similar' key."""
    import database as db_module

    def execute_side_effect(query, params=None):
        mock_res = MagicMock()
        if params and "slug" in params and "color" not in params:
            mock_res.fetchone.return_value = ("Aspirin", "BAYER", "White", "Round")
        else:
            mock_res.fetchall.return_value = []
        return mock_res

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = execute_side_effect
    response = client.get("/api/pill/aspirin-500mg/similar")
    assert response.status_code == 200
    data = response.json()
    assert "similar" in data
    assert isinstance(data["similar"], list)


def test_api_pill_similar_happy_path(client):
    """GET /api/pill/{slug}/similar returns up to 5 similar pills with expected fields."""
    import database as db_module

    similar_rows = [
        (
            "ibuprofen-200mg",   # slug
            "Ibuprofen",         # medicine_name
            "200mg",             # spl_strength
            "BAYER",             # splimprint
            "White",             # splcolor_text
            "Round",             # splshape_text
            "Pfizer",            # author (manufacturer)
            None,                # image_filename
        ),
    ]

    def execute_side_effect(query, params=None):
        mock_res = MagicMock()
        if params and "slug" in params and "color" not in params:
            # First call: resolve source pill
            mock_res.fetchone.return_value = ("Aspirin", "BAYER", "White", "Round")
        else:
            # Second call: find similar pills
            mock_res.fetchall.return_value = similar_rows
        return mock_res

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = execute_side_effect
    response = client.get("/api/pill/aspirin-500mg/similar")
    assert response.status_code == 200
    data = response.json()
    assert "similar" in data
    assert len(data["similar"]) == 1

    pill = data["similar"][0]
    assert pill["slug"] == "ibuprofen-200mg"
    assert pill["drug_name"] == "Ibuprofen"
    assert pill["strength"] == "200mg"
    assert pill["imprint"] == "BAYER"
    assert pill["color"] == "White"
    assert pill["shape"] == "Round"
    assert pill["manufacturer"] == "Pfizer"
    assert pill["image_url"] is None


def test_api_pill_similar_image_url_built_from_filename(client):
    """GET /api/pill/{slug}/similar image_url is derived from image_filename when present."""
    import database as db_module
    from utils import IMAGE_BASE

    similar_rows = [
        ("other-pill", "Other Drug", "10mg", "M 123", "Blue", "Oval", "Acme", "other.jpg"),
    ]

    def execute_side_effect(query, params=None):
        mock_res = MagicMock()
        if params and "slug" in params and "color" not in params:
            mock_res.fetchone.return_value = ("My Drug", "M 123", "Blue", "Oval")
        else:
            mock_res.fetchall.return_value = similar_rows
        return mock_res

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = execute_side_effect
    response = client.get("/api/pill/my-drug/similar")
    assert response.status_code == 200
    data = response.json()
    assert len(data["similar"]) == 1
    assert data["similar"][0]["image_url"] == f"{IMAGE_BASE}/other.jpg"

