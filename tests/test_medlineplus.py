"""Tests for services/medlineplus.py and the MedlinePlus-related additions to
services/drug_indications.py.

All network calls and DB connections are mocked — no live Postgres or NIH API
required in CI.
"""

import os
from unittest.mock import MagicMock, call, patch

import pytest

# Ensure DATABASE_URL is set before any module that imports database is loaded
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from services.medlineplus import fetch_by_rxcui, _clean_text

# ---------------------------------------------------------------------------
# Sample MedlinePlus API response (realistic minimal version)
# ---------------------------------------------------------------------------

_LISINOPRIL_RESPONSE = {
    "feed": {
        "entry": [
            {
                "title": {"_value": "Lisinopril", "type": "text"},
                "link": [
                    {
                        "href": (
                            "https://medlineplus.gov/druginfo/meds/a692051.html"
                            "?utm_source=mplusconnect&utm_medium=service"
                        ),
                        "rel": "alternate",
                    }
                ],
                "summary": {
                    "_value": (
                        "Lisinopril is used alone or in combination with other "
                        "medications to treat high blood pressure in adults and "
                        "children 6 years of age and older."
                    ),
                    "type": "html",
                },
            }
        ]
    }
}


def _mock_response(json_data, status_code=200):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data
    mock_resp.raise_for_status = MagicMock()
    if status_code >= 400:
        from requests.exceptions import HTTPError

        mock_resp.raise_for_status.side_effect = HTTPError(response=mock_resp)
    return mock_resp


# ---------------------------------------------------------------------------
# fetch_by_rxcui tests
# ---------------------------------------------------------------------------


class TestFetchByRxcui:
    def test_fetch_by_rxcui_happy_path(self):
        """Canned Lisinopril response is parsed into the expected dict structure."""
        with patch("services.medlineplus.requests.get") as mock_get:
            mock_get.return_value = _mock_response(_LISINOPRIL_RESPONSE)
            result = fetch_by_rxcui("29046")

        assert result is not None
        assert result["rxcui"] == "29046"
        assert result["title"] == "Lisinopril"
        assert "high blood pressure" in result["plain_text"]
        assert result["source_url"] == "https://medlineplus.gov/druginfo/meds/a692051.html"

    def test_fetch_by_rxcui_strips_utm_params(self):
        """UTM query parameters are removed from the source_url."""
        with patch("services.medlineplus.requests.get") as mock_get:
            mock_get.return_value = _mock_response(_LISINOPRIL_RESPONSE)
            result = fetch_by_rxcui("29046")

        assert result is not None
        assert "utm_source" not in result["source_url"]
        assert "utm_medium" not in result["source_url"]
        assert "?" not in result["source_url"]

    def test_fetch_by_rxcui_returns_none_when_no_entry(self):
        """Empty feed.entry → None (no MedlinePlus coverage for this RxCUI)."""
        no_entry_response = {"feed": {"entry": []}}
        with patch("services.medlineplus.requests.get") as mock_get:
            mock_get.return_value = _mock_response(no_entry_response)
            result = fetch_by_rxcui("36437")

        assert result is None

    def test_fetch_by_rxcui_returns_none_on_5xx(self):
        """500 errors (after retries) return None without raising."""
        with patch("services.medlineplus.requests.get") as mock_get, patch(
            "services.medlineplus.time.sleep"
        ):
            mock_get.return_value = _mock_response({}, status_code=500)
            result = fetch_by_rxcui("99999")

        assert result is None
        # Should have attempted _MAX_RETRIES + 1 = 3 times
        assert mock_get.call_count == 3

    def test_fetch_by_rxcui_collapses_whitespace(self):
        """Summary with excessive newlines and spaces is normalised."""
        messy_response = {
            "feed": {
                "entry": [
                    {
                        "title": {"_value": "TestDrug"},
                        "link": [{"href": "https://medlineplus.gov/test.html"}],
                        "summary": {
                            "_value": "\n\n\n   stuff   \n  more\n\n"
                        },
                    }
                ]
            }
        }
        with patch("services.medlineplus.requests.get") as mock_get:
            mock_get.return_value = _mock_response(messy_response)
            result = fetch_by_rxcui("12345")

        assert result is not None
        assert "\n" not in result["plain_text"]
        assert "  " not in result["plain_text"]
        assert result["plain_text"] == result["plain_text"].strip()
        assert "stuff" in result["plain_text"]
        assert "more" in result["plain_text"]


# ---------------------------------------------------------------------------
# _clean_text tests
# ---------------------------------------------------------------------------


class TestCleanText:
    def test_clean_text_strips_html(self):
        """HTML tags are removed; text content is preserved."""
        result = _clean_text("<b>bold</b> and <i>italic</i> text")
        assert "<b>" not in result
        assert "<i>" not in result
        assert "bold" in result
        assert "italic" in result
        assert "text" in result

    def test_clean_text_collapses_newlines(self):
        result = _clean_text("line1\n\nline2\r\nline3")
        assert "\n" not in result
        assert "\r" not in result
        assert "line1" in result
        assert "line2" in result

    def test_clean_text_empty_input(self):
        assert _clean_text("") == ""
        assert _clean_text(None) == ""  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# upsert_from_medlineplus tests
