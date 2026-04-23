"""
Tests for:
  - GET /api/pill-image/{filename} — public redirect route (Bug 2)
  - PUT /api/admin/pills/:id with {"meta_description": null} — clears column (Bug 3c)
  - PUT /api/admin/pills/:id with {"image_filename": "a.jpg,b.jpg"} — persists reorder (Bug 3b)
"""

import os
import pytest
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

FAKE_ADMIN_ROW = ("00000000-0000-0000-0000-000000000001", "admin@test.com", "superadmin", "Admin", True)
FAKE_USER_PAYLOAD = {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@test.com"}

KNOWN_PILL_ID = "8bdcca05-07f5-49d3-96ec-25321e4929a3"
KNOWN_FILENAME = "8bdcca05-1776920313.jpg"  # new-style: starts with pill_id[:8]-


def _make_mock_engine(admin_row=FAKE_ADMIN_ROW):
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
# GET /api/pill-image/{filename} — Bug 2
# ---------------------------------------------------------------------------

class TestPillImageRedirect:
    def test_known_filename_returns_redirect(self, client):
        """GET /api/pill-image/{fn} returns 302 for a filename found in the DB."""
        mock_engine, mock_conn = _make_mock_engine()

        pill_row = MagicMock()
        pill_row.__getitem__ = MagicMock(side_effect=lambda idx: KNOWN_PILL_ID if idx == 0 else None)

        call_count = [0]

        def side_effect(sql, *args, **kwargs):
            result = MagicMock()
            call_count[0] += 1
            result.fetchone.return_value = pill_row
            return result

        mock_conn.execute.side_effect = side_effect

        import database as db_module
        db_module.db_engine = mock_engine

        # Clear the in-memory cache so we don't get a stale result
        import routes.pill_images as pi_module
        pi_module._url_cache.clear()

        resp = client.get(
            f"/api/pill-image/{KNOWN_FILENAME}",
            follow_redirects=False,
        )
        # Should redirect (302) — new-style filename detected by prefix heuristic
        assert resp.status_code == 302
        assert KNOWN_PILL_ID in resp.headers["location"]
        assert KNOWN_FILENAME in resp.headers["location"]

    def test_unknown_filename_returns_404(self, client):
        """GET /api/pill-image/{fn} returns 404 when the filename is not in the DB."""
        mock_engine, mock_conn = _make_mock_engine()

        call_count = [0]

        def side_effect(sql, *args, **kwargs):
            result = MagicMock()
            call_count[0] += 1
            result.fetchone.return_value = None  # not found
            return result

        mock_conn.execute.side_effect = side_effect

        import database as db_module
        db_module.db_engine = mock_engine

        import routes.pill_images as pi_module
        pi_module._url_cache.clear()

        unknown_file = "completely-unknown-file-xyz.jpg"

        # We need to mock _head_ok so the fallback legacy URL also returns False
        with patch("routes.pill_images._head_ok", return_value=False):
            resp = client.get(
                f"/api/pill-image/{unknown_file}",
                follow_redirects=False,
            )
        assert resp.status_code == 404

        # Second request for the same unknown filename: the negative cache should serve 404
        # without hitting the DB again (call_count must not increase).
        calls_before_second = call_count[0]
        resp2 = client.get(
            f"/api/pill-image/{unknown_file}",
            follow_redirects=False,
        )
        assert resp2.status_code == 404
        assert call_count[0] == calls_before_second, (
            "DB must not be queried again for a negatively-cached filename"
        )


# ---------------------------------------------------------------------------
# PUT /api/admin/pills/:id with {"meta_description": null} — Bug 3c
# ---------------------------------------------------------------------------

class TestUpdatePillNullClearing:
    def test_explicit_null_clears_column(self, client):
        """PUT with {"meta_description": null} should include meta_description=NULL in the SQL UPDATE."""
        from datetime import datetime, timezone

        mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

        db_ts = datetime(2024, 1, 1, tzinfo=timezone.utc)
        updated_at_row = MagicMock()
        updated_at_row.__getitem__ = MagicMock(return_value=db_ts)

        # Track SQL calls so we can inspect what was executed
        executed_sqls = []
        executed_params = []

        call_count = [0]

        def side_effect(sql, params=None, *args, **kwargs):
            sql_str = str(sql)
            executed_sqls.append(sql_str)
            executed_params.append(params or {})
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                # Admin auth lookup
                result.fetchone.return_value = FAKE_ADMIN_ROW
            elif "updated_at" in sql_str and "pillfinder" in sql_str:
                # Optimistic locking check
                result.fetchone.return_value = updated_at_row
            else:
                result.fetchone.return_value = MagicMock()
                result.fetchall.return_value = []
            return result

        mock_conn.execute.side_effect = side_effect

        import database as db_module
        db_module.db_engine = mock_engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.put(
                "/api/admin/pills/some-pill-id",
                json={"meta_description": None},
                headers={"Authorization": "Bearer faketoken"},
            )

        # 200 or 422 (validation) — but NOT 500; the key check is that meta_description=null
        # is included in the updates dict passed to the SQL (not silently dropped)
        assert resp.status_code != 500

        # Verify that the UPDATE SQL contains meta_description
        update_sqls = [s for s in executed_sqls if "UPDATE pillfinder SET" in s]
        update_sql_combined = " ".join(update_sqls)
        assert "meta_description" in update_sql_combined, (
            "meta_description must appear in the UPDATE statement when explicitly sent as null"
        )

    def test_absent_field_not_included_in_update(self, client):
        """PUT with only {"medicine_name": "Aspirin"} should NOT update meta_description."""
        from datetime import datetime, timezone

        mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

        db_ts = datetime(2024, 1, 1, tzinfo=timezone.utc)
        updated_at_row = MagicMock()
        updated_at_row.__getitem__ = MagicMock(return_value=db_ts)

        executed_sqls = []
        executed_params = []
        call_count = [0]

        def side_effect(sql, params=None, *args, **kwargs):
            sql_str = str(sql)
            executed_sqls.append(sql_str)
            executed_params.append(params or {})
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                result.fetchone.return_value = FAKE_ADMIN_ROW
            elif "updated_at" in sql_str and "pillfinder" in sql_str:
                result.fetchone.return_value = updated_at_row
            else:
                result.fetchone.return_value = MagicMock()
                result.fetchall.return_value = []
            return result

        mock_conn.execute.side_effect = side_effect

        import database as db_module
        db_module.db_engine = mock_engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.put(
                "/api/admin/pills/some-pill-id",
                json={"medicine_name": "Aspirin"},
                headers={"Authorization": "Bearer faketoken"},
            )

        assert resp.status_code != 500

        # meta_description was NOT sent — verify it is absent from the UPDATE
        update_sqls = [s for s in executed_sqls if "UPDATE pillfinder SET" in s]
        if update_sqls:
            # meta_description should NOT appear in updates when not sent
            all_params = {k: v for d in executed_params for k, v in d.items()}
            assert "meta_description" not in all_params, (
                "meta_description must NOT be in the UPDATE params when it was not sent"
            )


# ---------------------------------------------------------------------------
# PUT /api/admin/pills/:id with {"image_filename": "a.jpg,b.jpg"} — Bug 3b
# ---------------------------------------------------------------------------

class TestUpdatePillImageFilename:
    def test_image_filename_accepted_by_pydantic(self):
        """PillUpdate must accept image_filename without dropping it (Pydantic validation)."""
        from routes.admin.pills import PillUpdate

        body = PillUpdate(image_filename="a.jpg,b.jpg")
        dumped = body.model_dump(exclude_unset=True)
        assert "image_filename" in dumped
        assert dumped["image_filename"] == "a.jpg,b.jpg"

    def test_has_image_not_in_pydantic_model(self):
        """PillUpdate must NOT accept has_image directly — it's derived server-side."""
        from routes.admin.pills import PillUpdate

        # Pydantic v2 with model_config extra='ignore' means extra fields are dropped.
        # PillUpdate no longer declares has_image, so it should not appear in the dump.
        body = PillUpdate.model_validate({"has_image": "TRUE"})
        dumped = body.model_dump(exclude_unset=True)
        assert "has_image" not in dumped, (
            "has_image must not be settable via PillUpdate; it is derived from image_filename"
        )

    def test_has_image_derived_from_image_filename_on_update(self, client):
        """PUT with image_filename must also update has_image server-side."""
        from datetime import datetime, timezone

        mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

        db_ts = datetime(2024, 1, 1, tzinfo=timezone.utc)
        updated_at_row = MagicMock()
        updated_at_row.__getitem__ = MagicMock(return_value=db_ts)

        executed_sqls = []
        executed_params = []
        call_count = [0]

        def side_effect(sql, params=None, *args, **kwargs):
            sql_str = str(sql)
            executed_sqls.append(sql_str)
            executed_params.append(params or {})
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                result.fetchone.return_value = FAKE_ADMIN_ROW
            elif "updated_at" in sql_str and "pillfinder" in sql_str:
                result.fetchone.return_value = updated_at_row
            else:
                result.fetchone.return_value = MagicMock()
                result.fetchall.return_value = []
            return result

        mock_conn.execute.side_effect = side_effect

        import database as db_module
        db_module.db_engine = mock_engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.put(
                "/api/admin/pills/some-pill-id",
                json={"image_filename": "a.jpg,b.jpg"},
                headers={"Authorization": "Bearer faketoken"},
            )

        assert resp.status_code != 500

        # has_image must be derived and appear in the UPDATE SQL alongside image_filename
        update_sqls = [s for s in executed_sqls if "UPDATE pillfinder SET" in s]
        update_sql_combined = " ".join(update_sqls)
        assert "has_image" in update_sql_combined, (
            "has_image must appear in the UPDATE statement when image_filename is sent (server-derived)"
        )

    def test_image_filename_persisted_via_put(self, client):
        """PUT /api/admin/pills/:id with image_filename must include it in the SQL UPDATE."""
        from datetime import datetime, timezone

        mock_engine, mock_conn = _make_mock_engine(admin_row=FAKE_ADMIN_ROW)

        db_ts = datetime(2024, 1, 1, tzinfo=timezone.utc)
        updated_at_row = MagicMock()
        updated_at_row.__getitem__ = MagicMock(return_value=db_ts)

        executed_sqls = []
        executed_params = []
        call_count = [0]

        def side_effect(sql, params=None, *args, **kwargs):
            sql_str = str(sql)
            executed_sqls.append(sql_str)
            executed_params.append(params or {})
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                result.fetchone.return_value = FAKE_ADMIN_ROW
            elif "updated_at" in sql_str and "pillfinder" in sql_str:
                result.fetchone.return_value = updated_at_row
            else:
                result.fetchone.return_value = MagicMock()
                result.fetchall.return_value = []
            return result

        mock_conn.execute.side_effect = side_effect

        import database as db_module
        db_module.db_engine = mock_engine

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.put(
                "/api/admin/pills/some-pill-id",
                json={"image_filename": "a.jpg,b.jpg"},
                headers={"Authorization": "Bearer faketoken"},
            )

        assert resp.status_code != 500

        # image_filename must appear in the UPDATE SQL
        update_sqls = [s for s in executed_sqls if "UPDATE pillfinder SET" in s]
        update_sql_combined = " ".join(update_sqls)
        assert "image_filename" in update_sql_combined, (
            "image_filename must appear in the UPDATE statement when explicitly sent"
        )
