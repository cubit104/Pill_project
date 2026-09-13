"""Admin review of camera captures: queue, labelling, unusable photos, export."""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient

import database
import main as app_module
from routes.admin.auth import get_admin_user

SUPER = {"id": "admin-1", "email": "super@test.com", "role": "superuser"}
REVIEWER = {"id": "rev-1", "email": "rev@test.com", "role": "reviewer"}
NOW = datetime(2026, 9, 12, 8, 0, tzinfo=timezone.utc)
CID = "11111111-1111-4111-8111-111111111111"
PATHS = [f"{CID}/side1.jpg", f"{CID}/side2.jpg"]
SIGNED = {PATHS[0]: "https://signed.test/1", PATHS[1]: "https://signed.test/2"}

COLUMNS = (
    "capture_id created_at imprint_read tokens attrs_guess top_slugs consent photo_paths verdict "
    "chosen_slug corrected_imprint reviewed reviewed_label side_labels reviewed_at reviewed_by"
).split()
IDX = {name: i for i, name in enumerate(COLUMNS)}


def _row(**over):
    base = [CID, NOW, "BX 2", ["BX", "2"], {"shape": "ROUND", "color": "YELLOW"}, ["baxfendy-2-mg", "fanapt-2-2"],
            True, list(PATHS), "up", "baxfendy-2-mg", None, False, None, None, None, None]
    for k, v in over.items():
        base[IDX[k]] = v
    return tuple(base)


class _Conn:
    """Fake connection: answers by looking at the SQL text."""

    def __init__(self, rows, export_rows, log):
        self.rows = rows
        self.export_rows = export_rows
        self.log = log

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        s = " ".join(str(sql).lower().split())
        params = params or {}
        self.log.append((s, params))
        result = MagicMock()
        if "insert into audit_log" in s:
            return result
        if s.startswith("select count(*)"):
            result.scalar.return_value = len(self.rows)
        elif "from pillfinder where deleted_at is null and slug = :slug" in s:
            result.fetchone.return_value = ("bx;2",) if params.get("slug") == "baxfendy-2-mg" else None
        elif "from pillfinder where deleted_at is null and slug = any" in s:
            result.fetchall.return_value = [
                ("baxfendy-2-mg", "Baxfendy", "BX;2", "YELLOW", "ROUND", "2 mg", "bax.jpg"),
                ("fanapt-2-2", "Fanapt", "2", "WHITE", "ROUND", "2 mg", ""),
            ]
        elif "left join pillfinder p" in s:
            result.fetchall.return_value = self.export_rows
        elif s.startswith("select") and "where capture_id = cast(:id as uuid)" in s:
            match = [r for r in self.rows if r[0] == params.get("id")]
            result.fetchone.return_value = match[0] if match else None
        elif s.startswith("select"):
            result.fetchall.return_value = self.rows
        elif s.startswith("update") or s.startswith("delete"):
            result.rowcount = 1 if any(r[0] == params.get("id") for r in self.rows) else 0
        return result


@contextmanager
def _client(rows=None, admin=SUPER, export_rows=()):
    log: list = []
    conn = _Conn(list(rows if rows is not None else [_row()]), list(export_rows), log)
    engine = MagicMock()

    @contextmanager
    def cm():
        yield conn

    engine.connect.side_effect = cm
    engine.begin.side_effect = cm
    if admin is not None:
        app_module.app.dependency_overrides[get_admin_user] = lambda: admin
    original = database.db_engine
    database.db_engine = engine
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
            with TestClient(app_module.app) as client:
                yield client, log
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


def _sql(log, needle):
    return [(s, p) for s, p in log if needle in s]


def test_requires_admin_token():
    with _client(admin=None) as (client, _):
        assert client.get("/api/admin/captures").status_code == 401


def test_queue_lists_unreviewed_with_signed_photo_urls():
    with patch("routes.admin.captures.user_photos.sign_urls", return_value=SIGNED) as sign:
        with _client(admin=REVIEWER) as (client, log):
            resp = client.get("/api/admin/captures")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1 and body["status"] == "unreviewed"
    cap = body["captures"][0]
    assert cap["capture_id"] == CID
    assert cap["photo_urls"] == ["https://signed.test/1", "https://signed.test/2"]
    assert cap["imprint_read"] == "BX 2" and cap["verdict"] == "up" and cap["reviewed"] is False
    sign.assert_called_once_with(PATHS)
    list_sql = _sql(log, "order by created_at desc")[0][0]
    assert "reviewed = false" in list_sql and "jsonb_array_length(photo_paths) > 0" in list_sql


