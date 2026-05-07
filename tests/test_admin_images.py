"""
Tests for the bulk ZIP image upload endpoint:
  POST /api/admin/pills/bulk-images/zip

Mocks the database, Supabase JWT, and _supabase_upload to avoid real network calls.
"""

import io
import os
import zipfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

FAKE_USER_PAYLOAD = {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@test.com"}
FAKE_SUPERUSER_PROFILE = ("superuser",)

PILL_A_UUID = "aaaaaaaa-0000-0000-0000-000000000001"
PILL_B_UUID = "bbbbbbbb-0000-0000-0000-000000000002"
PILL_C_UUID = "cccccccc-0000-0000-0000-000000000003"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_zip(*entries: tuple[str, bytes]) -> bytes:
    """Build an in-memory ZIP containing (name, data) pairs."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _make_mock_engine():
    """Return a minimal mock SQLAlchemy engine."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.connect.return_value = mock_conn
    mock_engine.begin.return_value = mock_conn
    return mock_engine, mock_conn


@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), patch(
        "main.warmup_system", return_value=None
    ):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine, mock_conn = _make_mock_engine()
        mock_conn.execute.return_value = MagicMock(
            fetchone=MagicMock(return_value=FAKE_SUPERUSER_PROFILE),
            fetchall=MagicMock(return_value=[]),
            scalar=MagicMock(return_value=0),
        )
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


# ── Auth / input validation ───────────────────────────────────────────────────


def test_zip_upload_requires_auth(client):
    """POST /bulk-images/zip returns 401 without auth token."""
    with patch("routes.admin.auth._verify_jwt", return_value=None):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", b"PK\x03\x04", "application/zip")},
        )
    assert resp.status_code == 401


def test_zip_upload_rejects_non_zip(client):
    """Sending a .jpg file (or wrong extension) returns 400."""
    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.return_value = MagicMock(
        fetchone=MagicMock(return_value=FAKE_SUPERUSER_PROFILE),
        fetchall=MagicMock(return_value=[]),
    )

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("photo.jpg", b"fake-jpeg-data", "image/jpeg")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 400
    assert "zip" in resp.json()["detail"].lower()


def test_zip_upload_rejects_oversize(client):
    """A payload larger than MAX_ZIP_SIZE should return 400."""
    import routes.admin.images as images_module

    original = images_module.MAX_ZIP_SIZE
    try:
        images_module.MAX_ZIP_SIZE = 10  # 10 bytes limit for this test

        mock_engine, mock_conn = _make_mock_engine()
        mock_conn.execute.return_value = MagicMock(
            fetchone=MagicMock(return_value=FAKE_SUPERUSER_PROFILE),
            fetchall=MagicMock(return_value=[]),
        )

        import database as db_module

        db_module.db_engine = mock_engine

        big_zip = _make_zip(("image.jpg", b"x" * 100))

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.post(
                "/api/admin/pills/bulk-images/zip",
                files={"file": ("images.zip", big_zip, "application/zip")},
                headers={"Authorization": "Bearer faketoken"},
            )

        assert resp.status_code == 400
        assert "large" in resp.json()["detail"].lower() or "size" in resp.json()["detail"].lower()
    finally:
        images_module.MAX_ZIP_SIZE = original


def test_zip_upload_rejects_invalid_zip(client):
    """Sending bytes that are not a valid ZIP archive returns 400."""
    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.return_value = MagicMock(
        fetchone=MagicMock(return_value=FAKE_SUPERUSER_PROFILE),
        fetchall=MagicMock(return_value=[]),
    )

    import database as db_module

    db_module.db_engine = mock_engine

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", b"this is not a zip file", "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 400
    assert "valid zip" in resp.json()["detail"].lower() or "not a valid" in resp.json()["detail"].lower()


# ── Matching logic ────────────────────────────────────────────────────────────


def _build_side_effect(pill_rows, existing_image_filename=None, stored_fn_capture=None):
    """
    Build a mock execute side_effect that:
    1. Handles profiles auth lookup → returns FAKE_SUPERUSER_PROFILE
    2. Handles SELECT all pills (medicine_name + ndc11 in sql) → returns pill_rows
    3. Handles SELECT image_filename WHERE id → returns existing_image_filename
    4. Handles UPDATE / INSERT → no-op (optionally captures stored fn)
    """
    if stored_fn_capture is None:
        stored_fn_capture = []

    def side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql).lower()
        result = MagicMock()
        result.fetchone.return_value = None
        result.fetchall.return_value = []
        result.scalar.return_value = 0

        if "role" in sql_str and "profiles" in sql_str:
            # Auth: profiles lookup
            result.fetchone.return_value = FAKE_SUPERUSER_PROFILE
        elif "medicine_name" in sql_str and "pillfinder" in sql_str and "ndc11" in sql_str:
            # Pill data loading (SELECT id, medicine_name, slug, ndc11, image_filename FROM pillfinder WHERE ...)
            result.fetchall.return_value = pill_rows
        elif sql_str.lstrip().startswith("select image_filename"):
            # Per-pill image_filename fetch before update
            result.fetchone.return_value = (existing_image_filename,)
        elif "update pillfinder" in sql_str:
            # Capture stored filename
            if params and isinstance(params, dict):
                stored_fn_capture.append(params.get("fn", ""))
            result.fetchone.return_value = None
        # audit_log insert, admin_users fallback → defaults (None/[])

        return result

    return side_effect


