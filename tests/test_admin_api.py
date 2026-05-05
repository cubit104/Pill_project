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

# Profiles-table rows: (user_role,)
FAKE_ADMIN_PROFILE = ("superuser",)
FAKE_EDITOR_PROFILE = ("editor",)
FAKE_REVIEWER_PROFILE = ("reviewer",)


def _make_mock_engine(admin_row=FAKE_ADMIN_ROW, profile_row=None):
    """Return a mock SQLAlchemy engine that returns the given rows for auth lookups.

    ``profile_row`` is returned for ``profiles`` table queries (new auth).
    ``admin_row``   is returned for ``admin_users`` table queries (legacy fallback).
    When ``profile_row`` is None, the engine auto-selects based on ``admin_row``'s role.
    """
    if profile_row is None and admin_row is not None:
        # Derive profile row from admin_row role (index 2)
        raw_role = admin_row[2] if len(admin_row) > 2 else "reviewer"
        if raw_role == "superadmin":
            raw_role = "superuser"
        profile_row = (raw_role,) if raw_role in ("superuser", "editor", "reviewer") else None

    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    def _smart_execute(sql, *args, **kwargs):
        """Return profile or admin_users row based on the SQL text."""
        result = MagicMock()
        sql_str = str(sql).lower()
        if "profiles" in sql_str and "user_role" in sql_str:
            result.fetchone.return_value = profile_row
        else:
            result.fetchone.return_value = admin_row
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = _smart_execute
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine, mock_conn


def _with_profiles_auth(inner_side_effect, profile_row=None):
    """Wrap a legacy call_count-style side_effect to handle profiles auth first.

    Old tests expected call_count==1 to be the admin_users auth lookup.  Now
    the first DB call is the profiles table lookup (intercepted here), but we
    still consume one slot in the inner side_effect so that existing tests keep
    their call_count==1 → auth, call_count==2 → business-data pattern intact.
    """
    if profile_row is None:
        profile_row = FAKE_ADMIN_PROFILE

    intercepted = [False]

    def wrapper(sql, *args, **kwargs):
        sql_str = str(sql).lower()
        if "profiles" in sql_str and "user_role" in sql_str and not intercepted[0]:
            intercepted[0] = True
            # Consume one call_count slot so remaining call indices stay the same
            inner_side_effect(sql, *args, **kwargs)
            result = MagicMock()
            result.fetchone.return_value = profile_row
            result.fetchall.return_value = []
            result.scalar.return_value = 0
            return result
        return inner_side_effect(sql, *args, **kwargs)

    return wrapper


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

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_EDITOR_ROW[0], "email": FAKE_EDITOR_ROW[1]}):
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

    # Track calls to verify deleted_at appears in the SQL
    executed_sqls: list = []

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        executed_sqls.append(sql_str)
        # Profiles auth lookup
        if "profiles" in sql_str and "user_role" in sql_str:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        # DELETE soft-delete UPDATE RETURNING
        elif "deleted_at" in sql_str:
            result.fetchone.return_value = ("some-pill-id",)
        # Audit log insert and anything else
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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
    assert any("deleted_at" in sql for sql in executed_sqls), (
        "DELETE endpoint must set deleted_at on the row"
    )


# ---------------------------------------------------------------------------
# Optimistic locking — 409 on timestamp mismatch
# ---------------------------------------------------------------------------

def test_update_pill_returns_409_on_stale_timestamp(client):
    """PUT /api/admin/pills/{id} returns 409 when client sends a stale updated_at."""
    from datetime import datetime, timezone
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    db_ts = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    pill_row = MagicMock()
    pill_row.__getitem__ = MagicMock(side_effect=lambda idx: db_ts if idx == 0 else None)

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql).lower()
        if "profiles" in sql_str and "user_role" in sql_str:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "updated_at" in sql_str or "pillfinder" in sql_str:
            result.fetchone.return_value = pill_row
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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
    assert data["role"] in ("superuser", "superadmin", "editor", "reviewer")


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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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
    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

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