def test_detail_joins_candidates_and_marks_user_pick():
    with patch("routes.admin.captures.user_photos.sign_urls", return_value=SIGNED):
        with _client() as (client, _):
            resp = client.get(f"/api/admin/captures/{CID}")
    assert resp.status_code == 200
    body = resp.json()
    assert [c["slug"] for c in body["candidates"]] == ["baxfendy-2-mg", "fanapt-2-2"]
    assert body["candidates"][0]["user_picked"] is True and body["candidates"][1]["user_picked"] is False
    assert body["candidates"][0]["image_url"].endswith("/bax.jpg")
    assert body["chosen"]["medicine_name"] == "Baxfendy"


def test_review_confirms_pill_and_stores_per_photo_labels():
    with _client(admin=REVIEWER) as (client, log):
        resp = client.post(
            f"/api/admin/captures/{CID}/review",
            json={"chosen_slug": "baxfendy-2-mg", "side_labels": ["  bx   2 ", ""]},
        )
    assert resp.status_code == 200
    body = resp.json()
    # No label typed: the whole-pill imprint defaults to the catalog's, normalised.
    assert body["reviewed_label"] == "BX;2" and body["side_labels"] == ["BX 2", ""]
    update = _sql(log, "update identify_feedback set reviewed = true, chosen_slug")[0]
    assert update[1]["slug"] == "baxfendy-2-mg" and update[1]["label"] == "BX;2"
    assert json.loads(update[1]["sides"]) == ["BX 2", ""] and update[1]["by"] == "rev@test.com"
    assert _sql(log, "insert into audit_log")


def test_review_typed_label_wins_over_catalog():
    with _client() as (client, log):
        resp = client.post(f"/api/admin/captures/{CID}/review", json={"chosen_slug": "baxfendy-2-mg", "reviewed_label": "bx 2"})
    assert resp.status_code == 200 and resp.json()["reviewed_label"] == "BX 2"


def test_review_validation():
    with _client() as (client, _):
        assert client.post(f"/api/admin/captures/{CID}/review", json={}).status_code == 422
        assert client.post(f"/api/admin/captures/{CID}/review", json={"chosen_slug": "nope"}).status_code == 404
        wrong = client.post(f"/api/admin/captures/{CID}/review", json={"chosen_slug": "baxfendy-2-mg", "side_labels": ["A"]})
        assert wrong.status_code == 422 and "one entry per photo" in wrong.json()["detail"]
        assert client.post("/api/admin/captures/not-a-uuid/review", json={"chosen_slug": "x"}).status_code == 422


def test_unusable_deletes_photos_then_marks_row():
    with patch("routes.admin.captures.user_photos.delete_objects", return_value=True) as delete:
        with _client(admin=REVIEWER) as (client, log):
            resp = client.post(f"/api/admin/captures/{CID}/review", json={"unusable": True})
    assert resp.status_code == 200 and resp.json()["unusable"] is True
    delete.assert_called_once_with(PATHS)
    update = _sql(log, "photo_paths = '[]'::jsonb")[0]
    assert "reviewed = true" in update[0] and update[1]["by"] == "rev@test.com"


def test_unusable_keeps_row_when_storage_delete_fails():
    with patch("routes.admin.captures.user_photos.delete_objects", return_value=False):
        with _client() as (client, log):
            resp = client.post(f"/api/admin/captures/{CID}/review", json={"unusable": True})
    assert resp.status_code == 502
    assert not _sql(log, "update identify_feedback")


def test_delete_is_superuser_only():
    with patch("routes.admin.captures.user_photos.delete_objects", return_value=True) as delete:
        with _client(admin=REVIEWER) as (client, log):
            assert client.delete(f"/api/admin/captures/{CID}").status_code == 403
        assert not delete.called
        with _client(admin=SUPER) as (client, log):
            resp = client.delete(f"/api/admin/captures/{CID}")
    assert resp.status_code == 200 and resp.json()["deleted"] is True
    delete.assert_called_once_with(PATHS)
    assert _sql(log, "delete from identify_feedback where capture_id")


