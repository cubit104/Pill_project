"""Unit tests for services/drug_indications.py and services/rxnorm.py.

All network calls and DB connections are mocked — no live Postgres or openFDA
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

from services.drug_indications import (
    truncate_indication,
    fetch_indications_from_openfda,
    fetch_indications_by_rxcui,
    resolve_and_fetch,
    upsert_indication,
)

# ---------------------------------------------------------------------------
# truncate_indication tests
# ---------------------------------------------------------------------------


class TestTruncateIndication:
    def test_truncate_under_limit(self):
        """Short text returned unchanged."""
        text = "Used to treat pain."
        assert truncate_indication(text) == text

    def test_truncate_at_sentence_boundary(self):
        """Cuts at last '.' after char 150 when one exists within the limit."""
        # Build a string with a period at position ~200, total length > 300
        sentence = "A" * 160 + ". " + "B" * 140
        result = truncate_indication(sentence, limit=300)
        assert result.endswith(".")
        assert len(result) <= 300

    def test_truncate_at_word_boundary(self):
        """No period available → cuts at last space and appends ellipsis."""
        # 300 chars of 'A's with spaces but no period
        words = " ".join(["word"] * 70)  # ~350 chars
        result = truncate_indication(words, limit=300)
        assert result.endswith("\u2026")
        assert " " not in result[-5:]  # ends at a word boundary

    def test_truncate_hard_cut(self):
        """Single long token with no spaces or periods → hard cut + ellipsis."""
        long_token = "X" * 400
        result = truncate_indication(long_token, limit=300)
        assert result == "X" * 300 + "\u2026"

    def test_truncate_empty_input(self):
        """Empty string and None both return empty string."""
        assert truncate_indication("") == ""
        assert truncate_indication(None) == ""  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# fetch_indications_from_openfda tests
# ---------------------------------------------------------------------------

_OPENFDA_RESPONSE = {
    "results": [
        {
            "openfda": {
                "generic_name": ["IBUPROFEN"],
                "pharm_class_epc": ["Nonsteroidal Anti-inflammatory Drug [EPC]"],
            },
            "indications_and_usage": [
                "Ibuprofen tablets are indicated for relief of mild to moderate pain."
            ],
        }
    ]
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


class TestFetchIndicationsFromOpenfda:
    def test_fetch_parses_openfda_response(self):
        """Canned openFDA response is parsed into the expected dict structure."""
        with patch("services.drug_indications.requests.get") as mock_get:
            mock_get.return_value = _mock_response(_OPENFDA_RESPONSE)
            result = fetch_indications_from_openfda("ibuprofen")

        assert result is not None
        assert result["generic_name"] == "IBUPROFEN"
        assert "Nonsteroidal" in result["pharm_class"]
        assert "mild to moderate pain" in result["indications_text"]

    def test_fetch_returns_none_when_empty(self):
        """200 response with empty results array returns None."""
        with patch("services.drug_indications.requests.get") as mock_get:
            mock_get.return_value = _mock_response({"results": []})
            result = fetch_indications_from_openfda("unknowndrug")

        assert result is None

    def test_fetch_returns_none_on_404(self):
        """404 from openFDA returns None without raising an exception."""
        with patch("services.drug_indications.requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 404
            mock_resp.raise_for_status = MagicMock()
            mock_get.return_value = mock_resp
            result = fetch_indications_from_openfda("notadrug")

        assert result is None

    def test_fetch_strips_whitespace_and_bullets(self):
        """Newlines, bullet characters, and extra spaces are collapsed."""
        messy_data = {
            "results": [
                {
                    "openfda": {"generic_name": ["TESTDRUG"]},
                    "indications_and_usage": [
                        "• Used to treat\n\n  pain  and   fever.\n• Also arthritis."
                    ],
                }
            ]
        }
        with patch("services.drug_indications.requests.get") as mock_get:
            mock_get.return_value = _mock_response(messy_data)
            result = fetch_indications_from_openfda("testdrug")

        assert result is not None
        text = result["indications_text"]
        assert "\n" not in text
        assert "  " not in text  # no double spaces
        assert text == text.strip()


# ---------------------------------------------------------------------------
# upsert_indication tests
# ---------------------------------------------------------------------------


class TestUpsertIndication:
    def _make_conn(self, returning_row=None):
        """Return a mock SQLAlchemy connection.

        *returning_row* is what the single INSERT ... ON CONFLICT ... RETURNING
        statement returns:
          - ``None``          → manual override (DO UPDATE WHERE was false)
          - ``(id, True)``    → newly inserted row
          - ``(id, False)``   → updated existing row
        """
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = returning_row
        return conn

    def test_upsert_skips_when_source_manual(self):
        """RETURNING nothing → source='manual', return 'skipped_manual'."""
        conn = self._make_conn(returning_row=None)
        payload = {
            "generic_name": "IBUPROFEN",
            "pharm_class": "NSAID",
            "indications_text": "Used to treat pain.",
        }
        outcome = upsert_indication(conn, "ibuprofen", payload)

        assert outcome == "skipped_manual"
        assert conn.execute.call_count == 1  # single atomic statement

    def test_upsert_inserts_new_row(self):
        """RETURNING (id, True) → newly inserted row → 'inserted'."""
        conn = self._make_conn(returning_row=(1, True))
        payload = {
            "generic_name": "IBUPROFEN",
            "pharm_class": "NSAID",
            "indications_text": "Used to treat pain.",
        }
        outcome = upsert_indication(conn, "ibuprofen", payload)

        assert outcome == "inserted"
        assert conn.execute.call_count == 1  # single atomic statement

    def test_upsert_updates_existing_openfda_row(self):
        """RETURNING (id, False) → updated existing row → 'updated'."""
        conn = self._make_conn(returning_row=(1, False))
        payload = {
            "generic_name": "IBUPROFEN",
            "pharm_class": "NSAID",
            "indications_text": "Updated text.",
        }
        outcome = upsert_indication(conn, "ibuprofen", payload)

        assert outcome == "updated"
        assert conn.execute.call_count == 1  # single atomic statement


# ---------------------------------------------------------------------------
# RxNorm / RxNav tests
# ---------------------------------------------------------------------------

_RXNAV_RXCUI_RESPONSE = {
    "idGroup": {
        "name": "lisinopril",
        "rxnormId": ["29046"],
    }
}

_RXNAV_RELATED_INGREDIENT_RESPONSE = {
    "relatedGroup": {
        "rxcui": "29046",
        "conceptGroup": [
            {
                "tty": "IN",
                "conceptProperties": [
                    {"rxcui": "29046", "name": "lisinopril", "tty": "IN"},
                ],
            }
        ],
    }
}

_RXNAV_RELATED_ALREADY_INGREDIENT = {
    "relatedGroup": {
        "rxcui": "29046",
        "conceptGroup": [
            {
                "tty": "IN",
                "conceptProperties": [
                    {"rxcui": "29046", "name": "lisinopril", "tty": "IN"},
                ],
            }
        ],
    }
}

_RXNAV_NDC_RESPONSE = {
    "idGroup": {
        "idtype": "NDC",
        "id": "65162020010",
        "rxnormId": ["310965"],
    }
}


def _mock_resp(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status = MagicMock()
    if status_code >= 400:
        from requests.exceptions import HTTPError
        mock.raise_for_status.side_effect = HTTPError(response=mock)
    return mock


class TestRxNavFindIngredientRxcui:
    def test_rxnav_find_ingredient_simple(self):
        """name → initial RxCUI → ingredient RxCUI resolved via related.json."""
        from services.rxnorm import find_ingredient_rxcui

        responses = [
            _mock_resp(_RXNAV_RXCUI_RESPONSE),
            _mock_resp(_RXNAV_RELATED_INGREDIENT_RESPONSE),
        ]
        with patch("services.rxnorm.requests.get", side_effect=responses):
            result = find_ingredient_rxcui("lisinopril")

        assert result is not None
        assert result["rxcui"] == "29046"
        assert result["name"] == "lisinopril"

    def test_rxnav_find_ingredient_already_ingredient(self):
        """Input already maps to TTY=IN — returns itself without recursing."""
        from services.rxnorm import find_ingredient_rxcui

        responses = [
            _mock_resp(_RXNAV_RXCUI_RESPONSE),
            _mock_resp(_RXNAV_RELATED_ALREADY_INGREDIENT),
        ]
        with patch("services.rxnorm.requests.get", side_effect=responses):
            result = find_ingredient_rxcui("lisinopril")

        assert result is not None
        assert result["rxcui"] == "29046"

    def test_rxnav_returns_none_when_not_found(self):
        """Empty idGroup → None returned, no exception raised."""
        from services.rxnorm import find_ingredient_rxcui

        empty_response = {"idGroup": {"name": "unknowndrug"}}
        with patch("services.rxnorm.requests.get", return_value=_mock_resp(empty_response)):
            result = find_ingredient_rxcui("unknowndrug")

        assert result is None

    def test_rxnav_find_rxcui_by_ndc(self):
        """NDC lookup returns RxCUI string."""
        from services.rxnorm import find_rxcui_by_ndc

        with patch("services.rxnorm.requests.get", return_value=_mock_resp(_RXNAV_NDC_RESPONSE)):
            result = find_rxcui_by_ndc("65162-0200-10")

        assert result == "310965"


# ---------------------------------------------------------------------------
# fetch_indications_by_rxcui tests
# ---------------------------------------------------------------------------

_OPENFDA_RXCUI_MULTI = {
    "results": [
        {
            "openfda": {
                "generic_name": ["LISINOPRIL AND HYDROCHLOROTHIAZIDE"],
                "pharm_class_epc": ["Thiazide Diuretic [EPC]"],
                "rxcui": ["29046"],
            },
            "indications_and_usage": ["Combo indications text."],
        },
        {
            "openfda": {
                "generic_name": ["LISINOPRIL"],
                "pharm_class_epc": ["Angiotensin Converting Enzyme Inhibitor [EPC]"],
                "rxcui": ["29046"],
            },
            "indications_and_usage": ["Lisinopril is indicated for hypertension."],
        },
    ]
}


class TestFetchIndicationsByRxcui:
    def test_fetch_indications_by_rxcui_picks_single_ingredient(self):
        """When results include both combo and single-ingredient, picks the single-ingredient."""
        with patch("services.drug_indications.requests.get") as mock_get:
            mock_get.return_value = _mock_resp(_OPENFDA_RXCUI_MULTI)
            result = fetch_indications_by_rxcui("29046")

        assert result is not None
        assert result["generic_name"] == "LISINOPRIL"
        assert "hypertension" in result["indications_text"]
        assert result["rxcui"] == "29046"


# ---------------------------------------------------------------------------
# resolve_and_fetch tests
# ---------------------------------------------------------------------------

_OPENFDA_LISINOPRIL_SINGLE = {
    "results": [
        {
            "openfda": {
                "generic_name": ["LISINOPRIL"],
                "pharm_class_epc": ["Angiotensin Converting Enzyme Inhibitor [EPC]"],
                "rxcui": ["29046"],
            },
            "indications_and_usage": [
                "Lisinopril is indicated for the treatment of hypertension."
            ],
        }
    ]
}


class TestResolveAndFetch:
    def test_resolve_and_fetch_full_chain_ok(self):
        """End-to-end: lisinopril → rxcui 29046 → correct FDA label."""
        rxcui_info = {"rxcui": "29046", "name": "lisinopril"}
        label = {
            "generic_name": "LISINOPRIL",
            "pharm_class": "Angiotensin Converting Enzyme Inhibitor [EPC]",
            "indications_text": "Lisinopril is indicated for hypertension.",
            "rxcui": "29046",
        }

        with patch("services.drug_indications.find_ingredient_rxcui", return_value=rxcui_info), \
             patch("services.drug_indications.fetch_indications_by_rxcui", return_value=label):
            result = resolve_and_fetch("lisinopril")

        assert result is not None
        assert result["drug_name_key"] == "lisinopril"
        assert result["rxcui"] == "29046"
        assert result["rxcui_name"] == "lisinopril"
        assert result["generic_name"] == "LISINOPRIL"
        assert "hypertension" in result["indications_text"]

    def test_resolve_and_fetch_returns_none_when_rxnav_fails(self):
        """If RxNav returns no RxCUI, resolve_and_fetch propagates None cleanly."""
        with patch("services.drug_indications.find_ingredient_rxcui", return_value=None):
            result = resolve_and_fetch("unknowndrug")

        assert result is None


# ---------------------------------------------------------------------------
# upsert_indication with rxcui columns tests
# ---------------------------------------------------------------------------


class TestUpsertIndicationWithRxcui:
    def _make_conn(self, returning_row=None):
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = returning_row
        return conn

    def test_upsert_persists_rxcui_columns(self):
        """SQL sent to the DB includes rxcui and rxcui_name bind params."""
        conn = self._make_conn(returning_row=(1, True))
        payload = {
            "generic_name": "LISINOPRIL",
            "pharm_class": "Angiotensin Converting Enzyme Inhibitor [EPC]",
            "indications_text": "Lisinopril is indicated for hypertension.",
            "rxcui": "29046",
            "rxcui_name": "lisinopril",
        }
        outcome = upsert_indication(conn, "lisinopril", payload)

        assert outcome == "inserted"
        # Verify the call included the rxcui params
        call_kwargs = conn.execute.call_args
        params = call_kwargs[0][1]  # second positional arg is the params dict
        assert params["rxcui"] == "29046"
        assert params["rxcui_name"] == "lisinopril"
        # SQL text should reference rxcui column
        sql_text = str(call_kwargs[0][0])
        assert "rxcui" in sql_text