# ---------------------------------------------------------------------------


class TestUpsertFromMedlineplus:
    """Tests for services.drug_indications.upsert_from_medlineplus."""

    _PAYLOAD = {
        "rxcui": "29046",
        "title": "Lisinopril",
        "plain_text": "Lisinopril is used to treat high blood pressure.",
        "source_url": "https://medlineplus.gov/druginfo/meds/a692051.html",
    }

    def _make_conn(self, fetchone_side_effects=None):
        """Return a mock SQLAlchemy connection.

        *fetchone_side_effects* is a list of values returned by successive
        conn.execute(...).fetchone() calls.  If not provided, returns None.
        """
        conn = MagicMock()
        if fetchone_side_effects is not None:
            conn.execute.return_value.fetchone.side_effect = fetchone_side_effects
        else:
            conn.execute.return_value.fetchone.return_value = None
        return conn

    def test_upsert_inserts_new_row(self):
        """No existing rows for this rxcui or drug_name_key → INSERT → 'inserted'."""
        from services.drug_indications import upsert_from_medlineplus

        # Both SELECTs return None → new row
        conn = self._make_conn(fetchone_side_effects=[None, None])

        outcome = upsert_from_medlineplus(conn, "29046", self._PAYLOAD)

        assert outcome == "inserted"
        # SELECT by rxcui, SELECT by drug_name_key, INSERT = 3 execute calls
        assert conn.execute.call_count == 3

    def test_upsert_skips_manual_rows(self):
        """Existing row with source='manual' (found by rxcui) → 'skipped_manual', no write."""
        from services.drug_indications import upsert_from_medlineplus

        conn = self._make_conn(fetchone_side_effects=[(1, "manual")])

        outcome = upsert_from_medlineplus(conn, "29046", self._PAYLOAD)

        assert outcome == "skipped_manual"
        assert conn.execute.call_count == 1  # only the rxcui SELECT

    def test_upsert_updates_existing_medlineplus_row(self):
        """Existing row with source='medlineplus' (found by rxcui) → UPDATE → 'updated'."""
        from services.drug_indications import upsert_from_medlineplus

        conn = self._make_conn(fetchone_side_effects=[(1, "medlineplus")])

        outcome = upsert_from_medlineplus(conn, "29046", self._PAYLOAD)

        assert outcome == "updated"
        assert conn.execute.call_count == 2  # rxcui SELECT + UPDATE

    def test_upsert_handles_drug_name_key_collision(self):
        """No rxcui match; drug_name_key exists with a DIFFERENT rxcui → 'skipped_collision'."""
        from services.drug_indications import upsert_from_medlineplus

        # rxcui SELECT → None; drug_name_key SELECT → row with different rxcui
        conn = self._make_conn(
            fetchone_side_effects=[
                None,  # SELECT by rxcui → not found
                (1, "openfda", "99999"),  # SELECT by drug_name_key → different rxcui
            ]
        )

        outcome = upsert_from_medlineplus(conn, "29046", self._PAYLOAD)

        assert outcome == "skipped_collision"
        assert conn.execute.call_count == 2  # two SELECTs, no write

    def test_upsert_updates_row_found_by_drug_name_key_without_rxcui(self):
        """No rxcui match; drug_name_key row exists with rxcui=None → UPDATE sets rxcui."""
        from services.drug_indications import upsert_from_medlineplus

        # rxcui SELECT → None; drug_name_key SELECT → row with rxcui=None
        conn = self._make_conn(
            fetchone_side_effects=[
                None,  # SELECT by rxcui → not found
                (5, "openfda", None),  # SELECT by drug_name_key → no rxcui yet
            ]
        )

        outcome = upsert_from_medlineplus(conn, "29046", self._PAYLOAD)

        assert outcome == "updated"
        assert conn.execute.call_count == 3  # two SELECTs + UPDATE


# ---------------------------------------------------------------------------
# CLI smoke test
# ---------------------------------------------------------------------------


class TestBackfillCLIParsing:
    def test_argparse_all_flags(self):
        """All expected flags are accepted by _parse_args without error."""
        import importlib.util

        script_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "scripts",
            "backfill_indications_medlineplus.py",
        )
        spec = importlib.util.spec_from_file_location(
            "backfill_indications_medlineplus", script_path
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]

        args = module._parse_args(
            ["--limit", "10", "--rxcui", "29046", "--force", "--dry-run", "--sleep", "300"]
        )

        assert args.limit == 10
        assert args.rxcui == "29046"
        assert args.force is True
        assert args.dry_run is True
        assert args.sleep == 300

    def test_argparse_defaults(self):
        """Default values are correct when no flags are passed."""
        import importlib.util

        script_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "scripts",
            "backfill_indications_medlineplus.py",
        )
        spec = importlib.util.spec_from_file_location(
            "backfill_indications_medlineplus", script_path
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]

        args = module._parse_args([])

        assert args.limit is None
        assert args.rxcui is None
        assert args.force is False
        assert args.dry_run is False
        assert args.sleep == 200
