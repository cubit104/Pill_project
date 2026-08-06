import os
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/testdb")

import routes.details as details_routes
from routes.admin.auth import get_admin_user


def _result(*, row=None, keys=None, rows=None):
    result = MagicMock()
    result.fetchone.return_value = row
    result.keys.return_value = keys or []
    result.fetchall.return_value = rows or []
    return result


def test_preview_route_returns_unpublished_pill_for_admin():
    app = FastAPI()
    app.include_router(details_routes.router)
    app.dependency_overrides[get_admin_user] = lambda: {"id": "admin-user"}

    preview_row = (
        "pill-123",
        "Draftmed",
        "DRAFT 10",
        "White",
        "Round",
        "draftmed-10",
        False,
        "draft.jpg",
        "12345",
        "12345-6789-01",
        None,
    )
    preview_columns = [
        "id",
        "medicine_name",
        "splimprint",
        "splcolor_text",
        "splshape_text",
        "slug",
        "published",
        "image_filename",
        "rxcui",
        "ndc11",
        "meta_description",
    ]

    def execute_side_effect(sql, params=None, *args, **kwargs):
        sql_text = str(sql).lower()
        if "from pillfinder" in sql_text and "id = :pill_id" in sql_text:
            return _result(row=preview_row, keys=preview_columns)
        if "from pill_ndcs" in sql_text:
            return _result(rows=[])
        if "from public.medication_guide" in sql_text:
            return _result(row=None)
        if "from drug_indications" in sql_text:
            return _result(row=None)
        return _result(row=None)

    mock_conn = MagicMock()
    mock_conn.execute.side_effect = execute_side_effect
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn

    with patch.object(details_routes.database, "db_engine", mock_engine), patch.object(
        details_routes, "_resolve_history_identifier", return_value={"history_ndc": None, "history_source": None}
    ), patch.object(
        details_routes, "_resolve_pill_pronunciations", return_value={}
    ), patch.object(
        details_routes, "get_synonyms_for_rxcui", return_value={}
    ):
        client = TestClient(app)
        response = client.get("/pill/preview/pill-123")

    assert response.status_code == 200
    data = response.json()
    assert data["drug_name"] == "Draftmed"
    assert data["slug"] == "draftmed-10"
    assert data["published"] is False
    assert data["preview_banner"] == "DRAFT - Not Published"
    assert data["is_preview"] is True


def test_preview_route_omits_draft_banner_for_published_pill():
    app = FastAPI()
    app.include_router(details_routes.router)
    app.dependency_overrides[get_admin_user] = lambda: {"id": "admin-user"}

    preview_row = (
        "pill-456",
        "Livemed",
        "LIVE 20",
        "Blue",
        "Oval",
        "livemed-20",
        True,
        "live.jpg",
        "67890",
        "54321-6789-01",
        None,
    )
    preview_columns = [
        "id",
        "medicine_name",
        "splimprint",
        "splcolor_text",
        "splshape_text",
        "slug",
        "published",
        "image_filename",
        "rxcui",
        "ndc11",
        "meta_description",
    ]

    def execute_side_effect(sql, params=None, *args, **kwargs):
        sql_text = str(sql).lower()
        if "from pillfinder" in sql_text and "id = :pill_id" in sql_text:
            return _result(row=preview_row, keys=preview_columns)
        if "from pill_ndcs" in sql_text:
            return _result(rows=[])
        if "from public.medication_guide" in sql_text:
            return _result(row=None)
        if "from drug_indications" in sql_text:
            return _result(row=None)
        return _result(row=None)

    mock_conn = MagicMock()
    mock_conn.execute.side_effect = execute_side_effect
    mock_engine = MagicMock()
    mock_engine.connect.return_value.__enter__.return_value = mock_conn

    with patch.object(details_routes.database, "db_engine", mock_engine), patch.object(
        details_routes, "_resolve_history_identifier", return_value={"history_ndc": None, "history_source": None}
    ), patch.object(
        details_routes, "_resolve_pill_pronunciations", return_value={}
    ), patch.object(
        details_routes, "get_synonyms_for_rxcui", return_value={}
    ):
        client = TestClient(app)
        response = client.get("/pill/preview/pill-456")

    assert response.status_code == 200
    data = response.json()
    assert data["published"] is True
    assert data["preview_banner"] is None


def test_preview_route_requires_admin_auth():
    app = FastAPI()
    app.include_router(details_routes.router)

    client = TestClient(app)
    response = client.get("/pill/preview/pill-123")

    assert response.status_code == 401
