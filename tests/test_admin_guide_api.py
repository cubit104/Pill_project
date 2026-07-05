"""Tests for admin medication guide endpoints."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://" + "test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

FAKE_SUPERUSER = {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "admin@test.com",
    "role": "superuser",
}
FAKE_EDITOR = {
    "id": "00000000-0000-0000-0000-000000000002",
    "email": "editor@test.com",
    "role": "editor",
}


@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine.connect.return_value = mock_conn
        mock_engine.begin.return_value = mock_conn
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


def _mock_auth_with_role(role: str):
    user = FAKE_SUPERUSER if role == "superuser" else FAKE_EDITOR
    return patch("routes.admin.auth.get_admin_user", return_value=user)


def test_admin_guide_endpoints_require_auth(client):
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        assert client.get("/api/admin/guide/search").status_code == 401
        assert client.get("/api/admin/guide/pill-1/status").status_code == 401
        assert client.post("/api/admin/guide/pill-1/lookup-setid").status_code == 401


def test_search_returns_pills_with_guide_status_flags(client):
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "from profiles" in sql_str:
            result.fetchone.return_value = ("superuser",)
        elif "select count(*) from pillfinder p" in sql_str:
            result.scalar.return_value = 1
        elif "from pillfinder p" in sql_str:
            result.fetchall.return_value = [(
                "pill-1",
                "Ubrelvy",
                "50 mg",
                "12345",
                "00023649707",
                "fd9f9458-fd96-4688-be3f-f77b3d1af6ab",
                "ubrelvy-50-mg",
                True,
                False,
                True,
                False,
                None,
            )]
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = side_effect
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_SUPERUSER["id"]}):
        resp = client.get(
            "/api/admin/guide/search?q=ubrelvy&missing_only=true&page=1&per_page=20",
            headers={"Authorization": "Bearer " + "faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 1
    assert len(data["pills"]) == 1
    pill = data["pills"][0]
    assert pill["medicine_name"] == "Ubrelvy"
    assert pill["has_professional"] is True
    assert pill["has_medguide"] is False
    assert pill["has_dosage"] is True
    assert pill["has_side_effects"] is False


def test_set_setid_requires_superuser(client):
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_EDITOR["id"]}):
        resp = client.post(
            "/api/admin/guide/pill-1/set-setid",
            json={"spl_set_id": "new-set-id"},
            headers={"Authorization": "Bearer " + "faketoken"},
        )

    assert resp.status_code == 403


def test_lookup_setid_prefers_drug_name_then_stops(client):
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "from profiles" in sql_str:
            result.fetchone.return_value = ("superuser",)
        elif "from pillfinder" in sql_str:
            row = MagicMock()
            row._mapping = {
                "id": "pill-1",
                "medicine_name": "Ubrelvy",
                "spl_strength": "50 mg",
                "rxcui": "12345",
                "ndc11": "00023649707",
                "ndc9": "000236497",
                "spl_set_id": None,
                "slug": "ubrelvy-50-mg",
            }
            result.fetchone.return_value = row
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_SUPERUSER["id"]}), patch(
        "routes.admin.guide._lookup_setid_from_dailymed",
        new=AsyncMock(return_value="fd9f9458-fd96-4688-be3f-f77b3d1af6ab"),
    ) as lookup_mock:
        resp = client.post(
            "/api/admin/guide/pill-1/lookup-setid",
            headers={"Authorization": "Bearer " + "faketoken"},
        )

    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "spl_set_id": "fd9f9458-fd96-4688-be3f-f77b3d1af6ab",
        "source": "drug_name",
    }
    lookup_mock.assert_awaited_once_with(key="drug_name", value="Ubrelvy")
