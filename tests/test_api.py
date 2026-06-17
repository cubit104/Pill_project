"""
Basic pytest tests for the Pill Identifier API.

These tests use a mocked database so they can run without a real DATABASE_URL.
"""

import os
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch
from sqlalchemy.exc import SQLAlchemyError

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
    import database as db_module
    mock_result = MagicMock()
    mock_result.scalar.return_value = 1
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/health")
    assert response.status_code == 200


def test_health_has_status_field(client):
    """GET /health response must include a 'status' field."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.scalar.return_value = 1
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/health")
    data = response.json()
    assert "status" in data


def test_health_has_database_connected_field(client):
    """GET /health response must include 'database_connected'."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.scalar.return_value = 1
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
    response = client.get("/health")
    data = response.json()
    assert "database_connected" in data


def test_health_returns_503_when_database_ping_fails(client):
    import database as db_module
    mock_execute = db_module.db_engine.connect.return_value.__enter__.return_value.execute
    mock_execute.side_effect = RuntimeError("db down")
    try:
        response = client.get("/health")
    finally:
        mock_execute.side_effect = None

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "unreachable"}


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


def test_suggestions_drug_flag_on_supplements_with_synonyms_when_direct_is_less_than_two(client):
    import database as db_module
    executed_sql = []

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed_sql.append(sql_str)
        result = MagicMock()
        if "FROM pillfinder" in sql_str and "SELECT DISTINCT medicine_name" in sql_str:
            result.fetchall.return_value = [("Plavix",)]
        elif "FROM drug_synonyms, unnest(brand_names) bn" in sql_str:
            result.fetchall.return_value = [("Plavix", "clopidogrel")]
        elif "FROM drug_synonyms" in sql_str:
            result.fetchall.return_value = [("clopidogrel", "clopidogrel")]
        else:
            result.fetchall.return_value = []
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.search.USE_DRUG_SYNONYMS", True):
        response = client.get("/suggestions?q=pl&type=drug")
    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["label"] == "Plavix"
    assert payload[0]["kind"] == "pill"
    assert any(item.get("kind") == "generic" for item in payload)
    combined = " ".join(executed_sql).lower()
    assert "drug_synonyms" in combined


