"""Unit tests for services/condition_tags.py and GET /api/pill/{slug}/condition-drugs.

No live Postgres or external network required — all DB calls are mocked.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from services.condition_tags import extract_tags, backfill_condition_tags


# ---------------------------------------------------------------------------
# extract_tags tests
# ---------------------------------------------------------------------------


class TestExtractTags:
    def test_extract_tags_heart_attack(self):
        """plain_text mentioning 'heart attack' returns ['heart attack']."""
        text = "This medication is used to prevent a heart attack in high-risk patients."
        result = extract_tags(text)
        assert "heart attack" in result

    def test_extract_tags_myocardial_infarction(self):
        """'myocardial infarction' also maps to 'heart attack'."""
        text = "Indicated after myocardial infarction to reduce future risk."
        result = extract_tags(text)
        assert "heart attack" in result

    def test_extract_tags_multiple(self):
        """plain_text with 'hypertension' and 'stroke' returns both tags."""
        text = "Used to treat hypertension and reduce the risk of stroke."
        result = extract_tags(text)
        assert "blood pressure" in result
        assert "stroke" in result

    def test_extract_tags_case_insensitive(self):
        """Matching is case-insensitive."""
        text = "This drug treats HYPERTENSION and HIGH CHOLESTEROL."
        result = extract_tags(text)
        assert "blood pressure" in result
        assert "cholesterol" in result

    def test_extract_tags_empty(self):
        """Empty string returns []."""
        result = extract_tags("")
        assert result == []

    def test_extract_tags_none_like(self):
        """None-like falsy value (empty string) returns []."""
        result = extract_tags("   ")
        # "   ".lower() contains no keywords → []
        assert result == []

    def test_extract_tags_no_match(self):
        """Unrelated text returns []."""
        result = extract_tags("This is a completely unrelated piece of text about widgets.")
        assert result == []

    def test_extract_tags_no_duplicates(self):
        """Each tag appears at most once even if multiple keywords match."""
        # "pain relief" and "pain" both map to "pain"
        text = "This analgesic provides pain relief for acute pain episodes."
        result = extract_tags(text)
        assert result.count("pain") == 1

    def test_extract_tags_diabetes(self):
        """'blood glucose' keyword maps to 'diabetes' tag."""
        text = "Helps control blood glucose levels in patients with type 2 diabetes."
        result = extract_tags(text)
        assert "diabetes" in result

    def test_extract_tags_infection(self):
        """'antibiotic' keyword maps to 'infection' tag."""
        text = "An antibiotic used to treat a variety of bacterial infections."
        result = extract_tags(text)
        assert "infection" in result


# ---------------------------------------------------------------------------
# backfill_condition_tags tests
# ---------------------------------------------------------------------------


def _make_mock_conn(rows):
    """Create a mock SQLAlchemy connection that returns *rows* from fetchall()."""
    conn = MagicMock()
    result = MagicMock()
    result.fetchall.return_value = rows
    conn.execute.return_value = result
    return conn


class TestBackfillConditionTags:
    def test_backfill_empty_db(self):
        """Returns {"processed": 0, "tagged": 0, "skipped": 0} when no rows."""
        conn = _make_mock_conn([])
        summary = backfill_condition_tags(conn)
        assert summary == {"processed": 0, "tagged": 0, "skipped": 0}

    def test_backfill_single_row_no_match(self):
        """A row whose plain_text has no keywords is counted as skipped."""
        rows = [("12345", "widgetol", "This treats nothing recognizable in the keyword list.")]
        conn = _make_mock_conn(rows)
        summary = backfill_condition_tags(conn)
        assert summary["processed"] == 1
        assert summary["tagged"] == 0
        assert summary["skipped"] == 1

    def test_backfill_single_row_with_tags(self):
        """A row with matching plain_text is tagged and committed."""
        rows = [("99999", "Aspirin", "Used to prevent heart attack and stroke.")]
        conn = _make_mock_conn(rows)
        summary = backfill_condition_tags(conn)
        assert summary["processed"] == 1
        assert summary["tagged"] == 1
        assert summary["skipped"] == 0
        # commit() should have been called at least once
        conn.commit.assert_called()

    def test_backfill_deduplicates_rxcui(self):
        """Same rxcui appearing twice (different pillfinder rows) is processed once."""
        rows = [
            ("11111", "lisinopril 5mg", "Treats hypertension."),
            ("11111", "lisinopril 10mg", "Treats hypertension."),
        ]
        conn = _make_mock_conn(rows)
        summary = backfill_condition_tags(conn)
        assert summary["processed"] == 1
        assert summary["skipped"] == 1  # second row skipped due to duplicate rxcui


# ---------------------------------------------------------------------------
# GET /api/pill/{slug}/condition-drugs endpoint tests
# ---------------------------------------------------------------------------


def _make_api_engine(fetchone_return=None, fetchall_return=None):
    """Build a mock db_engine suitable for endpoint tests."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    mock_result = MagicMock()
    mock_result.fetchone.return_value = fetchone_return
    mock_result.fetchall.return_value = fetchall_return if fetchall_return is not None else []

    mock_conn.execute.return_value = mock_result
    mock_engine.connect.return_value = mock_conn
    return mock_engine


