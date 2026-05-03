"""Unit tests for services/condition_tags.py

Tests verify:
- Correct tags are assigned from treatment-intent sentences
- FALSE POSITIVES from side-effect/warning sentences are NOT tagged
- Word-boundary matching prevents substring false positives
"""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from services.condition_tags import extract_tags, backfill_condition_tags


class TestExtractTagsCorrectMatches:
    """Tags ARE assigned when treatment intent + condition keyword in same sentence."""

    def test_heart_attack_treatment(self):
        text = "Clopidogrel is used to prevent heart attack and stroke."
        result = extract_tags(text)
        assert "heart attack" in result

    def test_myocardial_infarction(self):
        text = "Indicated to reduce the risk of myocardial infarction."
        result = extract_tags(text)
        assert "heart attack" in result

    def test_stroke_prevention(self):
        text = "Used to prevent stroke in patients with atrial fibrillation."
        result = extract_tags(text)
        assert "stroke" in result

    def test_hypertension(self):
        text = "Lisinopril is used to treat hypertension."
        result = extract_tags(text)
        assert "high blood pressure" in result

    def test_high_blood_pressure_phrase(self):
        text = "This medication treats high blood pressure in adults."
        result = extract_tags(text)
        assert "high blood pressure" in result

    def test_diabetes_type2(self):
        text = "Used to treat type 2 diabetes in adults."
        result = extract_tags(text)
        assert "diabetes" in result

    def test_blood_glucose(self):
        text = "Helps control blood glucose levels in patients with diabetes."
        result = extract_tags(text)
        assert "diabetes" in result

    def test_hiv(self):
        text = "EDURANT is used to treat hiv infection in adults."
        result = extract_tags(text)
        assert "hiv" in result

    def test_blood_clots(self):
        text = "Used to prevent blood clots after surgery."
        result = extract_tags(text)
        assert "blood clots" in result

    def test_high_cholesterol(self):
        text = "Atorvastatin is used to treat high cholesterol."
        result = extract_tags(text)
        assert "high cholesterol" in result

    def test_heart_failure(self):
        text = "Used to treat heart failure and reduce hospitalizations."
        result = extract_tags(text)
        assert "heart failure" in result

    def test_multiple_conditions_same_sentence(self):
        text = "Used to prevent heart attack and stroke in high-risk patients."
        result = extract_tags(text)
        assert "heart attack" in result
        assert "stroke" in result

    def test_multiple_conditions_different_sentences(self):
        text = (
            "Lisinopril is used to treat hypertension. "
            "It also helps treat heart failure."
        )
        result = extract_tags(text)
        assert "high blood pressure" in result
        assert "heart failure" in result

    def test_case_insensitive(self):
        text = "This drug TREATS HYPERTENSION and HIGH CHOLESTEROL."
        result = extract_tags(text)
        assert "high blood pressure" in result
        assert "high cholesterol" in result

    def test_pain_specific_phrase(self):
        text = "Oxycodone is used to treat moderate to severe pain."
        result = extract_tags(text)
        assert "pain" in result

    def test_insomnia(self):
        text = "Zolpidem is used to treat insomnia in adults."
        result = extract_tags(text)
        assert "insomnia" in result

    def test_bacterial_infection(self):
        text = "Amoxicillin is used to treat bacterial infections."
        result = extract_tags(text)
        assert "bacterial infection" in result

    def test_peripheral_artery_disease(self):
        text = "Used to treat peripheral arterial disease and poor blood flow."
        result = extract_tags(text)
        assert "peripheral artery disease" in result


class TestExtractTagsFalsePositivePrevention:
    """FALSE POSITIVES: tags must NOT be assigned from side-effect/warning sentences."""

    def test_no_sleep_from_side_effect(self):
        """'sleep' in a side-effect sentence must NOT tag 'insomnia'."""
        text = (
            "Trandolapril is used to treat high blood pressure. "
            "Side effects may include difficulty sleeping or insomnia."
        )
        result = extract_tags(text)
        # insomnia is in a side-effect sentence → must NOT be tagged
        assert "insomnia" not in result
        # blood pressure treatment sentence → SHOULD be tagged
        assert "high blood pressure" in result

    def test_no_pain_from_chest_pain_symptom(self):
        """'chest pain' as a side effect must NOT tag 'pain'."""
        text = (
            "Amlodipine is used to treat hypertension. "
            "Stop taking and call your doctor if you experience chest pain."
        )
        result = extract_tags(text)
        assert "pain" not in result
        assert "high blood pressure" in result

    def test_no_kidney_from_monitoring_warning(self):
        """'kidney' in a monitoring warning must NOT tag 'kidney disease'."""
        text = (
            "Lisinopril is used to treat high blood pressure. "
            "Your doctor may monitor your kidney function during treatment."
        )
        result = extract_tags(text)
        assert "kidney disease" not in result
        assert "high blood pressure" in result

    def test_no_kidney_from_contraindication(self):
        """'kidney disease' in a contraindication must NOT tag 'kidney disease'."""
        text = (
            "Used to treat hypertension. "
            "Do not use if you have severe kidney disease."
        )
        result = extract_tags(text)
        assert "kidney disease" not in result

    def test_no_infection_from_contraindication(self):
        """'infection' in a warning must NOT tag 'bacterial infection'."""
        text = (
            "Used to treat rheumatoid arthritis. "
            "Do not take this medication if you have an active infection."
        )
        result = extract_tags(text)
        assert "bacterial infection" not in result

    def test_no_depression_from_side_effect(self):
        """'depression' as a side effect must NOT tag 'depression'."""
        text = (
            "Propranolol is used to treat high blood pressure. "
            "This medication may cause depression in some patients."
        )
        result = extract_tags(text)
        assert "depression" not in result
        assert "high blood pressure" in result

    def test_no_false_positive_clotrimazole(self):
        """'Clotrimazole' must NOT match 'blood clots' tag."""
        text = "Clotrimazole is used to treat fungal infections."
        result = extract_tags(text)
        assert "blood clots" not in result
        assert "fungal infections" in result

    def test_no_false_positive_adrenal_for_kidney(self):
        """'adrenal' must NOT match 'kidney disease' via 'renal'."""
        text = "This medication affects adrenal function and cortisol secretion."
        result = extract_tags(text)
        assert "kidney disease" not in result

    def test_no_nausea_from_side_effect(self):
        """'nausea' as a side effect must NOT tag 'nausea'."""
        text = (
            "Metformin is used to treat type 2 diabetes. "
            "Common side effects include nausea and vomiting."
        )
        result = extract_tags(text)
        assert "nausea" not in result
        assert "diabetes" in result

    def test_empty_string(self):
        assert extract_tags("") == []

    def test_whitespace_only(self):
        assert extract_tags("   ") == []

    def test_no_match_unrelated_text(self):
        result = extract_tags("This is a completely unrelated piece of text about widgets.")
        assert result == []

    def test_no_duplicates(self):
        text = "Used to treat type 2 diabetes and control blood glucose levels."
        result = extract_tags(text)
        assert result.count("diabetes") == 1