def test_suggestions_openapi_schema_is_explicit(client):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = (
        response.json()["paths"]["/suggestions"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    )
    items = schema["items"]["anyOf"]
    assert {"type": "string"} in items
    assert any(option.get("$ref", "").endswith("/SuggestionResponseItem") for option in items)


def test_search_drug_flag_off_keeps_existing_query(client):
    import database as db_module
    executed_sql = []

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed_sql.append(sql_str)
        result = MagicMock()
        if "COUNT(*)" in sql_str:
            result.scalar.return_value = 0
        elif "SELECT\n                medicine_name" in sql_str:
            result.fetchall.return_value = []
        else:
            result.__iter__ = MagicMock(return_value=iter([]))
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.search.USE_DRUG_SYNONYMS", False):
        response = client.get("/api/search?q=plavix&type=drug")
    assert response.status_code == 200
    combined = " ".join(executed_sql).lower()
    assert "drug_synonyms" not in combined
    assert "rxcui_to_ingredient" not in combined


def test_search_drug_flag_on_prefers_direct_results_without_synonym_fallback(client):
    import database as db_module
    executed_sql = []
    executed_params = []
    plavix_row = (
        "Plavix",
        "1171",
        "Pink",
        "Round",
        "00000-0000-00",
        "123",
        "plavix.jpg",
        "plavix-1171",
        "75 mg",
    )

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed_sql.append(sql_str)
        executed_params.append(params)
        result = MagicMock()
        if "COUNT(*)" in sql_str:
            result.scalar.return_value = 1
        elif "LIMIT :limit OFFSET :offset" in sql_str:
            result.fetchall.return_value = [plavix_row]
        elif "SELECT image_filename FROM pillfinder" in sql_str:
            result.__iter__ = MagicMock(return_value=iter([(plavix_row[6],)]))
        else:
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.search.USE_DRUG_SYNONYMS", True):
        response = client.get("/api/search?q=plavix&type=drug")
    assert response.status_code == 200
    payload = response.json()
    names = [r["drug_name"] for r in payload["results"]]
    assert names == ["Plavix"]
    assert payload["fallback_used"] is False
    assert payload["fallback_term"] is None
    combined = " ".join(executed_sql).lower()
    assert "drug_synonyms" not in combined
    assert "rxcui_to_ingredient" not in combined
    assert "tags_like" not in combined
    assert all("tags_like" not in (params or {}) for params in executed_params)


def test_search_drug_flag_on_uses_synonym_fallback_only_when_direct_has_no_results(client):
    import database as db_module
    executed_sql = []
    clopi_row = (
        "Clopidogrel",
        "1171",
        "Pink",
        "Round",
        "00000-0000-01",
        "456",
        "clopi.jpg",
        "clopidogrel-1171",
        "75 mg",
    )

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        sql_lower = sql_str.lower()
        executed_sql.append(sql_str)
        result = MagicMock()

        if "count(*)" in sql_lower and "rxcui_to_ingredient" not in sql_lower:
            result.scalar.return_value = 0
        elif "count(*)" in sql_lower and "rxcui_to_ingredient" in sql_lower:
            result.scalar.return_value = 1
        elif "limit :limit offset :offset" in sql_lower and "rxcui_to_ingredient" not in sql_lower:
            result.fetchall.return_value = []
        elif "limit :limit offset :offset" in sql_lower and "rxcui_to_ingredient" in sql_lower:
            result.fetchall.return_value = [clopi_row]
        elif "select s.generic_name" in sql_lower:
            result.scalar.return_value = "clopidogrel"
        elif "select image_filename from pillfinder" in sql_lower:
            result.__iter__ = MagicMock(return_value=iter([(clopi_row[6],)]))
        else:
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.search.USE_DRUG_SYNONYMS", True):
        response = client.get("/api/search?q=plavix&type=drug")
    assert response.status_code == 200
    payload = response.json()
    assert [r["drug_name"] for r in payload["results"]] == ["Clopidogrel"]
    assert payload["fallback_used"] is True
    assert payload["fallback_term"] == "clopidogrel"
    combined = " ".join(executed_sql).lower()
    assert "drug_synonyms" in combined
    assert "rxcui_to_ingredient" in combined


def test_search_drug_flag_on_with_imprint_filter_returns_single_row(client):
    import database as db_module
    row = (
        "Plavix",
        "1171",
        "Pink",
        "Round",
        "00000-0000-00",
        "123",
        "plavix.jpg",
        "plavix-1171",
        "75 mg",
    )

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        result = MagicMock()
        if "COUNT(*)" in sql_str:
            result.scalar.return_value = 1
        elif "LIMIT :limit OFFSET :offset" in sql_str:
            result.fetchall.return_value = [row]
        elif "SELECT image_filename FROM pillfinder" in sql_str:
            result.__iter__ = MagicMock(return_value=iter([(row[6],)]))
        else:
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.search.USE_DRUG_SYNONYMS", True):
        response = client.get("/api/search?q=plavix&type=drug&imprint=1171")
    assert response.status_code == 200
    assert len(response.json()["results"]) == 1


def test_search_imprint_only_does_not_use_synonyms_with_flag_on(client):
    import database as db_module
    executed_sql = []
    row = (
        "Clopidogrel",
        "TEVA 5728",
        "Pink",
        "Round",
        "00000-0000-01",
        "456",
        "clopi.jpg",
        "clopidogrel-teva-5728",
        "75 mg",
    )

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed_sql.append(sql_str)
        result = MagicMock()
        if "COUNT(*)" in sql_str:
            result.scalar.return_value = 1
        elif "LIMIT :limit OFFSET :offset" in sql_str:
            result.fetchall.return_value = [row]
        elif "SELECT image_filename FROM pillfinder" in sql_str:
            result.__iter__ = MagicMock(return_value=iter([(row[6],)]))
        else:
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.search.USE_DRUG_SYNONYMS", True):
        response = client.get("/api/search?q=TEVA%205728&type=imprint")
    assert response.status_code == 200
    assert len(response.json()["results"]) == 1
    combined = " ".join(executed_sql).lower()
    assert "drug_synonyms" not in combined


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


def test_api_pill_slug_prefers_brand_pronunciation_for_brand_primary_rows(client):
    import database as db_module

    pill_row = (
        "Plavix",
        "75",
        "Pink",
        "Round",
        "63653-1171-01",
        "174742",
        None,
        "plavix-75-1171",
        None,
    )
    pill_columns = [
        "medicine_name",
        "splimprint",
        "splcolor_text",
        "splshape_text",
        "ndc11",
        "rxcui",
        "image_filename",
        "slug",
        "meta_description",
    ]

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()
        result.keys.return_value = []
        result.fetchall.return_value = []

        if "from pillfinder" in sql_str:
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from drug_indications" in sql_str:
            result.fetchone.return_value = None
        elif "from drug_pronunciations" in sql_str:
            if (params or {}).get("drug_name_lower") == "plavix":
                result.fetchone.return_value = ("plav' ix", "https://cdn.example/plavix.mp3")
            else:
                result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch(
        "routes.details.get_synonyms_for_rxcui",
        return_value={
            "generic_name": "Clopidogrel",
            "brand_names": ["Plavix", "Iscover"],
            "product_tty": "SBD",
        },
    ), patch(
        "routes.details.get_pronunciation",
        return_value={
            "pronunciation_text": "kloh pid' oh grel",
            "audio_url": "https://cdn.example/clopidogrel.mp3",
        },
    ), patch(
        "routes.details._resolve_history_identifier",
        return_value={"history_ndc": None, "history_source": None},
    ):
        response = client.get("/api/pill/plavix-75-1171")

    assert response.status_code == 200
    data = response.json()
    assert data["pronunciation"] == "plav' ix"
    assert data["audio_url"] == "https://cdn.example/plavix.mp3"
    assert data["brand_pronunciation"] == "plav' ix"
    assert data["brand_audio_url"] == "https://cdn.example/plavix.mp3"
    assert data["generic_pronunciation"] == "kloh pid' oh grel"
    assert data["generic_audio_url"] == "https://cdn.example/clopidogrel.mp3"


def test_api_pill_slug_includes_synonym_fields_and_filters_self_brand(client):
    import database as db_module

    pill_row = (
        "Bayer",
        "ASPIRIN 500",
        "White",
        "Round",
        "0069-0020-01",
        "215831",
        "aspirin500.jpg",
        "aspirin-500mg-0069-0020-01",
        None,
    )
    pill_columns = [
        "medicine_name",
        "splimprint",
        "splcolor_text",
        "splshape_text",
        "ndc11",
        "rxcui",
        "image_filename",
        "slug",
        "meta_description",
    ]
    synonym_row = ("1191", "Aspirin", ["Ecotrin", "bayer", "Bufferin"], "SBD")

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        result = MagicMock()
        if "from pillfinder where deleted_at is null and published = true and slug = :slug" in sql_str.lower():
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from pill_ndcs" in sql_str.lower():
            result.fetchall.return_value = []
        elif "from public.medication_guide" in sql_str.lower():
            result.fetchone.return_value = None
        elif "from rxcui_to_ingredient" in sql_str.lower():
            result.fetchone.return_value = synonym_row
        elif "from drug_indications" in sql_str.lower():
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.details._resolve_history_identifier", return_value={"history_ndc": None, "history_source": None}):
        response = client.get("/api/pill/aspirin-500mg-0069-0020-01")
    assert response.status_code == 200
    data = response.json()
    assert "generic_name" in data
    assert "brand_names_all" in data
    assert data["generic_name"] == "Aspirin"
    assert data["brand_names_all"] == ["Bufferin", "Ecotrin"]


def test_api_pill_slug_always_includes_synonym_keys_when_unmapped(client):
    import database as db_module

    pill_row = ("Aspirin", "ASPIRIN 500", "White", "Round", "0069-0020-01", None, "aspirin500.jpg", "aspirin-500mg-0069-0020-01", None)
    pill_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text", "ndc11", "rxcui", "image_filename", "slug", "meta_description"]

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()
        if "from pillfinder where deleted_at is null and published = true and slug = :slug" in sql_str:
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from pill_ndcs" in sql_str:
            result.fetchall.return_value = []
        elif "from public.medication_guide" in sql_str:
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.details._resolve_history_identifier", return_value={"history_ndc": None, "history_source": None}):
        response = client.get("/api/pill/aspirin-500mg-0069-0020-01")
    assert response.status_code == 200
    data = response.json()
    assert data["generic_name"] is None
    assert data["brand_names_all"] == []


def test_api_pill_slug_includes_pronunciation_when_available(client):
    import database as db_module

    pill_row = ("Lisinopril", "20", "Pink", "Round", "0069-0020-01", "29046", "lisinopril.jpg", "lisinopril-20mg", None)
    pill_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text", "ndc11", "rxcui", "image_filename", "slug", "meta_description"]

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()
        if "from pillfinder where deleted_at is null and published = true and slug = :slug" in sql_str:
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from pill_ndcs" in sql_str:
            result.fetchall.return_value = []
        elif "from public.medication_guide" in sql_str:
            result.fetchone.return_value = None
        elif "from drug_indications" in sql_str:
            result.fetchone.return_value = None
        elif "from drug_pronunciations" in sql_str:
            result.fetchone.return_value = ("lye sin' oh pril", "https://cdn.example/lisinopril.mp3")
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.details._resolve_history_identifier", return_value={"history_ndc": None, "history_source": None}):
        response = client.get("/api/pill/lisinopril-20mg")

    assert response.status_code == 200
    assert response.json()["pronunciation"] == "lye sin' oh pril"
    assert response.json()["audio_url"] == "https://cdn.example/lisinopril.mp3"


def test_api_pill_slug_pronunciation_is_none_when_table_missing(client):
    import database as db_module

    pill_row = ("Lisinopril", "20", "Pink", "Round", "0069-0020-01", "29046", "lisinopril.jpg", "lisinopril-20mg", None)
    pill_columns = ["medicine_name", "splimprint", "splcolor_text", "splshape_text", "ndc11", "rxcui", "image_filename", "slug", "meta_description"]

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()
        if "from pillfinder where deleted_at is null and published = true and slug = :slug" in sql_str:
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from pill_ndcs" in sql_str:
            result.fetchall.return_value = []
        elif "from public.medication_guide" in sql_str:
            result.fetchone.return_value = None
        elif "from drug_indications" in sql_str:
            result.fetchone.return_value = None
        elif "from drug_pronunciations" in sql_str:
            raise SQLAlchemyError('relation "drug_pronunciations" does not exist')
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch("routes.details._resolve_history_identifier", return_value={"history_ndc": None, "history_source": None}):
        response = client.get("/api/pill/lisinopril-20mg")

    assert response.status_code == 200
    assert response.json()["pronunciation"] is None
    assert response.json()["audio_url"] is None


def test_api_pill_pronunciation_returns_generic_primary_with_brand_alternatives(client):
    import database as db_module

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()

        if "select medicine_name, rxcui from pillfinder" in sql_str:
            result.fetchone.return_value = ("Clopidogrel", "174742")
        elif "from drug_pronunciations" in sql_str:
            if (params or {}).get("drug_name_lower") == "plavix":
                result.fetchone.return_value = ("plav' ix", "https://cdn.example/plavix.mp3")
            else:
                result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    with patch(
        "routes.details.get_synonyms_for_rxcui",
        return_value={
            "generic_name": "Clopidogrel",
            "brand_names": ["Plavix"],
            "product_tty": "SCD",
        },
    ), patch(
        "routes.details.get_pronunciation",
        return_value={
            "pronunciation_text": "kloh pid' oh grel",
            "audio_url": "https://cdn.example/clopidogrel.mp3",
        },
    ):
        response = client.get("/api/pill/clopidogrel/pronunciation")

    assert response.status_code == 200
    data = response.json()
    assert data["drug_name"] == "Clopidogrel"
    assert data["pronunciation_text"] == "kloh pid' oh grel"
    assert data["audio_url"] == "https://cdn.example/clopidogrel.mp3"
    assert data["generic_pronunciation"] == "kloh pid' oh grel"
    assert data["generic_audio_url"] == "https://cdn.example/clopidogrel.mp3"
    assert data["brand_pronunciation"] == "plav' ix"
    assert data["brand_audio_url"] == "https://cdn.example/plavix.mp3"
    assert data["brand_names"] == ["Plavix"]
    assert data["is_brand_row"] is False


# ---------------------------------------------------------------------------
# Sitemap endpoint
# ---------------------------------------------------------------------------

def test_sitemap_returns_200(client):
    """GET /sitemap.xml should return 200 with XML content."""
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("aspirin-500mg-0069-0020-01",)]))
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [("aspirin-500mg-0069-0020-01", True, True, False, False, False)]
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = [slug_rows, guide_rows]
    response = client.get("/sitemap.xml")
    assert response.status_code == 200


