from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services.drug_pronunciation import (
    fetch_pronunciation_from_medlineplus,
    generate_pronunciation_g2p,
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


def test_generate_pronunciation_g2p_renders_tokens():
    fake_module = SimpleNamespace(G2p=lambda: (lambda _: ["M", "AE1", "P"]))
    with patch.dict("sys.modules", {"g2p_en": fake_module}):
        rendered = generate_pronunciation_g2p("map")
    assert rendered == "MAp"


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
