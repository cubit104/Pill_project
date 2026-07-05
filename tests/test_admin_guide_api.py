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


def _make_pill_row():
    row = MagicMock()
    row._mapping = {
        "id": "pill-1",
        "medicine_name": "Ubrelvy",
        "spl_strength": "50 mg",
        "rxcui": "12345",
        "ndc11": "00023649707",
        "ndc9": "000236497",
        "spl_set_id": "fd9f9458-fd96-4688-be3f-f77b3d1af6ab",
        "slug": "ubrelvy-50-mg",
    }
    return row


def _make_guide_row():
    row = MagicMock()
    row._mapping = {
        "id": "guide-1",
        "spl_set_id": "fd9f9458-fd96-4688-be3f-f77b3d1af6ab",
        "rxcui": "12345",
        "ndc": "00023649707",
        "brand_name": "Ubrelvy",
        "generic_name": "ubrogepant",
        "source_url": None,
        "fetched_at": None,
        "professional_html": "<p>professional</p>",
        "medguide_html": None,
        "dosage_administration": "<p>dosage</p>",
        "adverse_reactions": None,
        "side_effects": None,
        "updated_at": None,
    }
    return row


def test_refetch_requires_superuser(client):
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
            "/api/admin/guide/pill-1/refetch",
            json={"target": "all"},
            headers={"Authorization": "Bearer "  + "faketoken"},
        )

    assert resp.status_code == 403


def test_refetch_triggers_build_guide_and_returns_status(client):
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    pill_row = _make_pill_row()
    guide_row = _make_guide_row()

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "from profiles" in sql_str:
            result.fetchone.return_value = ("superuser",)
        elif "from pillfinder" in sql_str:
            result.fetchone.return_value = pill_row
        elif "from public.medication_guide" in sql_str:
            result.fetchone.return_value = guide_row
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = side_effect
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_SUPERUSER["id"]}), patch(
        "routes.admin.guide.build_guide", new=AsyncMock(return_value=None)
    ) as build_mock, patch(
        "routes.admin.guide.log_audit", return_value=None
    ):
        resp = client.post(
            "/api/admin/guide/pill-1/refetch",
            json={"target": "all"},
            headers={"Authorization": "Bearer "  + "faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["pill_id"] == "pill-1"
    assert data["has_professional"] is True
    assert data["has_medguide"] is False
    build_mock.assert_awaited_once()
    call_kwargs = build_mock.call_args.kwargs
    assert call_kwargs["spl_set_id"] == "fd9f9458-fd96-4688-be3f-f77b3d1af6ab"
    assert call_kwargs["force_refresh"] is True


def test_content_update_persists_and_returns_updated_field(client):
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    pill_row = _make_pill_row()
    guide_row = _make_guide_row()

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "from profiles" in sql_str:
            result.fetchone.return_value = ("superuser",)
        elif "from pillfinder" in sql_str:
            result.fetchone.return_value = pill_row
        elif "information_schema.columns" in sql_str:
            result.scalar.return_value = 0
        elif "from public.medication_guide" in sql_str:
            result.fetchone.return_value = guide_row
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
            result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = side_effect
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_SUPERUSER["id"]}), patch(
        "routes.admin.guide.log_audit", return_value=None
    ):
        resp = client.put(
            "/api/admin/guide/pill-1/content",
            json={"field": "medguide_html", "content": "<p>manual content</p>"},
            headers={"Authorization": "Bearer "  + "faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["pill_id"] == "pill-1"
    assert data["updated_field"] == "medguide_html"


def test_content_update_requires_superuser(client):
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_EDITOR["id"]}):
        resp = client.put(
            "/api/admin/guide/pill-1/content",
            json={"field": "medguide_html", "content": "<p>manual</p>"},
            headers={"Authorization": "Bearer "  + "faketoken"},
        )

    assert resp.status_code == 403


def test_clear_cache_deletes_guide_row_and_logs_audit(client):
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    pill_row = _make_pill_row()
    guide_row = _make_guide_row()

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "from profiles" in sql_str:
            result.fetchone.return_value = ("superuser",)
        elif "from pillfinder" in sql_str:
            result.fetchone.return_value = pill_row
        elif "from public.medication_guide" in sql_str:
            result.fetchone.return_value = guide_row
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = side_effect
    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module

    db_module.db_engine = mock_engine

    audit_calls = []

    def capture_audit(conn, **kwargs):
        audit_calls.append(kwargs)

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_SUPERUSER["id"]}), patch(
        "routes.admin.guide.log_audit", side_effect=capture_audit
    ):
        resp = client.post(
            "/api/admin/guide/pill-1/clear-cache",
            headers={"Authorization": "Bearer "  + "faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["deleted"] is True
    assert data["guide_id"] == "guide-1"
    assert len(audit_calls) == 1
    assert audit_calls[0]["action"] == "clear_medguide_cache"


def test_clear_cache_requires_superuser(client):
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
            "/api/admin/guide/pill-1/clear-cache",
            headers={"Authorization": "Bearer "  + "faketoken"},
        )

    assert resp.status_code == 403