def test_sitemap_content_type(client):
    """GET /sitemap.xml should return XML content type."""
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([]))
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = []
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = [slug_rows, guide_rows]
    response = client.get("/sitemap.xml")
    assert "xml" in response.headers.get("content-type", "")


def test_sitemap_contains_urlset(client):
    """GET /sitemap.xml should contain a urlset element."""
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("some-slug",)]))
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [("some-slug", True, True, False, False, False)]
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = [slug_rows, guide_rows]
    response = client.get("/sitemap.xml")
    assert b"urlset" in response.content


def test_sitemap_contains_guide_urls_when_available(client):
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("some-slug",)]))
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [("some-slug", True, True, False, False, False)]
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = [slug_rows, guide_rows]

    response = client.get("/sitemap.xml")

    assert b"/pill/some-slug/medication-guide" in response.content
    assert b"/pill/some-slug/professional-information" in response.content


def test_sitemap_includes_medication_summary_only_when_no_official_medguide(client):
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("summary-slug",), ("official-slug",)]))
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [
        ("summary-slug", False, True, True, False, False),
        ("official-slug", True, True, True, False, False),
    ]
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = [slug_rows, guide_rows]

    response = client.get("/sitemap.xml")

    assert b"/pill/summary-slug/medication-summary" in response.content
    assert b"/pill/official-slug/medication-summary" not in response.content