@pytest.fixture(scope="module")
def api_client():
    """Create a FastAPI TestClient with the DB mocked."""
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = _make_api_engine(fetchone_return=None)
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


class TestConditionDrugsEndpoint:
    def test_returns_empty_when_slug_not_found(self, api_client):
        """GET /api/pill/{slug}/condition-drugs returns empty result when slug not in DB."""
        import database as db_module

        mock_result = MagicMock()
        mock_result.fetchone.return_value = None  # slug not found
        mock_result.fetchall.return_value = []
        db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result

        resp = api_client.get("/api/pill/unknown-slug-xyz/condition-drugs")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"tags": [], "drugs": []}

    def test_returns_empty_when_no_tags(self, api_client):
        """GET returns empty when pill exists but drug_condition_tags has no rows."""
        import database as db_module

        call_count = [0]

        def side_effect(sql, *args, **kwargs):
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                # First call: pillfinder lookup → return rxcui
                result.fetchone.return_value = ("12345",)
                result.fetchall.return_value = []
            else:
                # Second call: drug_condition_tags → no tags
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            return result

        db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect

        resp = api_client.get("/api/pill/some-pill/condition-drugs")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"tags": [], "drugs": []}

    def test_returns_correct_structure_when_tags_exist(self, api_client):
        """GET returns correct {tags, drugs} structure when condition tags exist."""
        import database as db_module

        call_count = [0]

        def side_effect(sql, *args, **kwargs):
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                # pillfinder lookup → rxcui
                result.fetchone.return_value = ("99999",)
                result.fetchall.return_value = []
            elif call_count[0] == 2:
                # drug_condition_tags tags lookup
                result.fetchone.return_value = None
                result.fetchall.return_value = [("blood pressure",), ("heart attack",)]
            else:
                # cross-drug lookups for each tag
                result.fetchone.return_value = None
                result.fetchall.return_value = [
                    ("Lisinopril", "10mg", "lisinopril-10mg", None),
                    ("Metoprolol", "25mg", "metoprolol-25mg", None),
                ]
            return result

        db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect

        resp = api_client.get("/api/pill/plavix-75mg/condition-drugs")
        assert resp.status_code == 200
        data = resp.json()
        assert "tags" in data
        assert "drugs" in data
        assert isinstance(data["tags"], list)
        assert isinstance(data["drugs"], list)
        # All returned drugs must have the required keys
        for drug in data["drugs"]:
            assert "drug_name" in drug
            assert "slug" in drug
            assert "shared_tags" in drug
            assert isinstance(drug["shared_tags"], list)

