import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from routes.admin.auth import get_admin_user
from services.indexnow import IndexNowConfig, IndexNowSubmissionError, IndexNowSubmissionResult


def _mock_engine_with_side_effect(side_effect):
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.execute.side_effect = side_effect
    mock_engine.begin.return_value = mock_conn
    mock_engine.connect.return_value = mock_conn
    return mock_engine


def _before_row(slug: str, rxcui: str = "12345"):
    row = MagicMock()
    row._fields = ["id", "slug", "rxcui", "medicine_name"]
    row.__iter__ = MagicMock(return_value=iter(["pill-1", slug, rxcui, "Sample"]))
    return row


@pytest.fixture
def client():
    with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        app_module.app.dependency_overrides[get_admin_user] = lambda: {
            "id": "00000000-0000-0000-0000-000000000001",
            "email": "admin@test.com",
            "role": "superuser",
        }
        db_module.db_engine = None
        try:
            with TestClient(app_module.app) as test_client:
                yield test_client
        finally:
            app_module.app.dependency_overrides.clear()


def test_create_publish_submits_indexnow_urls(client):
    config = IndexNowConfig(
        key="abc123",
        key_location="https://pillseek.com/abc123.txt",
        site_url="https://pillseek.com",
        host="pillseek.com",
    )

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "insert into pillfinder" in sql_str:
            result.fetchone.return_value = ("pill-1", "Drug Name/10")
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    import database as db_module

    db_module.db_engine = _mock_engine_with_side_effect(side_effect)

    with patch("routes.admin.pills.validate_pill", return_value=[]), patch(
        "routes.admin.pills._best_effort_ensure_synonym_mapping", return_value=None
    ), patch(
        "routes.admin.indexnow.load_indexnow_config", return_value=config
    ), patch(
        "routes.admin.indexnow.submit_indexnow_urls",
        return_value=IndexNowSubmissionResult(3, 3, 0, 1, 1, 0),
    ) as submit_mock:
        response = client.post(
            "/api/admin/pills?publish=true",
            json={"medicine_name": "Drug Name", "slug": "Drug Name/10"},
        )

    assert response.status_code == 201, response.text
    assert response.json()["indexnow_queued"] is True
    assert submit_mock.call_count == 1
    assert submit_mock.call_args.args[0] == [
        "https://pillseek.com/pill/Drug%20Name%2F10",
        "https://pillseek.com/pill/Drug%20Name%2F10/medication-guide",
        "https://pillseek.com/pill/Drug%20Name%2F10/professional-information",
    ]
    assert submit_mock.call_args.kwargs["ignore_errors"] is True


def test_create_publish_swallow_indexnow_config_error(client):
    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "insert into pillfinder" in sql_str:
            result.fetchone.return_value = ("pill-1", "live-pill")
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    import database as db_module

    db_module.db_engine = _mock_engine_with_side_effect(side_effect)

    with patch("routes.admin.pills.validate_pill", return_value=[]), patch(
        "routes.admin.pills._best_effort_ensure_synonym_mapping", return_value=None
    ), patch(
        "routes.admin.indexnow.load_indexnow_config",
        side_effect=IndexNowSubmissionError("INDEXNOW_KEY environment variable is not set"),
    ), patch("routes.admin.indexnow.submit_indexnow_urls") as submit_mock:
        response = client.post(
            "/api/admin/pills?publish=true",
            json={"medicine_name": "Drug Name", "slug": "live-pill"},
        )

    assert response.status_code == 201, response.text
    assert "indexnow_queued" not in response.json()
    assert submit_mock.call_count == 0


def test_update_published_pill_submits_indexnow_urls(client):
    config = IndexNowConfig(
        key="abc123",
        key_location="https://pillseek.com/abc123.txt",
        site_url="https://pillseek.com",
        host="pillseek.com",
    )

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "select updated_at, published, slug from pillfinder" in sql_str:
            result.fetchone.return_value = (datetime(2024, 1, 1, tzinfo=timezone.utc), True, "live-pill")
        elif "select * from pillfinder where id = :id limit 1" in sql_str:
            result.fetchone.return_value = _before_row("live-pill")
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    import database as db_module

    db_module.db_engine = _mock_engine_with_side_effect(side_effect)

    with patch("routes.admin.pills._best_effort_ensure_synonym_mapping", return_value=None), patch(
        "routes.admin.indexnow.load_indexnow_config", return_value=config
    ), patch(
        "routes.admin.indexnow.submit_indexnow_urls",
        return_value=IndexNowSubmissionResult(3, 3, 0, 1, 1, 0),
    ) as submit_mock:
        response = client.put(
            "/api/admin/pills/pill-1",
            json={"medicine_name": "Updated Name", "meta_title": "Meta"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["indexnow_queued"] is True
    assert submit_mock.call_count == 1
    assert submit_mock.call_args.args[0] == [
        "https://pillseek.com/pill/live-pill",
        "https://pillseek.com/pill/live-pill/medication-guide",
        "https://pillseek.com/pill/live-pill/professional-information",
    ]


def test_update_unpublished_pill_does_not_submit_indexnow(client):
    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "select updated_at, published, slug from pillfinder" in sql_str:
            result.fetchone.return_value = (datetime(2024, 1, 1, tzinfo=timezone.utc), False, "draft-pill")
        elif "select * from pillfinder where id = :id limit 1" in sql_str:
            result.fetchone.return_value = _before_row("draft-pill")
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    import database as db_module

    db_module.db_engine = _mock_engine_with_side_effect(side_effect)

    with patch("routes.admin.pills._best_effort_ensure_synonym_mapping", return_value=None), patch(
        "routes.admin.indexnow.submit_indexnow_urls"
    ) as submit_mock:
        response = client.put(
            "/api/admin/pills/pill-1",
            json={"medicine_name": "Draft edit", "meta_title": "Meta"},
        )

    assert response.status_code == 200, response.text
    assert "indexnow_queued" not in response.json()
    assert submit_mock.call_count == 0


def test_publish_draft_returns_indexnow_queued_flag(client):
    config = IndexNowConfig(
        key="abc123",
        key_location="https://pillseek.com/abc123.txt",
        site_url="https://pillseek.com",
        host="pillseek.com",
    )

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "select id, pill_id, draft_data, status from pill_drafts" in sql_str:
            result.fetchone.return_value = (
                "draft-1",
                "pill-1",
                {"medicine_name": "Drug Name", "slug": "live-pill"},
                "approved",
            )
        elif "select slug from pillfinder" in sql_str:
            result.fetchone.return_value = ("live-pill",)
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    import database as db_module

    db_module.db_engine = _mock_engine_with_side_effect(side_effect)

    with patch("routes.admin.indexnow.load_indexnow_config", return_value=config), patch(
        "routes.admin.indexnow.submit_indexnow_urls",
        return_value=IndexNowSubmissionResult(3, 3, 0, 1, 1, 0),
    ) as submit_mock:
        response = client.post("/api/admin/drafts/draft-1/publish")

    assert response.status_code == 200, response.text
    assert response.json()["indexnow_queued"] is True
    assert submit_mock.call_count == 1
