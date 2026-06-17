from unittest.mock import MagicMock, patch

from services.drug_pronunciation import (
    fetch_pronunciation_from_medlineplus,
    generate_pronunciation_gemini,
    resolve_rxcui_for_drug_name,
    upsert_pronunciation,
)


def _mock_response(*, json_data=None, text_data="", status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.text = text_data
    response.raise_for_status = MagicMock()
    response.json.return_value = json_data
    return response


def test_fetch_pronunciation_continues_when_first_page_has_no_match():
    connect_payload = {
        "feed": {
            "entry": [
                {"title": {"_value": "Drug A"}, "link": [{"href": "https://medlineplus.gov/druginfo/meds/a.html"}]},
                {"title": {"_value": "Drug B"}, "link": [{"href": "https://medlineplus.gov/druginfo/meds/b.html"}]},
            ]
        }
    }
    with patch("services.drug_pronunciation.requests.get") as mock_get:
        mock_get.side_effect = [
            _mock_response(json_data=connect_payload),
            _mock_response(text_data="<html>no pronunciation text</html>"),
            _mock_response(text_data="Drug B is pronounced as (D R AH G B IY)"),
        ]

        result = fetch_pronunciation_from_medlineplus("123")

    assert result is not None
    assert result["pronunciation_text"] == "D R AH G B IY"
    assert result["medlineplus_url"] == "https://medlineplus.gov/druginfo/meds/b.html"


def test_fetch_pronunciation_skips_non_medlineplus_links():
    connect_payload = {
        "feed": {
            "entry": [
                {"title": {"_value": "Drug A"}, "link": [{"href": "https://example.com/druginfo/meds/a.html"}]}
            ]
        }
    }
    with patch("services.drug_pronunciation.requests.get") as mock_get:
        mock_get.return_value = _mock_response(json_data=connect_payload)
        result = fetch_pronunciation_from_medlineplus("123")

    assert result is None
    assert mock_get.call_count == 1


def test_generate_pronunciation_gemini_success():
    """Test Gemini returns pronunciation text when API call succeeds."""
    gemini_response = {
        "candidates": [{"content": {"parts": [{"text": "uh bem uh sye' klib"}]}}]
    }
    with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key-123"}):
        with patch("services.drug_pronunciation.requests.post") as mock_post:
            mock_post.return_value = _mock_response(json_data=gemini_response)
            result = generate_pronunciation_gemini("Abemaciclib")

    assert result == "uh bem uh sye' klib"
    mock_post.assert_called_once()


def test_generate_pronunciation_gemini_no_api_key():
    """Test Gemini returns None when GEMINI_API_KEY is not set."""
    with patch.dict("os.environ", {}, clear=True):
        result = generate_pronunciation_gemini("Abemaciclib")

    assert result is None


def test_generate_pronunciation_gemini_api_error():
    """Test Gemini returns None on API failure."""
    with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key-123"}):
        with patch("services.drug_pronunciation.requests.post") as mock_post:
            mock_post.side_effect = Exception("API timeout")
            result = generate_pronunciation_gemini("Abemaciclib")

    assert result is None


def test_generate_pronunciation_gemini_strips_quotes():
    """Test Gemini strips surrounding quotes from response."""
    gemini_response = {
        "candidates": [{"content": {"parts": [{"text": '"met for\' min"'}]}}]
    }
    with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key-123"}):
        with patch("services.drug_pronunciation.requests.post") as mock_post:
            mock_post.return_value = _mock_response(json_data=gemini_response)
            result = generate_pronunciation_gemini("Metformin")

    assert result == "met for' min"


def test_resolve_rxcui_for_brand_name_case_insensitive_match():
    conn = MagicMock()
    conn.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=None)),
        MagicMock(fetchone=MagicMock(return_value=("999",))),
    ]
    assert resolve_rxcui_for_drug_name(conn, "advil") == "999"


def test_upsert_pronunciation_returns_inserted_updated_or_skipped():
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = (True,)
    assert upsert_pronunciation(conn, "Drug", "D R AH G", "medlineplus") == "inserted"

    conn.execute.return_value.fetchone.return_value = (False,)
    assert upsert_pronunciation(conn, "Drug", "D R AH G", "medlineplus") == "updated"

    conn.execute.return_value.fetchone.return_value = None
    assert upsert_pronunciation(conn, "Drug", "D R AH G", "medlineplus") == "skipped_manual"