class TestBackfillConditionTags:
    def _make_conn(self, rows):
        conn = MagicMock()
        result = MagicMock()
        result.fetchall.return_value = rows
        conn.execute.return_value = result
        return conn

    def test_backfill_empty_db(self):
        conn = self._make_conn([])
        summary = backfill_condition_tags(conn)
        assert summary == {"processed": 0, "tagged": 0, "skipped": 0}

    def test_backfill_single_row_no_match(self):
        rows = [("12345", "widgetol", "This treats nothing in the keyword list.")]
        conn = self._make_conn(rows)
        summary = backfill_condition_tags(conn)
        assert summary["processed"] == 1
        assert summary["tagged"] == 0

    def test_backfill_single_row_with_tags(self):
        rows = [("99999", "Aspirin", "Used to prevent heart attack and stroke.")]
        conn = self._make_conn(rows)
        summary = backfill_condition_tags(conn)
        assert summary["processed"] == 1
        assert summary["tagged"] == 1
        conn.commit.assert_called()

    def test_backfill_deduplicates_rxcui(self):
        rows = [
            ("11111", "lisinopril 5mg", "Treats hypertension."),
            ("11111", "lisinopril 10mg", "Treats hypertension."),
        ]
        conn = self._make_conn(rows)
        summary = backfill_condition_tags(conn)
        assert summary["processed"] == 1
        assert summary["skipped"] == 1

    def test_backfill_side_effect_text_not_tagged(self):
        """ACE inhibitor with kidney monitoring warning must NOT get kidney tag."""
        rows = [(
            "210673", "mavik",
            "Mavik is used to treat high blood pressure. "
            "Your doctor should monitor your kidney function. "
            "Side effects may include difficulty sleeping."
        )]
        conn = self._make_conn(rows)
        backfill_condition_tags(conn)
        # Verify the INSERT calls — only 'high blood pressure' should be inserted
        insert_calls = [
            str(call) for call in conn.execute.call_args_list
            if "INSERT INTO drug_condition_tags" in str(call)
        ]
        inserted_tags = []
        for call_str in insert_calls:
            if "'tag'" in call_str or '"tag"' in call_str:
                inserted_tags.append(call_str)
        # kidney and insomnia must NOT appear in any INSERT call
        all_calls_str = " ".join(str(c) for c in conn.execute.call_args_list)
        assert "kidney" not in all_calls_str
        assert "insomnia" not in all_calls_str


# ---------------------------------------------------------------------------
# GET /api/pill/{slug}/condition-drugs endpoint tests (keep existing)
# ---------------------------------------------------------------------------

def _make_api_engine(fetchone_return=None, fetchall_return=None):
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
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module
        db_module.db_engine = _make_api_engine()
        with TestClient(app_module.app) as c:
            yield c


class TestConditionDrugsEndpoint:
    def test_returns_404_when_slug_not_found(self, api_client):
        import database as db_module
        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_result.fetchall.return_value = []
        db_module.db_engine.connect.return_value.__enter__.return_value.execute.return_value = mock_result
        resp = api_client.get("/api/pill/unknown-slug-xyz/condition-drugs")
        assert resp.status_code == 404

    def test_returns_empty_when_no_tags(self, api_client):
        import database as db_module
        call_count = [0]
        def side_effect(sql, *args, **kwargs):
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                result.fetchone.return_value = ("12345", "some pill")
                result.fetchall.return_value = []
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            return result
        db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
        resp = api_client.get("/api/pill/some-pill/condition-drugs")
        assert resp.status_code == 200
        assert resp.json() == {"tags": [], "drugs": []}

    def test_returns_correct_structure_when_tags_exist(self, api_client):
        import database as db_module
        call_count = [0]
        def side_effect(sql, *args, **kwargs):
            result = MagicMock()
            call_count[0] += 1
            if call_count[0] == 1:
                result.fetchone.return_value = ("99999", "plavix")
                result.fetchall.return_value = []
            elif call_count[0] == 2:
                result.fetchone.return_value = None
                result.fetchall.return_value = [("high blood pressure",), ("heart attack",)]
            else:
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
        for drug in data["drugs"]:
            assert "drug_name" in drug
            assert "slug" in drug
            assert "shared_tags" in drug