def test_sitemap_includes_dosage_and_adverse_reactions_urls(client):
    """Rows with has_dosage or has_adverse_reactions produce the correct sitemap entries."""
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("dose-slug",), ("ar-slug",)]))
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [
        ("dose-slug", False, False, False, True, False),
        ("ar-slug", False, False, False, False, True),
    ]
    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = [slug_rows, guide_rows]

    response = client.get("/sitemap.xml")

    assert b"/pill/dose-slug/dosage" in response.content
    assert b"/pill/ar-slug/adverse-reactions" in response.content
    assert b"/pill/dose-slug/adverse-reactions" not in response.content
    assert b"/pill/ar-slug/dosage" not in response.content


def test_sitemap_dosage_returns_200_and_dosage_urls(client):
    """GET /sitemap-dosage.xml returns 200 with dosage page URLs for slugs that have dosage."""
    import database as db_module
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [
        ("dose-slug", False, False, False, True, False),
        ("no-dose-slug", True, False, False, False, False),
    ]
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = guide_rows

    response = client.get("/sitemap-dosage.xml")

    assert response.status_code == 200
    assert "xml" in response.headers.get("content-type", "")
    assert b"/pill/dose-slug/dosage" in response.content
    assert b"/pill/no-dose-slug/dosage" not in response.content


def test_sitemap_adverse_reactions_returns_200_and_adverse_urls(client):
    """GET /sitemap-adverse-reactions.xml returns 200 with adverse reaction URLs for eligible slugs."""
    import database as db_module
    guide_rows = MagicMock()
    guide_rows.fetchall.return_value = [
        ("ar-slug", False, False, False, False, True),
        ("no-ar-slug", True, False, False, False, False),
    ]
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = guide_rows

    response = client.get("/sitemap-adverse-reactions.xml")

    assert response.status_code == 200
    assert "xml" in response.headers.get("content-type", "")
    assert b"/pill/ar-slug/adverse-reactions" in response.content
    assert b"/pill/no-ar-slug/adverse-reactions" not in response.content


def test_api_interaction_slugs_returns_deduplicated_rows_and_cache_headers(client):
    import database as db_module
    interaction_rows = MagicMock()
    interaction_rows.fetchall.return_value = [
        ("plavix-75-mg", "Clopidogrel", True, True, False),
        ("warfarin-5-mg", "Warfarin", True, False, True),
    ]
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = interaction_rows

    response = client.get("/api/slugs/interactions")

    assert response.status_code == 200
    assert response.headers.get("cache-control") == "public, max-age=86400, s-maxage=86400"
    assert response.json() == [
        {
            "slug": "plavix-75-mg",
            "drug_name": "Clopidogrel",
            "has_drug_interactions": True,
            "has_food_interactions": True,
            "has_disease_interactions": False,
        },
        {
            "slug": "warfarin-5-mg",
            "drug_name": "Warfarin",
            "has_drug_interactions": True,
            "has_food_interactions": False,
            "has_disease_interactions": True,
        },
    ]