def test_zip_matches_by_ndc11(client):
    """Image named exactly 11 digits (e.g. 12345678901.jpg) matches pill by ndc11."""
    pill_rows = [
        (PILL_A_UUID, "Drug A", None, "12345678901", None),
    ]
    stored_fn: list = []
    side_effect = _build_side_effect(pill_rows, existing_image_filename=None, stored_fn_capture=stored_fn)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("12345678901.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["uploaded"] == 1
    assert data["counts"]["skipped"] == 0
    # Check the result entry has the correct pill_id
    assert data["results"][0]["pill_id"] == PILL_A_UUID


def test_zip_matches_hyphenated_ndc11(client):
    """Image named with hyphenated NDC (e.g. 41163-0249-01.jpg) matches via normalization."""
    # DB stores the NDC with hyphens; both should normalize to the same 11-digit key
    pill_rows = [
        (PILL_A_UUID, "Drug A", None, "41163-0249-01", None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    # Filename uses bare digits (hyphens stripped by user)
    zip_bytes = _make_zip(("41163024901.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1, f"Expected match for normalized NDC; got {data}"
    assert data["counts"]["uploaded"] == 1


def test_zip_matches_by_slug(client):
    """Image named after the pill's slug column matches correctly."""
    pill_rows = [
        (PILL_B_UUID, "Aspirin 500 mg", "aspirin-500-mg", None, None),
    ]
    stored_fn: list = []
    side_effect = _build_side_effect(pill_rows, stored_fn_capture=stored_fn)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("aspirin-500-mg.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["uploaded"] == 1
    assert data["results"][0]["pill_id"] == PILL_B_UUID


def test_zip_matches_by_medicine_name_slug(client):
    """Image named as the generated slug of medicine_name matches correctly."""
    # pill has no explicit slug, but medicine_name "Metronidazole" → slug "metronidazole"
    pill_rows = [
        (PILL_C_UUID, "Metronidazole", None, None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("metronidazole.png", b"fake-png"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["uploaded"] == 1
    assert data["results"][0]["pill_id"] == PILL_C_UUID


def test_zip_variant_suffix_stripping(client):
    """Image named 'drug-1.jpg' matches a pill whose slug is 'drug'."""
    pill_rows = [
        (PILL_B_UUID, "Drug", "drug", None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("drug-1.jpg", b"fake-jpeg"), ("drug-2.webp", b"fake-webp"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["total"] == 2
    assert data["counts"]["matched"] == 2
    assert data["counts"]["uploaded"] == 2
    assert data["counts"]["skipped"] == 0


def test_zip_unmatched_image_reported_as_skipped(client):
    """Images with no matching pill appear in results with error and increment skipped count."""
    pill_rows = [
        (PILL_A_UUID, "Aspirin", "aspirin", None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(
        ("aspirin.jpg", b"fake-jpeg"),
        ("unknown-drug.jpg", b"another"),
    )

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["total"] == 2
    assert data["counts"]["matched"] == 1
    assert data["counts"]["uploaded"] == 1
    assert data["counts"]["skipped"] == 1

    skipped = [r for r in data["results"] if r["error"]]
    assert len(skipped) == 1
    assert skipped[0]["filename"] == "unknown-drug.jpg"
    assert "no matching pill" in skipped[0]["error"].lower()


def test_zip_db_update_appends_to_existing(client):
    """New storage paths are appended to existing image_filename, preserving old values."""
    existing = "old-path/old-image.jpg"
    pill_rows = [
        (PILL_A_UUID, "Aspirin", "aspirin", None, existing),
    ]
    stored_fn: list = []
    side_effect = _build_side_effect(pill_rows, existing_image_filename=existing, stored_fn_capture=stored_fn)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("aspirin.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["uploaded"] == 1

    assert stored_fn, "DB UPDATE must have been called"
    combined = stored_fn[-1]
    parts = [p.strip() for p in combined.split(",")]
    assert existing in parts, f"Existing filename must be preserved; got: {combined!r}"
    new_parts = [p for p in parts if PILL_A_UUID[:8] in p]
    assert new_parts, f"New storage path must contain pill_id prefix; got: {combined!r}"


def test_zip_storage_path_follows_scheme(client):
    """Uploaded images are stored as {pill_id}/{pill_id[:8]}-{timestamp}{ext}."""
    pill_rows = [
        (PILL_A_UUID, "Aspirin", "aspirin", None, None),
    ]
    captured_paths: list = []

    async def upload_mock(path, data, content_type):
        captured_paths.append(path)
        return True

    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("aspirin.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, side_effect=upload_mock
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    assert captured_paths, "Storage upload must have been called"

    path = captured_paths[0]
    prefix, filename = path.split("/", 1)
    assert prefix == PILL_A_UUID, f"Storage path must start with pill_id, got: {path!r}"
    # filename should be {pill_id[:8]}-{timestamp}-{uuid_suffix}.jpg
    assert filename.startswith(PILL_A_UUID[:8] + "-"), f"Filename must start with pill_id[:8]-: {filename!r}"
    assert filename.endswith(".jpg"), f"Filename must end with .jpg: {filename!r}"


def test_zip_respects_max_images_limit(client):
    """ZIPs with more than MAX_IMAGES_PER_ZIP images are rejected."""
    import routes.admin.images as images_module

    original = images_module.MAX_IMAGES_PER_ZIP
    try:
        images_module.MAX_IMAGES_PER_ZIP = 2

        mock_engine, mock_conn = _make_mock_engine()
        mock_conn.execute.return_value = MagicMock(
            fetchone=MagicMock(return_value=FAKE_SUPERUSER_PROFILE),
            fetchall=MagicMock(return_value=[]),
        )

        import database as db_module

        db_module.db_engine = mock_engine

        zip_bytes = _make_zip(
            ("a.jpg", b"1"),
            ("b.jpg", b"2"),
            ("c.jpg", b"3"),  # exceeds limit of 2
        )

        with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD):
            resp = client.post(
                "/api/admin/pills/bulk-images/zip",
                files={"file": ("images.zip", zip_bytes, "application/zip")},
                headers={"Authorization": "Bearer faketoken"},
            )

        assert resp.status_code == 400
        assert "too many" in resp.json()["detail"].lower() or "max" in resp.json()["detail"].lower()
    finally:
        images_module.MAX_IMAGES_PER_ZIP = original


def test_zip_skips_non_image_files_inside_zip(client):
    """Non-image entries inside the ZIP (e.g. .txt, .pdf) are silently ignored."""
    pill_rows = [
        (PILL_A_UUID, "Aspirin", "aspirin", None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(
        ("aspirin.jpg", b"fake-jpeg"),
        ("readme.txt", b"this is a text file"),
        ("data.csv", b"col1,col2"),
    )

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Only aspirin.jpg should be counted (txt and csv are ignored)
    assert data["counts"]["total"] == 1
    assert data["counts"]["matched"] == 1


def test_zip_matches_filename_with_spaces_by_slug(client):
    """Image 'Doxycycline Hyclate.jpg' (spaces) matches pill with slug 'doxycycline-hyclate'."""
    pill_rows = [
        (PILL_A_UUID, "Doxycycline Hyclate", "doxycycline-hyclate", None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("Doxycycline Hyclate.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["total"] == 1
    assert data["counts"]["matched"] == 1
    assert data["counts"]["uploaded"] == 1
    assert data["counts"]["skipped"] == 0


def test_zip_matches_filename_with_spaces_and_variant_suffix(client):
    """'Doxycycline Hyclate-1.jpg' (spaces + dash-suffix) matches 'doxycycline-hyclate'."""
    pill_rows = [
        (PILL_A_UUID, "Doxycycline Hyclate", "doxycycline-hyclate", None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("Doxycycline Hyclate-1.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["skipped"] == 0


def test_zip_matches_filename_with_spaces_by_medicine_name(client):
    """'Eprosartan Mesylate.jpg' matches pill with medicine_name 'Eprosartan Mesylate' (no slug)."""
    pill_rows = [
        (PILL_B_UUID, "Eprosartan Mesylate", None, None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("Eprosartan Mesylate.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["skipped"] == 0


def test_zip_matches_bare_trailing_digits(client):
    """'Diphenhydramine Hydrochloride25.jpg' (bare trailing digits) matches the pill."""
    pill_rows = [
        (PILL_C_UUID, "Diphenhydramine Hydrochloride", "diphenhydramine-hydrochloride", None, None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    zip_bytes = _make_zip(("Diphenhydramine Hydrochloride25.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["skipped"] == 0


def test_zip_ndc11_not_slugified(client):
    """11-digit NDC stems are not slugified — they are looked up directly in ndc11_map."""
    pill_rows = [
        (PILL_A_UUID, "Drug A", None, "12345678901", None),
    ]
    side_effect = _build_side_effect(pill_rows)

    mock_engine, mock_conn = _make_mock_engine()
    mock_conn.execute.side_effect = side_effect

    import database as db_module

    db_module.db_engine = mock_engine

    # 11-digit NDC filename — must still match even though _lookup now slugifies non-NDC stems
    zip_bytes = _make_zip(("12345678901.jpg", b"fake-jpeg"))

    with patch("routes.admin.auth._verify_jwt", return_value=FAKE_USER_PAYLOAD), patch(
        "routes.admin.images._async_supabase_upload", new_callable=AsyncMock, return_value=True
    ):
        resp = client.post(
            "/api/admin/pills/bulk-images/zip",
            files={"file": ("images.zip", zip_bytes, "application/zip")},
            headers={"Authorization": "Bearer faketoken"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["counts"]["matched"] == 1
    assert data["counts"]["skipped"] == 0