def test_reopen_puts_capture_back_in_queue():
    with _client() as (client, log):
        resp = client.post(f"/api/admin/captures/{CID}/reopen")
    assert resp.status_code == 200 and resp.json()["reviewed"] is False
    assert "reviewed = false" in _sql(log, "update identify_feedback")[0][0]


def test_export_manifest_one_row_per_photo():
    export_rows = [
        (CID, NOW, list(PATHS), "baxfendy-2-mg", "BX;2", ["BX 2", ""], NOW, "Baxfendy", "BX;2", "YELLOW", "ROUND"),
        ("22222222-2222-4222-8222-222222222222", NOW, ["22222222-2222-4222-8222-222222222222/side1.jpg"],
         None, "C 73", None, NOW, None, None, None, None),
    ]
    signed = dict(SIGNED, **{"22222222-2222-4222-8222-222222222222/side1.jpg": "https://signed.test/3"})
    with patch("routes.admin.captures.user_photos.sign_urls", return_value=signed) as sign:
        with _client(export_rows=export_rows) as (client, log):
            resp = client.get("/api/admin/captures/export?since=2026-09-01")
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith('attachment; filename="captures_manifest_')
    assert resp.headers["x-manifest-rows"] == "3" and resp.headers["x-manifest-captures"] == "2"
    rows = resp.json()
    assert [r["url"] for r in rows] == ["https://signed.test/1", "https://signed.test/2", "https://signed.test/3"]
    # Per-photo labels when the reviewer wrote them; the blank side stays blank.
    assert rows[0]["imprint"] == "BX 2" and rows[1]["imprint"] == "" and rows[0]["label_scope"] == "side"
    assert rows[0]["slug"] == "baxfendy-2-mg" and rows[0]["name"] == "Baxfendy" and rows[0]["color"] == "YELLOW"
    assert rows[0]["pill_imprint"] == "BX;2" and rows[0]["side"] == 1 and rows[1]["side"] == 2
    # No per-photo labels: the pill label applies to every photo.
    assert rows[2]["imprint"] == "C 73" and rows[2]["label_scope"] == "pill" and rows[2]["slug"] == ""
    from services.user_photos import EXPORT_TTL_S

    assert sign.call_args[0][1] == EXPORT_TTL_S
    query = _sql(log, "left join pillfinder p")[0]
    assert "f.reviewed_at >= :since" in query[0] and str(query[1]["since"]) == "2026-09-01"
    audit = _sql(log, "insert into audit_log")[0][1]
    assert audit["action"] == "capture_exported" and json.loads(audit["metadata"]) == {"captures": 2, "photos": 3, "since": "2026-09-01"}


def test_export_refuses_incomplete_manifest():
    export_rows = [(CID, NOW, list(PATHS), "baxfendy-2-mg", "BX;2", None, NOW, "Baxfendy", "BX;2", "YELLOW", "ROUND")]
    with patch("routes.admin.captures.user_photos.sign_urls", return_value={PATHS[0]: "https://signed.test/1"}):
        with _client(export_rows=export_rows) as (client, log):
            resp = client.get("/api/admin/captures/export")
    assert resp.status_code == 502 and "1 of 2" in resp.json()["detail"]
    assert not _sql(log, "insert into audit_log")


def test_review_can_drop_the_pill_and_keep_only_an_imprint():
    with _client() as (client, log):
        resp = client.post(f"/api/admin/captures/{CID}/review", json={"chosen_slug": None, "reviewed_label": "bx 2"})
    assert resp.status_code == 200 and resp.json()["chosen_slug"] is None and resp.json()["reviewed_label"] == "BX 2"
    update = _sql(log, "update identify_feedback set reviewed = true, chosen_slug = :slug")[0]
    assert update[1]["slug"] is None and update[1]["label"] == "BX 2"


def test_review_rejects_blank_label_without_pill():
    with _client() as (client, _):
        assert client.post(f"/api/admin/captures/{CID}/review", json={"reviewed_label": "   "}).status_code == 422


def test_export_is_not_for_reviewers():
    with _client(admin=REVIEWER) as (client, _):
        assert client.get("/api/admin/captures/export").status_code == 403