def test_sitemap_interactions_returns_200_and_interaction_urls(client):
    import database as db_module
    interaction_rows = MagicMock()
    interaction_rows.fetchall.return_value = [
        ("plavix-75-mg", "Clopidogrel", True, True, False),
        ("warfarin-5-mg", "Warfarin", True, False, True),
    ]
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = interaction_rows

    response = client.get("/sitemap-interactions.xml")

    assert response.status_code == 200
    assert "xml" in response.headers.get("content-type", "")
    assert b"/pill/plavix-75-mg/interactions" in response.content
    assert b"/pill/warfarin-5-mg/interactions" in response.content


def test_fetch_guide_page_slugs_falls_back_on_missing_columns(client):
    """_fetch_guide_page_slugs retries with a compat query when dosage columns are absent."""
    from sqlalchemy.exc import SQLAlchemyError as _SA
    import database as db_module
    from routes.sitemap import _fetch_guide_page_slugs

    compat_rows = MagicMock()
    compat_rows.fetchall.return_value = [
        ("slug-a", True, False, False),
    ]

    full_error = _SA("column mg.dosage_administration does not exist")

    conn = MagicMock()
    conn.execute.side_effect = [full_error, compat_rows]

    result = _fetch_guide_page_slugs(conn)

    assert len(result) == 1
    assert result[0].slug == "slug-a"
    assert result[0].has_medguide is True
    assert result[0].has_dosage is False
    assert result[0].has_adverse_reactions is False


def test_sitemap_prices_returns_200_and_price_urls(client):
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("some-slug",)]))
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = slug_rows

    response = client.get("/sitemap-prices.xml")

    assert response.status_code == 200
    assert b"/pill/some-slug/price" in response.content
    assert b"<changefreq>weekly</changefreq>" in response.content
    assert b"<priority>0.7</priority>" in response.content


def test_sitemap_prices_content_type(client):
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([]))
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = slug_rows

    response = client.get("/sitemap-prices.xml")
    assert "xml" in response.headers.get("content-type", "")


def test_sitemap_prices_escapes_slug_xml(client):
    import database as db_module
    slug_rows = MagicMock()
    slug_rows.__iter__ = MagicMock(return_value=iter([("name&value",)]))
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = slug_rows

    response = client.get("/sitemap-prices.xml")
    assert b"/pill/name%26value/price" in response.content


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
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
    response = client.get("/api/slugs")
    assert response.status_code == 200


def test_api_slugs_returns_list_of_strings(client):
    """GET /api/slugs should return a JSON array of slug strings."""
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(
        return_value=iter([("aspirin-500mg-01",), ("ibuprofen-200mg-02",)])
    )
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
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
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result
    response = client.get("/api/slugs")
    data = response.json()
    assert None not in data
    assert len(data) == 2


def test_api_slugs_images_returns_slug_image_entries(client):
    import database as db_module
    mock_result = MagicMock()
    mock_result.__iter__ = MagicMock(
        return_value=iter([
            ("aspirin-500mg-01", "aspirin-1.jpg;aspirin-2.jpg"),
            ("ibuprofen-200mg-02", " "),
            ("acetaminophen-500mg-03", "https://cdn.example.com/acetaminophen.jpg"),
        ])
    )
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result

    with patch(
        "routes.sitemap._build_image_urls",
        side_effect=[
            [
                "https://images.example.com/aspirin-1.jpg",
                "https://images.example.com/aspirin-2.jpg",
            ],
            [],
            ["https://cdn.example.com/acetaminophen.jpg"],
        ],
    ):
        response = client.get("/api/slugs/images")

    assert response.status_code == 200
    payload = response.json()
    assert payload == [
        {
            "slug": "aspirin-500mg-01",
            "images": [
                "https://images.example.com/aspirin-1.jpg",
                "https://images.example.com/aspirin-2.jpg",
            ],
        },
        {
            "slug": "acetaminophen-500mg-03",
            "images": ["https://cdn.example.com/acetaminophen.jpg"],
        },
    ]
    assert all(item["slug"] != "ibuprofen-200mg-02" for item in payload)


def test_api_guide_page_slugs_returns_availability_payload(client):
    import database as db_module
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [
        ("aspirin-500mg-01", True, False, False, False, False),
        ("ibuprofen-200mg-02", False, True, True, True, False),
    ]
    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.side_effect = None
    conn_mock.execute.return_value = mock_result

    response = client.get("/api/slugs/guide-pages")

    assert response.status_code == 200
    assert response.json() == [
        {
            "slug": "aspirin-500mg-01",
            "has_medguide": True,
            "has_professional": False,
            "has_medication_summary": False,
            "has_dosage": False,
            "has_adverse_reactions": False,
        },
        {
            "slug": "ibuprofen-200mg-02",
            "has_medguide": False,
            "has_professional": True,
            "has_medication_summary": True,
            "has_dosage": True,
            "has_adverse_reactions": False,
        },
    ]


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


# ---------------------------------------------------------------------------
# /api/pill/{slug} — medication guide compat fallback
# ---------------------------------------------------------------------------