# ---------------------------------------------------------------------------
# Image upload — storage path round-trip (Bug A fix)
# ---------------------------------------------------------------------------

PILL_UUID = "8bdcca05-07f5-49d3-96ec-25321e4929a3"


def test_upload_image_stores_full_storage_path(client):
    """POST /api/admin/pills/:id/images must store pill_id/filename in DB, not bare filename."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]
    stored_fn = []

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql)
        call_count[0] += 1
        if call_count[0] == 1:
            # Auth lookup
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif "SELECT image_filename" in sql_str:
            # Existing image_filename fetch
            result.fetchone.return_value = (None,)
        elif "UPDATE pillfinder" in sql_str:
            # Capture the stored filename
            if args and isinstance(args[0], dict):
                stored_fn.append(args[0].get("fn", ""))
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    import database as db_module
    db_module.db_engine = mock_engine

    import io
    fake_image = io.BytesIO(b"fake-image-content")

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_ADMIN_ROW[0]}), \
         patch("routes.admin.images._supabase_upload", return_value=True):
        resp = client.post(
            f"/api/admin/pills/{PILL_UUID}/images",
            files={"file": ("test.jpg", fake_image, "image/jpeg")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Response filename must include the pill_id prefix
    assert "/" in data["filename"], (
        f"upload response filename must be pill_id/bare_filename, got {data['filename']!r}"
    )
    assert data["filename"].startswith(f"{PILL_UUID}/"), (
        f"response filename must start with pill_id, got {data['filename']!r}"
    )

    # URL must include the full storage path
    assert PILL_UUID in data["url"], (
        f"response URL must include pill_id, got {data['url']!r}"
    )

    # DB must have received the full storage path
    assert any("/" in fn for fn in stored_fn), (
        "DB UPDATE must store pill_id/bare_filename, not just bare_filename"
    )


def test_upload_image_appends_full_path_to_existing(client):
    """Uploading when image_filename already exists appends pill_id/filename."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]
    stored_fn = []
    existing_legacy = "NDC_12345678.jpg"  # legacy image at bucket root

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql)
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif "SELECT image_filename" in sql_str:
            result.fetchone.return_value = (existing_legacy,)
        elif "UPDATE pillfinder" in sql_str:
            if args and isinstance(args[0], dict):
                stored_fn.append(args[0].get("fn", ""))
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    import database as db_module
    db_module.db_engine = mock_engine

    import io
    fake_image = io.BytesIO(b"fake-image-content")

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_ADMIN_ROW[0]}), \
         patch("routes.admin.images._supabase_upload", return_value=True):
        resp = client.post(
            f"/api/admin/pills/{PILL_UUID}/images",
            files={"file": ("photo.png", fake_image, "image/png")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text

    # stored value must keep legacy AND add new full path
    assert stored_fn, "DB UPDATE must have been called"
    combined = stored_fn[-1]
    parts = [p.strip() for p in combined.split(",")]
    assert existing_legacy in parts, "legacy filename must be preserved"
    new_parts = [p for p in parts if "/" in p]
    assert new_parts, "new upload must appear as pill_id/filename in the DB"
    assert new_parts[0].startswith(f"{PILL_UUID}/"), (
        f"new part must start with {PILL_UUID}/, got {new_parts[0]!r}"
    )


def test_delete_image_uses_filename_as_storage_key(client):
    """DELETE /api/admin/pills/:id/images/:fn uses filename (full path) as Supabase sourceKey."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    # Simulate DB storing the full path
    stored_path = f"{PILL_UUID}/8bdcca05-1776920313.jpg"
    call_count = [0]
    updated_fn = []

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        sql_str = str(sql)
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif "SELECT image_filename" in sql_str:
            result.fetchone.return_value = (stored_path,)
        elif "UPDATE pillfinder" in sql_str:
            if args and isinstance(args[0], dict):
                updated_fn.append(args[0].get("fn", ""))
            result.fetchone.return_value = None
        else:
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    import database as db_module
    db_module.db_engine = mock_engine

    captured_move_requests = []

    def fake_httpx_post(url, **kwargs):
        captured_move_requests.append(kwargs.get("json", {}))
        resp = MagicMock()
        resp.status_code = 200
        return resp

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_ADMIN_ROW[0]}), \
         patch("httpx.post", side_effect=fake_httpx_post):
        resp = client.delete(
            f"/api/admin/pills/{PILL_UUID}/images/{PILL_UUID}%2F8bdcca05-1776920313.jpg",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted"] is True

    # The filename must have been cleared from the DB
    assert updated_fn, "DB UPDATE should have been called"
    assert updated_fn[-1] == "", "DB should now have empty image_filename"

    # Supabase move must use full path as sourceKey (not pill_id/pill_id/bare)
    if captured_move_requests:
        move_req = captured_move_requests[0]
        assert move_req.get("sourceKey") == stored_path, (
            f"sourceKey must be the full stored path {stored_path!r}, "
            f"got {move_req.get('sourceKey')!r}"
        )
        assert move_req.get("destinationKey") == f"deleted/{stored_path}", (
            f"destinationKey must be deleted/{stored_path}"
        )


# ---------------------------------------------------------------------------
# resolved_image_urls — GET /api/admin/pills/{id}
# ---------------------------------------------------------------------------

def test_get_pill_resolved_image_urls_no_double_prefix(client):
    """GET /api/admin/pills/{id} must not prepend pill_id twice for new-format filenames.

    New-format filenames are stored as "{pill_id}/{bare_filename}" in the DB.
    Legacy filenames are stored as bare "{filename}" (at bucket root).

    resolved_image_urls must be IMAGE_BASE/{stored_filename} in both cases —
    never IMAGE_BASE/{pill_id}/{stored_filename} for new-format entries.
    """
    from utils import IMAGE_BASE

    pill_id = PILL_UUID
    legacy_fn = "NDC_legacy.jpg"
    new_fn = f"{pill_id}/8bdcca05-1776974595.jpg"
    combined_fn = f"{legacy_fn},{new_fn}"

    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            # Auth lookup
            result.fetchone.return_value = FAKE_ADMIN_ROW
        elif call_count[0] == 2:
            # SELECT * FROM pillfinder — return a minimal fake row
            fake_row = MagicMock()
            fake_row._fields = ("id", "image_filename", "has_image")
            fake_row.__iter__ = lambda s: iter((pill_id, combined_fn, "TRUE"))
            result.fetchone.return_value = fake_row
        else:
            # Drafts query — return empty list
            result.fetchall.return_value = []
            result.fetchone.return_value = None
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_ADMIN_ROW[0]}):
        resp = client.get(
            f"/api/admin/pills/{pill_id}",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    urls = data.get("resolved_image_urls", [])
    assert len(urls) == 2, f"expected 2 resolved URLs, got {urls}"

    # Legacy filename — should be IMAGE_BASE/legacy_fn
    assert urls[0] == f"{IMAGE_BASE}/{legacy_fn}", (
        f"legacy image URL wrong: {urls[0]!r}"
    )

    # New-format filename — should be IMAGE_BASE/{pill_id}/bare_name (NOT double-prefixed)
    assert urls[1] == f"{IMAGE_BASE}/{new_fn}", (
        f"new-format image URL wrong (double prefix?): {urls[1]!r}"
    )
    assert urls[1].count(pill_id) == 1, (
        f"pill_id must appear exactly once in the URL, got {urls[1]!r}"
    )


# ---------------------------------------------------------------------------
# has_image filter — reads image_filename not has_image column
# ---------------------------------------------------------------------------

def test_list_pills_has_image_true_filters_by_image_filename(client):
    """/api/admin/pills?has_image=true must filter by image_filename IS NOT NULL, not by has_image='TRUE'."""
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
            result.scalar.return_value = 0
        else:
            result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills?has_image=true",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text

    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    combined = " ".join(executed_sqls)
    assert "image_filename IS NOT NULL" in combined, (
        "has_image=true filter must use image_filename IS NOT NULL, not has_image='TRUE'"
    )
    assert "has_image = 'TRUE'" not in combined, (
        "has_image=true filter must not use the has_image column"
    )


def test_list_pills_has_image_false_filters_by_image_filename(client):
    """/api/admin/pills?has_image=false must filter by image_filename IS NULL/empty, not by has_image."""
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
            result.scalar.return_value = 0
        else:
            result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills?has_image=false",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text

    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    combined = " ".join(executed_sqls)
    assert "image_filename IS NULL" in combined, (
        "has_image=false filter must use image_filename IS NULL, not has_image column"
    )
    assert "has_image IS NULL OR has_image != 'TRUE'" not in combined, (
        "has_image=false filter must not reference the has_image column"
    )


def test_stats_no_image_count_uses_image_filename(client):
    """/api/admin/pills/stats no_image count must be derived from image_filename, not has_image."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_ROW
        else:
            # Stats row: (total, no_image, no_name, no_imprint, no_ndc)
            result.fetchone.return_value = (100, 5, 2, 10, 3)
        return result

    mock_conn.execute.side_effect = _with_profiles_auth(side_effect)

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    # Clear in-memory stats cache so the endpoint executes a real DB query
    import routes.admin.pills as pills_module
    pills_module._stats_cache["data"] = None
    pills_module._stats_cache["expires"] = 0.0

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills/stats",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "no_image" in data

    executed_sqls = [str(call.args[0]) for call in mock_conn.execute.call_args_list if call.args]
    combined = " ".join(executed_sqls)
    assert "image_filename IS NULL OR TRIM(image_filename) = ''" in combined, (
        "stats no_image count must filter on image_filename, not has_image column"
    )
    assert "has_image IS NULL OR has_image != 'TRUE'" not in combined, (
        "stats must not use the has_image column for no_image count"
    )


# ---------------------------------------------------------------------------
# GET /api/admin/pills/{pill_id}/indication
# ---------------------------------------------------------------------------

def test_get_pill_indication_returns_nulls_when_no_rxcui(client):
    """GET indication returns all-null payload when pill has no rxcui."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            # profiles auth lookup — return profile row so role is resolved
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        else:
            # pillfinder row with rxcui = None — use a real tuple so [0] returns None
            result.fetchone.return_value = (None,)
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills/some-pill-id/indication",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["plain_text"] is None
    assert data["rxcui"] is None
    assert data["source"] is None


def test_get_pill_indication_returns_data_when_found(client):
    """GET indication returns plain_text and source when drug_indications row exists."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "pillfinder" in sql_str:
            # pill row with rxcui — use a real tuple so [0] returns the rxcui string
            result.fetchone.return_value = ("123456",)
        else:
            # drug_indications row: plain_text, source, source_url, rxcui
            result.fetchone.return_value = ("Used for pain.", "medlineplus", None, "123456")
        result.fetchall.return_value = []
        result.scalar.return_value = 0
        return result

    mock_conn.execute.side_effect = side_effect

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills/some-pill-id/indication",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["plain_text"] == "Used for pain."
    assert data["source"] == "medlineplus"
    assert data["rxcui"] == "123456"


def test_get_pill_indication_returns_404_for_missing_pill(client):
    """GET indication returns 404 when pill is not found."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
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

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/pills/nonexistent/indication",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PUT /api/admin/pills/{pill_id}/indication
# ---------------------------------------------------------------------------

def test_put_pill_indication_saves_with_manual_source(client):
    """PUT indication upserts the row and returns saved=True, source='manual'."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    executed_sqls: list = []
    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        executed_sqls.append(sql_str)
        if call_count[0] == 1:
            # profiles auth lookup — return superuser profile
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "pillfinder" in sql_str:
            # real tuple: rxcui at index 0, medicine_name at index 1
            result.fetchone.return_value = ("123456", "Aspirin")
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

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.put(
            "/api/admin/pills/some-pill-id/indication",
            json={"plain_text": "Aspirin is used for pain."},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["saved"] is True
    assert data["source"] == "manual"
    # Confirm the upsert SQL included 'manual' source
    assert any("manual" in sql for sql in executed_sqls), "Upsert must set source='manual'"
    assert any("drug_indications" in sql for sql in executed_sqls), "Must write to drug_indications"


def test_put_pill_indication_returns_400_when_no_rxcui(client):
    """PUT indication returns 400 when the pill has no rxcui."""
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "pillfinder" in sql_str:
            # real tuple: rxcui is None at index 0, medicine_name at index 1
            result.fetchone.return_value = (None, "Aspirin")
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

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.put(
            "/api/admin/pills/some-pill-id/indication",
            json={"plain_text": "some text"},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 400
    assert "RxCUI" in resp.json()["detail"]


def test_put_pill_indication_requires_editor_or_higher(client):
    """PUT indication returns 403 for readonly users."""
    mock_engine, _ = _make_mock_engine(
        admin_row=FAKE_READONLY_ROW,
        profile_row=None,  # readonly has no profile row → falls back to admin_users
    )

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value={"id": FAKE_READONLY_ROW[0]}):
        resp = client.put(
            "/api/admin/pills/some-pill-id/indication",
            json={"plain_text": "some text"},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 403



# ---------------------------------------------------------------------------
# Bulk create — POST /api/admin/pills/bulk
# ---------------------------------------------------------------------------

def test_bulk_create_draft_inserts_all_rows(client):
    """POST /api/admin/pills/bulk with publish=false inserts all rows as drafts."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup — return ("superuser",) so role resolves correctly
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "idempotency_key" in sql_str and "select" in sql_str:
            result.fetchone.return_value = None  # no existing row
        elif "insert into pillfinder" in sql_str:
            result.scalar.return_value = f"bulk-id-{call_count[0]}"
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    pills = [
        {"medicine_name": "Aspirin", "slug": "aspirin"},
        {"medicine_name": "Ibuprofen", "slug": "ibuprofen"},
    ]

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk",
            json={"pills": pills, "publish": False},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 2
    assert data["succeeded"] == 2
    assert data["failed"] == 0
    assert all(r["success"] is True for r in data["results"])


def test_bulk_create_publish_skips_invalid_rows(client):
    """POST /api/admin/pills/bulk with publish=true skips rows missing required fields."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "idempotency_key" in sql_str and "select" in sql_str:
            result.fetchone.return_value = None
        elif "insert into pillfinder" in sql_str:
            result.scalar.return_value = f"new-id-{call_count[0]}"
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    # Valid row has all tier-1 required fields; invalid row is missing them
    valid_pill = {
        "medicine_name": "Aspirin",
        "author": "Bayer",
        "spl_strength": "500 mg",
        "splimprint": "BAYER",
        "splcolor_text": "White",
        "splshape_text": "Round",
        "slug": "aspirin-bayer",
        "ndc9": "12345678",
        "ndc11": "12345678901",
        "dosage_form": "Tablet",
        "route": "Oral",
        "spl_ingredients": "Aspirin 500 mg",
        "spl_inactive_ing": "Starch",
        "dea_schedule_name": "N/A",
        "status_rx_otc": "OTC",
    }
    invalid_pill = {"medicine_name": "Ibuprofen"}  # missing all required fields

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk",
            json={"pills": [valid_pill, invalid_pill], "publish": True},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 2
    assert data["succeeded"] == 1
    assert data["failed"] == 1

    results_by_index = {r["index"]: r for r in data["results"]}
    assert results_by_index[0]["success"] is True   # valid row was inserted
    assert results_by_index[1]["success"] is False  # invalid row was skipped
    assert results_by_index[1].get("error"), "failed row must include an error message"


def test_bulk_create_partial_db_failure(client):
    """POST /api/admin/pills/bulk continues when one row hits a DB error."""
    from sqlalchemy.exc import SQLAlchemyError as SAError

    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]
    insert_call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
            return result
        if "idempotency_key" in sql_str and "select" in sql_str:
            result.fetchone.return_value = None
            return result
        if "insert into pillfinder" in sql_str:
            insert_call_count[0] += 1
            if insert_call_count[0] == 1:
                raise SAError("unique constraint violation")
            result.scalar.return_value = f"ok-id-{insert_call_count[0]}"
            return result
        result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    pills = [
        {"medicine_name": "Row1"},
        {"medicine_name": "Row2"},
    ]

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk",
            json={"pills": pills, "publish": False},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 2
    assert data["failed"] == 1
    assert data["succeeded"] == 1

    results_by_index = {r["index"]: r for r in data["results"]}
    assert results_by_index[0]["success"] is False
    assert results_by_index[1]["success"] is True


def test_bulk_create_idempotency_key_prevents_duplicate(client):
    """Retrying POST /api/admin/pills/bulk with an existing idempotency_key returns the existing row."""
    EXISTING_ID = "existing-pill-uuid"
    IDEM_KEY = "import-batch-row-42"

    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]
    insert_called = [False]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "idempotency_key" in sql_str and "select" in sql_str:
            # Return the existing row — simulates a retry after a previous success
            result.fetchone.return_value = (EXISTING_ID,)
        elif "insert into pillfinder" in sql_str:
            insert_called[0] = True
            result.scalar.return_value = "should-not-be-called"
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.begin.return_value = mock_conn

    import database as db_module
    db_module.db_engine = mock_engine

    pills = [{"medicine_name": "Aspirin", "idempotency_key": IDEM_KEY}]

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk",
            json={"pills": pills, "publish": False},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["succeeded"] == 1
    assert data["failed"] == 0

    result = data["results"][0]
    assert result["success"] is True
    assert result["id"] == EXISTING_ID, "idempotency must return existing row id"
    assert insert_called[0] is False, "INSERT must not be called when idempotency key matches"


def test_bulk_create_requires_auth(client):
    """POST /api/admin/pills/bulk returns 401 without a token."""
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        resp = client.post(
            "/api/admin/pills/bulk",
            json={"pills": [], "publish": False},
        )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Draft GET / PATCH endpoints  (added to cover new routes)
# ---------------------------------------------------------------------------

def test_get_draft_returns_draft_data(client):
    """GET /api/admin/drafts/{id} returns draft including draft_data."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    import datetime

    call_count = [0]
    fake_draft_data = {"medicine_name": "Aspirin", "slug": "aspirin", "has_image": False}

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "pill_drafts" in sql_str and "select" in sql_str:
            result.fetchone.return_value = (
                "draft-uuid-001",
                None,
                "draft",
                datetime.datetime(2024, 1, 1),
                datetime.datetime(2024, 1, 2),
                None,
                "Aspirin",
                "00000000-0000-0000-0000-000000000001",
                fake_draft_data,
            )
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/drafts/draft-uuid-001",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == "draft-uuid-001"
    assert data["status"] == "draft"
    assert data["draft_data"]["medicine_name"] == "Aspirin"
    assert data["draft_data"]["has_image"] is False


def test_get_draft_returns_404_for_missing(client):
    """GET /api/admin/drafts/{id} returns 404 when draft doesn't exist."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/drafts/nonexistent-id",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 404


def test_patch_draft_updates_draft_data(client):
    """PATCH /api/admin/drafts/{id} updates draft_data and returns 200."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "update pill_drafts" in sql_str and "status = 'draft'" in sql_str:
            # Successful UPDATE RETURNING id, pill_id
            result.fetchone.return_value = ("draft-uuid-001", None)
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.patch(
            "/api/admin/drafts/draft-uuid-001",
            json={"draft_data": {"medicine_name": "Updated Aspirin", "slug": "aspirin-updated"}},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == "draft-uuid-001"
    assert data["updated"] is True


def test_patch_draft_returns_404_for_missing(client):
    """PATCH /api/admin/drafts/{id} returns 404 when draft doesn't exist."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        else:
            # UPDATE returns nothing; status check also returns nothing
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.patch(
            "/api/admin/drafts/nonexistent-id",
            json={"draft_data": {"medicine_name": "Whatever"}},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 404


def test_patch_draft_returns_409_for_non_draft_status(client):
    """PATCH /api/admin/drafts/{id} returns 409 when draft is not in 'draft' status."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "update pill_drafts" in sql_str:
            # UPDATE found no row (status != 'draft')
            result.fetchone.return_value = None
        elif "select status" in sql_str:
            # Draft exists but is in pending_review
            result.fetchone.return_value = ("pending_review",)
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.patch(
            "/api/admin/drafts/some-submitted-draft",
            json={"draft_data": {"medicine_name": "Whatever"}},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 409
    assert "pending_review" in resp.json()["detail"]


def test_create_draft_upsert_returns_200_on_update(client):
    """POST /api/admin/pills/{id}/drafts returns 200 when an existing draft is updated."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "update pill_drafts" in sql_str:
            # Existing 'draft' row found and updated — return the id
            result.fetchone.return_value = ("existing-draft-id",)
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/some-pill-id/drafts",
            json={"draft_data": {"medicine_name": "Aspirin"}},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == "existing-draft-id"
    assert data["created"] is False


def test_create_draft_returns_201_on_insert(client):
    """POST /api/admin/pills/{id}/drafts returns 201 when a new draft is inserted."""
    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            # profiles auth lookup
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
        elif "update pill_drafts" in sql_str:
            # No existing 'draft' row — UPDATE returns nothing
            result.fetchone.return_value = None
        elif "insert into pill_drafts" in sql_str:
            result.scalar.return_value = "new-draft-id"
        else:
            result.fetchone.return_value = None
        result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/some-pill-id/drafts",
            json={"draft_data": {"medicine_name": "Aspirin"}},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["id"] == "new-draft-id"
    assert data["created"] is True


def test_list_drafts_returns_unpublished_pillfinder_rows(client):
    """GET /api/admin/drafts returns pillfinder rows where published=false."""
    import datetime

    mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

    call_count = [0]
    pill_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

    def side_effect(sql, *args, **kwargs):
        result = MagicMock()
        call_count[0] += 1
        sql_str = str(sql).lower()
        if call_count[0] == 1:
            result.fetchone.return_value = FAKE_ADMIN_PROFILE
            result.fetchall.return_value = []
        elif "pillfinder" in sql_str and "published" in sql_str:
            result.fetchone.return_value = None
            result.fetchall.return_value = [
                (
                    pill_id,
                    "Ibuprofen",
                    datetime.datetime(2024, 1, 2),
                )
            ]
        else:
            result.fetchone.return_value = None
            result.fetchall.return_value = []
        return result

    mock_conn.execute.side_effect = side_effect

    import database as db_module
    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.get(
            "/api/admin/drafts",
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    # Both 'id' and 'pill_id' are the same pillfinder.id — pill_id is included
    # for backward compatibility with callers that expect the old pill_drafts shape.
    assert data[0]["id"] == pill_id
    assert data[0]["pill_id"] == pill_id  # same as id — no separate draft id
    assert data[0]["status"] == "draft"
    assert data[0]["medicine_name"] == "Ibuprofen"
