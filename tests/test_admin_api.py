"""
Tests for the admin dashboard API endpoints.

These tests use a mocked database and a mocked Supabase JWT verification
so they can run without a real DATABASE_URL or Supabase project.
"""

import os
import pytest
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAKE_USER_PAYLOAD = {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@test.com"}
FAKE_ADMIN_ROW = ("00000000-0000-0000-0000-000000000001", "admin@test.com", "superadmin", "Admin", True)
FAKE_EDITOR_ROW = ("00000000-0000-0000-0000-000000000002", "editor@test.com", "editor", "Editor", True)
FAKE_READONLY_ROW = ("00000000-0000-0000-0000-000000000003", "readonly@test.com", "readonly", "RO", True)


def _make_mock_engine(admin_row=FAKE_ADMIN_ROW):
    """Return a mock SQLAlchemy engine that returns the given admin row for auth lookups."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_result = MagicMock()
    mock_result.fetchone.return_value = admin_row
    mock_result.fetchall.return_value = []
    mock_result.scalar.return_value = 0
    mock_conn.execute.return_value = mock_result

    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine, mock_conn


@pytest.fixture(scope="module")
def client():
    """Test client with DB and JWT verification mocked."""
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine, _ = _make_mock_engine()
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


# ---------------------------------------------------------------------------
# Auth gating — 401 without token
# ---------------------------------------------------------------------------

ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/stats"),
    ("GET", "/api/admin/pills"),
    ("GET", "/api/admin/audit"),
    ("GET", "/api/admin/users"),
    ("GET", "/api/admin/me"),
    ("GET", "/api/admin/drafts"),
]


@pytest.mark.parametrize("method,path", ADMIN_ENDPOINTS)
def test_admin_endpoint_requires_auth(client, method, path):
    """All admin endpoints should return 401 when no token is provided."""
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        resp = getattr(client, method.lower())(path)
    assert resp.status_code == 401, f"{method} {path} should require auth"


# ---------------------------------------------------------------------------
# Auth gating — 403 when user is not in admin_users table
# ---------------------------------------------------------------------------

def test_admin_stats_returns_403_for_non_admin(client):
    """GET /api/admin/stats returns 403 when JWT is valid but user not in admin_users."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=None)

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get("/api/admin/stats", headers={"Authorization": "Bearer faketoken"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Role checks — readonly cannot delete
# ---------------------------------------------------------------------------

def test_readonly_cannot_delete_pill(client):
    """Readonly users should receive 403 when attempting to soft-delete a pill."""
    mock_engine, _ = _make_mock_engine(admin_row=FAKE_READONLY_ROW)

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_READONLY_ROW[0]}):
        resp = client.delete(
            "/api/admin/pills/some-pill-id",
            headers={"Authorization": "Bearer faketoken"},
        )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Role checks — editor cannot modify critical fields
# ---------------------------------------------------------------------------

def test_editor_cannot_update_critical_fields(client):
    """Editors should receive 403 when trying to update critical clinical fields directly."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_EDITOR_ROW)
    # Simulate existing pill with updated_at
    from datetime import datetime, timezone
    existing_row = MagicMock()
    existing_row.__getitem__ = lambda self, idx: datetime(2024, 1, 1, tzinfo=timezone.utc) if idx == 0 else None
    mock_conn.execute.return_value.fetchone.return_value = existing_row

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_EDITOR_ROW[0]}):
        resp = client.put(
            "/api/admin/pills/some-pill-id",
            json={"spl_strength": "500mg", "spl_ingredients": "Ibuprofen"},
            headers={"Authorization": "Bearer faketoken"},
        )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Superadmin-only endpoints — 403 for non-superadmin
# ---------------------------------------------------------------------------

def test_list_users_requires_superadmin(client):
    """GET /api/admin/users should return 403 for non-superadmin roles."""
    mock_engine, _ = _make_mock_engine(admin_row=FAKE_EDITOR_ROW)

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_EDITOR_ROW[0]}):
        resp = client.get("/api/admin/users", headers={"Authorization": "Bearer faketoken"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Soft delete sets deleted_at
# ---------------------------------------------------------------------------

def test_soft_delete_calls_correct_sql(client):
    """DELETE /api/admin/pills/{id} should execute an UPDATE with deleted_at."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            # First call: admin_users auth lookup
            result.fetchone.return_value = FAKE_ADMIN_ROW
        else:
            # Subsequent calls: the DELETE UPDATE RETURNING id
            result.fetchone.return_value = ("some-pill-id",)
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.delete(
            "/api/admin/pills/some-pill-id",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    # Confirm that execute was called with a query containing 'deleted_at'
    calls = mock_conn.execute.call_args_list
    sql_texts = [str(call.args[0]) for call in calls if call.args]
    assert any("deleted_at" in sql for sql in sql_texts), (
        "DELETE endpoint must set deleted_at on the row"
    )


# ---------------------------------------------------------------------------
# Optimistic locking — 409 on timestamp mismatch
# ---------------------------------------------------------------------------

def test_update_pill_returns_409_on_stale_timestamp(client):
    """PUT /api/admin/pills/{id} returns 409 when client sends a stale updated_at."""
    from datetime import datetime, timezone
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    auth_result = MagicMock()
    auth_result.fetchone.return_value = FAKE_ADMIN_ROW

    db_ts = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    pill_row = MagicMock()
    pill_row.__getitem__ = MagicMock(side_effect=lambda idx: db_ts if idx == 0 else None)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        if call_count[0] == 0:
            # First call is admin_users lookup
            result.fetchone.return_value = FAKE_ADMIN_ROW
        else:
            # Second call is updated_at check on pillfinder
            result.fetchone.return_value = pill_row
        call_count[0] += 1
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    stale_ts = "2024-01-01T00:00:00+00:00"
    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.put(
            "/api/admin/pills/some-pill-id",
            json={"medicine_name": "Aspirin", "updated_at": stale_ts},
            headers={"Authorization": "Bearer faketoken"},
        )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Audit log insertion
# ---------------------------------------------------------------------------

def test_log_audit_does_not_raise_on_db_error():
    """log_audit should silently log errors rather than raising exceptions."""
    from routes.admin.auth import log_audit

    broken_conn = MagicMock()
    broken_conn.execute.side_effect = Exception("DB is down")

    # Should not raise
    log_audit(broken_conn, "actor-id", "actor@test.com", "test_action", "pill", "123")


def test_get_me_returns_correct_fields(client):
    """GET /api/admin/me should return id, email, role, full_name."""
    mock_engine, _ = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get("/api/admin/me", headers={"Authorization": "Bearer faketoken"})

    assert resp.status_code == 200
    data = resp.json()
    assert "email" in data
    assert "role" in data
    assert "id" in data


# ---------------------------------------------------------------------------
# Sort order — rows without a medicine_name should be sorted last
# ---------------------------------------------------------------------------

def test_list_pills_sort_order_puts_unnamed_last(client):
    """GET /api/admin/pills should execute CASE-based ORDER BY so named pills come first."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            # Auth lookup
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # COUNT(*) query
            result.scalar.return_value = 0
        else:
            # SELECT pills
            result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get("/api/admin/pills", headers={"Authorization": "Bearer faketoken"})

    assert resp.status_code == 200, resp.text
    assert mock_conn.execute.called, "Expected list_pills to execute a SQL query"

    # Inspect all SQL calls and find the SELECT with ORDER BY
    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    select_sqls = [s for s in executed_sqls if "ORDER BY" in s]
    assert select_sqls, "Expected a SELECT with ORDER BY to be executed"
    assert any(
        "CASE WHEN medicine_name IS NULL OR TRIM(medicine_name) = '' THEN 1 ELSE 0 END" in s
        for s in select_sqls
    ), "list_pills must order by CASE expression to put unnamed pills last"
    assert all(
        "ORDER BY medicine_name NULLS LAST" not in s for s in select_sqls
    ), "Old naive sort must be removed"


# ---------------------------------------------------------------------------
# New fields — image_alt_text and tags accepted in create/update payloads
# ---------------------------------------------------------------------------

def test_pill_create_accepts_image_alt_text_and_tags(client):
    """POST /api/admin/pills should accept image_alt_text and tags fields."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # idempotency_key check — no existing row
            result.fetchone.return_value = None
        else:
            # INSERT RETURNING id
            result.scalar.return_value = "new-pill-uuid"
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills",
            json={
                "medicine_name": "TestDrug",
                "image_alt_text": "White oval pill imprinted MP 45",
                "tags": "painkiller, analgesic",
            },
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data.get("created") is True

    # Confirm that the INSERT included the new fields
    insert_calls = [
        str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args
    ]
    assert any("image_alt_text" in sql for sql in insert_calls), (
        "image_alt_text must be included in the INSERT statement"
    )
    assert any("tags" in sql for sql in insert_calls), (
        "tags must be included in the INSERT statement"
    )


def test_pill_update_accepts_image_alt_text_and_tags(client):
    """PUT /api/admin/pills/{id} should accept image_alt_text and tags fields."""
    from datetime import datetime, timezone

    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    db_ts = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    pill_row = MagicMock()
    pill_row.__getitem__ = MagicMock(side_effect=lambda idx: db_ts if idx == 0 else None)

    # Simulate a full row for before-snapshot
    before_row = MagicMock()
    before_row._fields = ["id", "medicine_name", "image_alt_text", "tags"]
    before_row.__iter__ = MagicMock(return_value=iter(["pill-id", "OldName", None, None]))

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # updated_at check
            result.fetchone.return_value = pill_row
        elif call_count[0] == 3:
            # before-snapshot SELECT *
            result.fetchone.return_value = before_row
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.put(
            "/api/admin/pills/some-pill-id",
            json={
                "image_alt_text": "White oval pill imprinted MP 45",
                "tags": "painkiller, analgesic",
                "updated_at": "2024-06-01T12:00:00+00:00",
            },
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("updated") is True

    # Confirm that the UPDATE included the new fields
    update_calls = [
        str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args
    ]
    assert any("image_alt_text" in sql for sql in update_calls), (
        "image_alt_text must be included in the UPDATE statement"
    )
    assert any("tags" in sql for sql in update_calls), (
        "tags must be included in the UPDATE statement"
    )



# ---------------------------------------------------------------------------
# Phase 2 — Bulk tag
# ---------------------------------------------------------------------------

def test_bulk_tag_adds_without_duplication(client):
    """POST /api/admin/pills/bulk/tag (add mode) must not duplicate existing tags."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # SELECT id, tags — existing tag already present
            mock_row = MagicMock()
            mock_row.__getitem__ = lambda self, idx: (
                "pill-uuid-1" if idx == 0 else "painkiller"
            )
            result.fetchall.return_value = [mock_row]
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk/tag",
            json={"ids": ["pill-uuid-1"], "tag": "painkiller", "mode": "add"},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("updated") == 1

    # The UPDATE should NOT set tags to "painkiller, painkiller"
    update_calls = [
        str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args
        and "UPDATE" in str(call.args[0])
    ]
    # If there's an update call for tags, it must not contain duplicated tag
    for sql_str in update_calls:
        if "tags" in sql_str:
            params_used = [call.args[1] for call in mock_conn.execute.call_args_list
                           if call.args and len(call.args) > 1]
            for p in params_used:
                tags_val = p.get("tags", "") if isinstance(p, dict) else ""
                tag_list = [t.strip() for t in tags_val.split(",") if t.strip()]
                assert tag_list.count("painkiller") <= 1, (
                    "bulk_tag must not duplicate tags"
                )


# ---------------------------------------------------------------------------
# Phase 2 — Bulk delete
# ---------------------------------------------------------------------------

def test_bulk_delete_soft_deletes_all(client):
    """POST /api/admin/pills/bulk/delete must set deleted_at on all rows."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    ids = ["pill-uuid-1", "pill-uuid-2", "pill-uuid-3"]
    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        else:
            result.fetchone.return_value = None
            result.rowcount = len(ids)  # simulate DB returning affected row count
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk/delete",
            json={"ids": ids},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("deleted") == len(ids)

    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    assert any("deleted_at" in sql for sql in executed_sqls), (
        "bulk_delete must set deleted_at in its SQL"
    )


# ---------------------------------------------------------------------------
# Phase 2 — Duplicate detection
# ---------------------------------------------------------------------------

def test_duplicate_detection_requires_all_7_fields(client):
    """GET /api/admin/duplicates returns 200 and has the correct response structure."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # COUNT for total_groups
            result.scalar.return_value = 0
        else:
            result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get("/api/admin/duplicates", headers={"Authorization": "Bearer faketoken"})

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "total_groups" in data
    assert "groups" in data
    assert "page" in data
    assert "per_page" in data

    # Verify the SQL uses all 7 normalised fields
    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    combined_sql = " ".join(executed_sqls)
    for field in ["medicine_name", "spl_strength", "splimprint", "splcolor_text",
                  "splshape_text", "author", "ndc11"]:
        assert field in combined_sql, f"Duplicate detection SQL must include field '{field}'"


# ---------------------------------------------------------------------------
# Phase 2 — Merge rejects mismatched fields
# ---------------------------------------------------------------------------

def test_merge_rejects_when_fields_differ(client):
    """POST /api/admin/duplicates/merge returns 400 when normalised key fields differ."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    keep_row = MagicMock()
    keep_row._fields = ["id", "medicine_name", "spl_strength", "splimprint",
                        "splcolor_text", "splshape_text", "author", "ndc11"]
    keep_row.__iter__ = MagicMock(return_value=iter(
        ["keep-id", "Aspirin", "500mg", "A1", "white", "round", "Bayer", "12345"]
    ))

    discard_row = MagicMock()
    discard_row._fields = ["id", "medicine_name", "spl_strength", "splimprint",
                           "splcolor_text", "splshape_text", "author", "ndc11"]
    discard_row.__iter__ = MagicMock(return_value=iter(
        ["discard-id", "Ibuprofen", "200mg", "B2", "blue", "oval", "Generic", "99999"]
    ))

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            result.fetchone.return_value = keep_row
        else:
            result.fetchone.return_value = discard_row
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/duplicates/merge",
            json={"keep_id": "keep-id", "discard_ids": ["discard-id"]},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Phase 2 — Merge gap-fill
# ---------------------------------------------------------------------------

def test_merge_gap_fills_correctly(client):
    """POST /api/admin/duplicates/merge copies gap-fill fields from discard to keep."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    # Keep pill: same key fields, but missing image_filename
    keep_row = MagicMock()
    keep_row._fields = ["id", "medicine_name", "spl_strength", "splimprint",
                        "splcolor_text", "splshape_text", "author", "ndc11",
                        "image_filename", "has_image"]
    keep_row.__iter__ = MagicMock(return_value=iter(
        ["keep-id", "Aspirin", "500mg", "A1", "white", "round", "Bayer", "12345",
         None, None]
    ))

    # Discard pill: same key fields, has image_filename
    discard_row = MagicMock()
    discard_row._fields = ["id", "medicine_name", "spl_strength", "splimprint",
                           "splcolor_text", "splshape_text", "author", "ndc11",
                           "image_filename", "has_image"]
    discard_row.__iter__ = MagicMock(return_value=iter(
        ["discard-id", "Aspirin", "500mg", "A1", "white", "round", "Bayer", "12345",
         "aspirin_500.jpg", "TRUE"]
    ))

    final_row = MagicMock()
    final_row._fields = ["id", "medicine_name"]
    final_row.__iter__ = MagicMock(return_value=iter(["keep-id", "Aspirin"]))

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql)
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif "pillfinder WHERE id" in sql_str and call_count[0] == 2:
            result.fetchone.return_value = keep_row
        elif "pillfinder WHERE id" in sql_str and call_count[0] == 3:
            result.fetchone.return_value = discard_row
        elif "pillfinder WHERE id" in sql_str:
            result.fetchone.return_value = final_row
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
         patch("routes.admin.duplicates.log_audit", return_value=None):
        resp = client.post(
            "/api/admin/duplicates/merge",
            json={"keep_id": "keep-id", "discard_ids": ["discard-id"]},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    # Verify a soft-delete UPDATE was executed for discard pills
    assert any("deleted_at" in sql and "UPDATE" in sql for sql in executed_sqls), (
        "merge must soft-delete discard pills"
    )


# ---------------------------------------------------------------------------
# Phase 2 — CSV export streaming response
# ---------------------------------------------------------------------------

def test_csv_export_returns_streaming_response(client):
    """GET /api/admin/pills/export.csv returns 200 with correct headers."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.execution_options.return_value = mock_conn

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        else:
            result.__iter__ = MagicMock(return_value=iter([]))
            result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills/export.csv",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    assert "text/csv" in resp.headers.get("content-type", "")
    content_disposition = resp.headers.get("content-disposition", "")
    assert "attachment" in content_disposition
    assert "pills-export-" in content_disposition
    assert ".csv" in content_disposition


# ---------------------------------------------------------------------------
# Merge end-to-end: kept pill persists, discards are soft-deleted
# ---------------------------------------------------------------------------

def test_merge_end_to_end_keeps_pill_and_soft_deletes_discards(client):
    """POST /api/admin/duplicates/merge keeps the selected pill and soft-deletes discards."""
    KEEP_ID = "aaaaaaaa-0000-0000-0000-000000000001"
    DISCARD_ID = "bbbbbbbb-0000-0000-0000-000000000002"

    # Both pills share identical 7-field keys
    pill_fields = ["id", "medicine_name", "spl_strength", "splimprint",
                   "splcolor_text", "splshape_text", "author", "ndc11",
                   "brand_names", "splsize", "slug", "image_filename",
                   "has_image", "deleted_at"]

    keep_row = MagicMock()
    keep_row._fields = pill_fields
    keep_row.__iter__ = MagicMock(return_value=iter(
        [KEEP_ID, "Fluoxetine", "20mg", "PLIVA;648", "green", "capsule",
         "Bryant Ranch", "", None, None, "fluoxetine-20mg", "flu.jpg", "TRUE", None]
    ))

    discard_row = MagicMock()
    discard_row._fields = pill_fields
    discard_row.__iter__ = MagicMock(return_value=iter(
        [DISCARD_ID, "Fluoxetine", "20mg", "PLIVA;648", "green", "capsule",
         "Bryant Ranch", "", None, None, "fluoxetine-20mg-2", "flu2.jpg", "TRUE", None]
    ))

    final_row = MagicMock()
    final_row._fields = ["id", "medicine_name", "deleted_at"]
    final_row.__iter__ = MagicMock(return_value=iter([KEEP_ID, "Fluoxetine", None]))

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql)
        call_count[0] += 1
        if call_count[0] == 1:
            # Auth lookup
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # Fetch keep pill
            result.fetchone.return_value = keep_row
        elif call_count[0] == 3:
            # Fetch discard pill
            result.fetchone.return_value = discard_row
        elif "deleted_at = now()" in sql_str or "deleted_by" in sql_str:
            # Soft-delete UPDATE for discards
            result.fetchone.return_value = None
            result.rowcount = 1
        elif call_count[0] >= 4 and "pillfinder WHERE id" in sql_str:
            # Final SELECT of kept pill
            result.fetchone.return_value = final_row
        else:
            result.fetchone.return_value = None
        return result

    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), \
         patch("routes.admin.duplicates.log_audit", return_value=None):
        resp = client.post(
            "/api/admin/duplicates/merge",
            json={"keep_id": KEEP_ID, "discard_ids": [DISCARD_ID]},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text

    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]

    # Discard must be soft-deleted (deleted_at SET via UPDATE)
    assert any(
        "deleted_at" in sql and "UPDATE" in sql for sql in executed_sqls
    ), "merge must soft-delete discards via UPDATE … SET deleted_at"

    # The discard ID must appear in the soft-delete call params
    all_params = [
        call.args[1] for call in mock_conn.execute.call_args_list
        if len(call.args) > 1 and isinstance(call.args[1], dict)
    ]
    discard_referenced = any(
        DISCARD_ID in str(p.get("ids", "")) for p in all_params
    )
    assert discard_referenced, "discard pill ID must be passed to the soft-delete UPDATE"

    # Response must refer to the kept pill (not the discard)
    data = resp.json()
    assert data.get("id") == KEEP_ID, "response id must be the keep_id"
    assert data.get("medicine_name") == "Fluoxetine", "response must include kept pill's medicine_name"