def _make_pill_slug_compat_engine(medguide_exists: bool, error_msg: str):
    """Build a mock engine whose execute() simulates the migration-safety scenario.

    The guide-flags query that selects medication_summary_html raises an
    SQLAlchemyError (column does not exist).  The compat query that only
    selects medguide_html succeeds and returns *medguide_exists*.
    """
    from sqlalchemy.exc import SQLAlchemyError

    mock_pill_row = (
        "Plavix", "75", "Pink", "Round", "63653-1171-01", "174742",
        None, "plavix-75-1171", None,
    )
    mock_columns = [
        "medicine_name", "splimprint", "splcolor_text", "splshape_text",
        "ndc11", "rxcui", "image_filename", "slug", "meta_description",
    ]

    def _execute(sql, params=None):
        sql_str = str(sql).lower()

        if "pillfinder" in sql_str:
            r = MagicMock()
            r.fetchone.return_value = mock_pill_row
            r.keys.return_value = mock_columns
            r.fetchall.return_value = []
            return r

        if "pill_ndcs" in sql_str:
            r = MagicMock()
            r.fetchone.return_value = None
            r.fetchall.return_value = []
            return r

        if "medication_summary_html" in sql_str:
            raise SQLAlchemyError(error_msg)

        if "medguide_html" in sql_str:
            # Use a plain tuple so bool(row[0]) works reliably without __getitem__ magic
            compat_row = (medguide_exists,)
            r = MagicMock()
            r.fetchone.return_value = compat_row
            r.fetchall.return_value = []
            return r

        if "drug_indications" in sql_str:
            r = MagicMock()
            r.fetchone.return_value = None
            r.fetchall.return_value = []
            return r

        # Default: image aggregation queries, etc.
        r = MagicMock()
        r.fetchone.return_value = None
        r.fetchall.return_value = []
        r.__iter__ = lambda self: iter([])
        return r

    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.execute.side_effect = _execute

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    return mock_engine


def test_api_pill_slug_has_medguide_true_when_summary_column_missing(client):
    """has_medguide=True must survive when medication_summary_html column is absent (missing migration)."""
    import database as db_module

    mock_engine = _make_pill_slug_compat_engine(
        medguide_exists=True,
        error_msg='column "medication_summary_html" does not exist',
    )
    original = db_module.db_engine
    try:
        db_module.db_engine = mock_engine
        response = client.get("/api/pill/plavix-75-1171")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    data = response.json()
    assert data["has_medguide"] is True
    assert data["has_medication_summary"] is False
    assert data["has_dosage"] is False


def test_api_pill_slug_has_medguide_false_when_summary_column_missing_and_no_guide(client):
    """has_medguide=False when medication_summary_html column absent and no official guide exists."""
    import database as db_module

    mock_engine = _make_pill_slug_compat_engine(
        medguide_exists=False,
        error_msg='column "medication_summary_html" does not exist',
    )
    original = db_module.db_engine
    try:
        db_module.db_engine = mock_engine
        response = client.get("/api/pill/plavix-75-1171")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    data = response.json()
    assert data["has_medguide"] is False
    assert data["has_medication_summary"] is False
    assert data["has_dosage"] is False


def test_api_pill_slug_has_dosage_when_dosage_column_exists(client):
    """has_dosage should follow dosage section availability."""
    import database as db_module

    pill_row = (
        "Plavix", "75", "Pink", "Round", "63653-1171-01", "174742",
        None, "plavix-75-1171", None,
    )
    pill_columns = [
        "medicine_name", "splimprint", "splcolor_text", "splshape_text",
        "ndc11", "rxcui", "image_filename", "slug", "meta_description",
    ]

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()

        if "from pillfinder where deleted_at is null and published = true and slug = :slug" in sql_str:
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from pill_ndcs" in sql_str:
            result.fetchall.return_value = []
        elif "from public.medication_guide" in sql_str:
            if "nullif(mg.dosage_administration, '') is not null" in sql_str:
                result.fetchone.return_value = (False, False, True, False)
            else:
                result.fetchone.return_value = (False, False, False, False)
        elif "from drug_indications" in sql_str:
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))

        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect

    with patch(
        "routes.details._resolve_history_identifier",
        return_value={"history_ndc": None, "history_source": None},
    ):
        response = client.get("/api/pill/plavix-75-1171")

    assert response.status_code == 200
    assert response.json()["has_dosage"] is True


def test_api_pill_slug_has_adverse_reactions_when_adverse_reactions_exists(client):
    """has_adverse_reactions should follow adverse_reactions or side_effects availability."""
    import database as db_module

    pill_row = (
        "Plavix", "75", "Pink", "Round", "63653-1171-01", "174742",
        None, "plavix-75-1171", None,
    )
    pill_columns = [
        "medicine_name", "splimprint", "splcolor_text", "splshape_text",
        "ndc11", "rxcui", "image_filename", "slug", "meta_description",
    ]

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()

        if "from pillfinder where deleted_at is null and published = true and slug = :slug" in sql_str:
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
        elif "from pill_ndcs" in sql_str:
            result.fetchall.return_value = []
        elif "from public.medication_guide" in sql_str:
            if "nullif(mg.adverse_reactions, '') is not null" in sql_str:
                result.fetchone.return_value = (False, False, False, True)
            else:
                result.fetchone.return_value = (False, False, False, False)
        elif "from drug_indications" in sql_str:
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            result.__iter__ = MagicMock(return_value=iter([]))

        return result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect

    with patch(
        "routes.details._resolve_history_identifier",
        return_value={"history_ndc": None, "history_source": None},
    ):
        response = client.get("/api/pill/plavix-75-1171")

    assert response.status_code == 200
    assert response.json()["has_adverse_reactions"] is True


