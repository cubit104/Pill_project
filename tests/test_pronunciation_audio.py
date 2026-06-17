"""Tests for services/pronunciation_audio.py and the pronunciation audio route."""
from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Environment stubs required before importing app modules
# ---------------------------------------------------------------------------
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from services.pronunciation_audio import (  # noqa: E402
    generate_audio,
    get_or_generate_audio,
    upload_audio_to_supabase,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(*, json_data=None, status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.raise_for_status = MagicMock()
    response.json.return_value = json_data or {}
    return response


# ---------------------------------------------------------------------------
# generate_audio
# ---------------------------------------------------------------------------

def test_generate_audio_returns_bytes_on_success():
    import base64

    fake_mp3 = b"\xff\xfb\x90\x00" * 10
    encoded = base64.b64encode(fake_mp3).decode()

    with patch.dict("os.environ", {"GOOGLE_TTS_API_KEY": "test-key"}):
        with patch("services.pronunciation_audio.requests.post") as mock_post:
            mock_post.return_value = _mock_response(json_data={"audioContent": encoded})
            result = generate_audio("lisinopril")

    assert result == fake_mp3
    mock_post.assert_called_once()


def test_generate_audio_returns_none_when_no_api_key():
    with patch.dict("os.environ", {}, clear=True):
        result = generate_audio("lisinopril")

    assert result is None


def test_generate_audio_returns_none_on_repeated_failure():
    with patch.dict("os.environ", {"GOOGLE_TTS_API_KEY": "test-key"}):
        with patch("services.pronunciation_audio.requests.post") as mock_post:
            with patch("services.pronunciation_audio.time.sleep"):
                mock_post.side_effect = Exception("network error")
                result = generate_audio("lisinopril", max_retries=1)

    assert result is None
    assert mock_post.call_count == 2  # initial attempt + 1 retry


# ---------------------------------------------------------------------------
# upload_audio_to_supabase
# ---------------------------------------------------------------------------

def test_upload_audio_returns_public_url():
    with patch.dict(
        "os.environ",
        {
            "NEXT_PUBLIC_SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "svc-key",
        },
    ):
        with patch("services.pronunciation_audio.requests.post") as mock_post:
            mock_post.return_value = _mock_response()
            url = upload_audio_to_supabase("lisinopril", b"mp3bytes")

    assert url == "https://example.supabase.co/storage/v1/object/public/pronunciation-audio/lisinopril.mp3"


def test_upload_audio_url_encodes_drug_name():
    """Drug names with spaces/special chars must be percent-encoded."""
    with patch.dict(
        "os.environ",
        {
            "NEXT_PUBLIC_SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "svc-key",
        },
    ):
        with patch("services.pronunciation_audio.requests.post") as mock_post:
            mock_post.return_value = _mock_response()
            url = upload_audio_to_supabase("Drug Name (oral)", b"mp3bytes")

    assert " " not in url
    assert "(" not in url
    assert "drug%20name%20%28oral%29.mp3" in url


def test_upload_audio_returns_none_when_env_missing():
    with patch.dict("os.environ", {}, clear=True):
        url = upload_audio_to_supabase("lisinopril", b"mp3bytes")

    assert url is None


def test_upload_audio_returns_none_on_request_failure():
    with patch.dict(
        "os.environ",
        {
            "NEXT_PUBLIC_SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "svc-key",
        },
    ):
        with patch("services.pronunciation_audio.requests.post") as mock_post:
            mock_post.side_effect = Exception("upload failed")
            url = upload_audio_to_supabase("lisinopril", b"mp3bytes")

    assert url is None


# ---------------------------------------------------------------------------
# get_or_generate_audio
# ---------------------------------------------------------------------------

def test_get_or_generate_audio_returns_cached_url():
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = ("https://cached-url.mp3",)

    url = get_or_generate_audio(conn, "lisinopril")

    assert url == "https://cached-url.mp3"
    # Should not attempt to generate new audio when cached URL is present
    conn.execute.assert_called_once()


def test_get_or_generate_audio_generates_when_cache_empty():
    import base64

    fake_mp3 = b"\xff\xfb\x90\x00" * 10
    encoded = base64.b64encode(fake_mp3).decode()

    conn = MagicMock()
    # First call: cache lookup returns row with NULL audio_url
    # Second call: persist UPDATE
    conn.execute.return_value.fetchone.return_value = (None,)

    with patch("services.pronunciation_audio.generate_audio", return_value=fake_mp3):
        with patch(
            "services.pronunciation_audio.upload_audio_to_supabase",
            return_value="https://new-url.mp3",
        ):
            url = get_or_generate_audio(conn, "lisinopril")

    assert url == "https://new-url.mp3"
    # Should have called execute twice: lookup + UPDATE persist
    assert conn.execute.call_count == 2


def test_get_or_generate_audio_returns_none_when_no_row():
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = None

    url = get_or_generate_audio(conn, "unknowndrug")

    assert url is None


def test_get_or_generate_audio_returns_none_on_db_error():
    from sqlalchemy.exc import SQLAlchemyError

    conn = MagicMock()
    conn.execute.side_effect = SQLAlchemyError("connection failed")

    url = get_or_generate_audio(conn, "lisinopril")

    assert url is None


# ---------------------------------------------------------------------------
# API endpoint: GET /api/pronunciation/{drug_name}/audio
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    with patch("main.connect_to_database", return_value=True), patch(
        "main.warmup_system", return_value=None
    ):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


def _mock_conn_for_pronunciation(monkeypatch):
    import routes.pronunciation as pronunciation

    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_conn
    mock_cm.__exit__.return_value = False
    mock_engine.begin.return_value = mock_cm
    monkeypatch.setattr(pronunciation.database, "db_engine", mock_engine)
    return pronunciation, mock_conn


def test_pronunciation_audio_404_when_no_row(client, monkeypatch):
    pronunciation, mock_conn = _mock_conn_for_pronunciation(monkeypatch)

    monkeypatch.setattr(pronunciation, "get_pronunciation", lambda conn, name: None)
    monkeypatch.setattr(pronunciation, "get_or_generate_audio", lambda conn, name: None)
    # row existence check returns None → 404
    mock_conn.execute.return_value.fetchone.return_value = None

    response = client.get("/api/pronunciation/unknowndrug/audio")
    assert response.status_code == 404
    assert "No pronunciation found" in response.json()["error"]


def test_pronunciation_audio_200_with_nulls_when_row_exists(client, monkeypatch):
    pronunciation, mock_conn = _mock_conn_for_pronunciation(monkeypatch)

    monkeypatch.setattr(pronunciation, "get_pronunciation", lambda conn, name: None)
    monkeypatch.setattr(pronunciation, "get_or_generate_audio", lambda conn, name: None)
    # row exists but audio/text not yet backfilled
    mock_conn.execute.return_value.fetchone.return_value = (1,)

    response = client.get("/api/pronunciation/lisinopril/audio")
    assert response.status_code == 200
    body = response.json()
    assert body["drug_name"] == "lisinopril"
    assert body["audio_url"] is None
    assert body["pronunciation_text"] is None


def test_pronunciation_audio_200_with_audio_url(client, monkeypatch):
    pronunciation, mock_conn = _mock_conn_for_pronunciation(monkeypatch)

    monkeypatch.setattr(
        pronunciation, "get_pronunciation", lambda conn, name: "lyse in' oh pril"
    )
    monkeypatch.setattr(
        pronunciation,
        "get_or_generate_audio",
        lambda conn, name: "https://example.supabase.co/storage/v1/object/public/pronunciation-audio/lisinopril.mp3",
    )

    response = client.get("/api/pronunciation/lisinopril/audio")
    assert response.status_code == 200
    body = response.json()
    assert body["drug_name"] == "lisinopril"
    assert body["audio_url"].endswith("lisinopril.mp3")
    assert body["pronunciation_text"] == "lyse in' oh pril"