# ---------------------------------------------------------------------------
# /api/pill/{slug}/dosage endpoint
# ---------------------------------------------------------------------------

def _make_pill_dosage_engine(
    *,
    dosage_value,
    has_guide: bool = True,
    pill_overrides: dict | None = None,
    guide_overrides: dict | None = None,
):
    from datetime import datetime, timezone

    pill_columns = [
        "medicine_name",
        "rxcui",
        "ndc11",
        "ndc9",
        "spl_set_id",
        "dosage_form",
        "dailymed_pharma_class_epc",
        "pharmclass_fda_epc",
    ]
    pill_values = {
        "medicine_name": "Plavix",
        "rxcui": "174742",
        "ndc11": "63653-1171-01",
        "ndc9": "636531171",
        "spl_set_id": "setid-123",
        "dosage_form": "tablet",
        "dailymed_pharma_class_epc": "Platelet Aggregation Inhibitor [EPC]",
        "pharmclass_fda_epc": None,
    }
    if pill_overrides:
        pill_values.update(pill_overrides)
    pill_row = tuple(pill_values[column] for column in pill_columns)

    guide_columns = [
        "generic_name",
        "brand_name",
        "rxcui",
        "ndc",
        "spl_set_id",
        "dosage_administration",
        "dosage",
        "side_effects",
        "adverse_reactions",
        "has_boxed_warning",
        "boxed_warning_html",
        "source_url",
        "fetched_at",
    ]
    guide_values = {
        "generic_name": "clopidogrel",
        "brand_name": "Plavix",
        "rxcui": "174742",
        "ndc": "63653-1171-01",
        "spl_set_id": "setid-123",
        "dosage_administration": dosage_value,
        "dosage": "<p>75 mg tablets</p>",
        "side_effects": "<p>Bleeding</p>",
        "adverse_reactions": "<p>Bleeding</p>",
        "has_boxed_warning": True,
        "boxed_warning_html": "<p>Boxed warning</p>",
        "source_url": "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=setid-123",
        "fetched_at": datetime(2026, 5, 20, 12, 0, tzinfo=timezone.utc),
    }
    if guide_overrides:
        guide_values.update(guide_overrides)
    guide_row = tuple(guide_values[column] for column in guide_columns)

    def _execute(sql, params=None):
        sql_str = str(sql).lower()

        if "from pillfinder" in sql_str:
            result = MagicMock()
            result.fetchone.return_value = pill_row
            result.keys.return_value = pill_columns
            return result

        if "from public.medication_guide" in sql_str:
            result = MagicMock()
            if has_guide:
                params = params or {}
                guide_spl_set_id = str(guide_values.get("spl_set_id") or "")
                guide_rxcui = str(guide_values.get("rxcui") or "")
                guide_ndc = str(guide_values.get("ndc") or "")
                guide_ndc_clean = guide_ndc.replace("-", "")
                lookup_spl = str(params.get("spl_set_id") or "")
                lookup_rxcui = str(params.get("rxcui") or "")
                lookup_ndc = str(params.get("ndc") or "")
                lookup_ndc_clean = str(params.get("ndc_clean") or "")
                matches = (
                    (lookup_spl and lookup_spl == guide_spl_set_id)
                    or (lookup_rxcui and lookup_rxcui == guide_rxcui)
                    or (
                        lookup_ndc
                        and (
                            lookup_ndc == guide_ndc
                            or lookup_ndc.replace("-", "") == guide_ndc_clean
                            or (lookup_ndc_clean and lookup_ndc_clean == guide_ndc_clean)
                        )
                    )
                )
                result.fetchone.return_value = MagicMock(_mapping=dict(zip(guide_columns, guide_row)))
                if not matches:
                    result.fetchone.return_value = None
            else:
                result.fetchone.return_value = None
            return result

        result = MagicMock()
        result.fetchone.return_value = None
        return result

    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.execute.side_effect = _execute

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    return mock_engine


def test_api_pill_dosage_returns_404_for_missing_slug(client):
    import database as db_module

    missing_result = MagicMock()
    missing_result.fetchone.return_value = None

    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.return_value = missing_result

    response = client.get("/api/pill/nonexistent-slug/dosage")
    assert response.status_code == 404
    assert response.json()["detail"] == "Pill not found"


def test_api_pill_dosage_returns_payload_when_guide_exists(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(dosage_value="<p>Take once daily.</p>", has_guide=True)
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/dosage")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["drug_name"] == "Plavix"
    assert payload["generic_name"] == "clopidogrel"
    assert payload["brand_name"] == "Plavix"
    assert payload["rxcui"] == "174742"
    assert payload["ndc"] == "63653-1171-01"
    assert payload["spl_set_id"] == "setid-123"
    assert payload["dosage_administration"] == "<p>Take once daily.</p>"
    assert payload["dosage_forms_and_strengths"] == "<p>75 mg tablets</p>"
    assert payload["has_boxed_warning"] is True
    assert payload["boxed_warning_html"] == "<p>Boxed warning</p>"
    assert payload["drug_class"] == "Platelet Aggregation Inhibitor [EPC]"
    assert payload["dosage_form"] == "tablet"
    assert payload["source_url"].startswith("https://dailymed.nlm.nih.gov/")
    assert payload["fetched_at"] == "2026-05-20T12:00:00Z"


def test_api_pill_dosage_returns_cache_control_header(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(dosage_value="<p>Take once daily.</p>", has_guide=True)
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/dosage")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    assert response.headers.get("cache-control") == "public, max-age=3600, stale-while-revalidate=86400"


def test_api_pill_dosage_returns_null_for_blank_dosage(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(dosage_value="   ", has_guide=True)
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/dosage")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["dosage_administration"] is None


def test_api_pill_dosage_resolves_with_mismatched_identifiers(client):
    import database as db_module
    from services.medication_guide import GuideNotFoundError

    calls = []

    async def _fake_build_guide(**kwargs):
        calls.append(kwargs)
        if kwargs == {"ndc": "00024117190"}:
            raise GuideNotFoundError("not found")
        if kwargs == {"rxcui": "749198"}:
            raise GuideNotFoundError("not found")
        if kwargs == {"ndc": "0024-1171"}:
            return {
                "spl_set_id": "de8b0b67-eb25-4684-83b5-7ad785314227",
                "rxcui": "213169",
                "ndc": "0024-1171",
            }
        raise GuideNotFoundError("not found")

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(
            dosage_value="<p>Take once daily.</p>",
            has_guide=True,
            pill_overrides={
                "rxcui": "749198",
                "ndc11": "00024117190",
                "ndc9": "0024-1171",
                "spl_set_id": None,
            },
            guide_overrides={
                "rxcui": "213169",
                "ndc": "0024-1171",
                "spl_set_id": "de8b0b67-eb25-4684-83b5-7ad785314227",
            },
        )
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix/dosage")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["dosage_administration"] == "<p>Take once daily.</p>"
    assert payload["dosage_forms_and_strengths"] == "<p>75 mg tablets</p>"
    assert payload["rxcui"] == "213169"
    assert payload["ndc"] == "0024-1171"
    assert calls == [{"ndc": "00024117190"}, {"rxcui": "749198"}, {"ndc": "0024-1171"}]


# ---------------------------------------------------------------------------
# /api/pill/{slug}/adverse-reactions endpoint
# ---------------------------------------------------------------------------

def test_api_pill_adverse_reactions_returns_404_for_missing_slug(client):
    import database as db_module

    missing_result = MagicMock()
    missing_result.fetchone.return_value = None

    conn_mock = db_module.db_engine.connect.return_value.__enter__.return_value
    conn_mock.execute.return_value = missing_result

    response = client.get("/api/pill/nonexistent-slug/adverse-reactions")
    assert response.status_code == 404
    assert response.json()["detail"] == "Pill not found"


def test_api_pill_adverse_reactions_returns_payload_when_guide_exists(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(dosage_value="<p>Take once daily.</p>", has_guide=True)
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/adverse-reactions")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["drug_name"] == "Plavix"
    assert payload["generic_name"] == "clopidogrel"
    assert payload["brand_name"] == "Plavix"
    assert payload["rxcui"] == "174742"
    assert payload["ndc"] == "63653-1171-01"
    assert payload["spl_set_id"] == "setid-123"
    assert payload["adverse_reactions"] == "<p>Bleeding</p>"
    assert payload["side_effects"] == "<p>Bleeding</p>"
    assert payload["source_url"].startswith("https://dailymed.nlm.nih.gov/")
    assert payload["fetched_at"] == "2026-05-20T12:00:00Z"
    assert response.headers.get("cache-control") == "public, max-age=3600, stale-while-revalidate=86400"


def test_api_pill_adverse_reactions_prefers_dedicated_column(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(
            dosage_value="<p>Take once daily.</p>",
            has_guide=True,
            guide_overrides={
                "adverse_reactions": "<section><h2>Adverse Reactions</h2><p>Full section</p></section>",
                "side_effects": None,
            },
        )
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/adverse-reactions")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["adverse_reactions"] == "<section><h2>Adverse Reactions</h2><p>Full section</p></section>"
    assert payload["side_effects"] == "<section><h2>Adverse Reactions</h2><p>Full section</p></section>"


def test_api_pill_adverse_reactions_falls_back_to_side_effects(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(
            dosage_value="<p>Take once daily.</p>",
            has_guide=True,
            guide_overrides={
                "adverse_reactions": None,
                "side_effects": "<p>Fallback side effects</p>",
            },
        )
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/adverse-reactions")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["adverse_reactions"] == "<p>Fallback side effects</p>"
    assert payload["side_effects"] == "<p>Fallback side effects</p>"


def test_api_pill_adverse_reactions_returns_null_for_blank_content(client):
    import database as db_module

    async def _fake_build_guide(**kwargs):
        return {"spl_set_id": "setid-123", "rxcui": "174742", "ndc": "63653-1171-01"}

    original = db_module.db_engine
    try:
        db_module.db_engine = _make_pill_dosage_engine(
            dosage_value="<p>Take once daily.</p>",
            has_guide=True,
            guide_overrides={"adverse_reactions": "   ", "side_effects": "   "},
        )
        with patch("routes.details.build_guide", side_effect=_fake_build_guide):
            response = client.get("/api/pill/plavix-75-1171/adverse-reactions")
    finally:
        db_module.db_engine = original

    assert response.status_code == 200
    payload = response.json()
    assert payload["adverse_reactions"] is None
    assert payload["side_effects"] is None
