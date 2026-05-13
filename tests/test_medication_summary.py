from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from services.medication_guide import build_guide
from services.medication_summary import generate_medication_summary
from services.medication_summary_backfill import run_medication_summary_backfill
from tests.test_medication_guide import _DummyEngine


def test_generate_medication_summary_produces_expected_questions():
    summary_json, summary_html = generate_medication_summary(
        {
            "brand_name": "TESTDRUG",
            "uses": "Used to treat test condition.",
            "contraindications": "Do not use with severe allergy.",
            "warnings": "May cause serious adverse effects.",
            "dosage": "Take once daily as directed.",
            "side_effects": "Nausea and dizziness.",
            "interactions": "Interacts with anticoagulants.",
            "source_url": "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=test",
        }
    )

    questions = summary_json["questions"]
    assert len(questions) == 8
    assert questions[0]["question"] == "What is this medication?"
    assert questions[-1]["question"] == "Where can I find the official prescribing information?"
    assert "medication-summary" in summary_html


def test_summary_backfill_skips_medguide_and_missing_professional():
    rows = [
        {"id": 1, "medguide_html": "<p>Official</p>", "professional_html": "<p>Pro</p>"},
        {"id": 2, "medguide_html": "", "professional_html": ""},
        {"id": 3, "medguide_html": "", "professional_html": "<p>Pro</p>", "brand_name": "Drug"},
    ]

    with patch("services.medication_summary_backfill._connect_db"), patch(
        "services.medication_summary_backfill._iter_rows", side_effect=[iter(rows), iter(rows)]
    ):
        result = run_medication_summary_backfill(limit=10, offset=0, dry_run=True, force=False)

    assert result.processed == 3
    assert result.generated == 1
    assert result.skipped_has_medguide == 1
    assert result.skipped_missing_professional == 1
    assert result.errors == 0


def test_summary_backfill_force_regenerates_existing_summary():
    rows = [
        {
            "id": 1,
            "medguide_html": "",
            "professional_html": "<p>Pro</p>",
            "medication_summary_html": "<p>old</p>",
            "brand_name": "Drug",
        }
    ]

    with patch("services.medication_summary_backfill._connect_db"), patch(
        "services.medication_summary_backfill._iter_rows", side_effect=[iter(rows), iter(rows)]
    ):
        normal = run_medication_summary_backfill(limit=10, offset=0, dry_run=True, force=False)
        forced = run_medication_summary_backfill(limit=10, offset=0, dry_run=True, force=True)

    assert normal.generated == 0
    assert normal.skipped_existing_summary == 1
    assert forced.generated == 1


def test_build_guide_response_includes_medication_summary_fields():
    fresh_row = {
        "id": 99,
        "rxcui": "123456",
        "ndc": "0001-0001-01",
        "spl_set_id": "spl-set-xyz",
        "brand_name": "TESTDRUG",
        "medguide_html": None,
        "medication_summary_json": {
            "questions": [
                {"question": "What is this medication?", "answer": "Answer"},
                {"question": "What is this medication used for?", "answer": "Answer"},
                {"question": "What should I know before taking it?", "answer": "Answer"},
                {"question": "What important warnings are listed?", "answer": "Answer"},
                {"question": "How is this medication usually taken?", "answer": "Answer"},
                {"question": "What side effects are listed?", "answer": "Answer"},
                {"question": "What interactions are listed?", "answer": "Answer"},
                {"question": "Where can I find the official prescribing information?", "answer": "Answer"},
            ]
        },
        "medication_summary_html": "<div>summary</div>",
        "medication_summary_source": "fda_dailymed_professional_label",
        "medication_summary_generated_at": datetime.now(timezone.utc) - timedelta(days=1),
        "fetched_at": datetime.now(timezone.utc) - timedelta(days=1),
    }

    mock_client = type("Client", (), {"fetch_label_by_rxcui": AsyncMock(return_value=None), "fetch_label_by_ndc": AsyncMock(return_value=None)})()

    with patch("services.medication_guide.database.db_engine", _DummyEngine()), patch(
        "services.medication_guide._select_cached_row", return_value=fresh_row
    ):
        result = asyncio.run(build_guide(rxcui="123456", openfda_client=mock_client))

    assert result["has_medication_summary"] is True
    assert result["medication_summary_html"] == "<div>summary</div>"
    assert len(result["medication_summary_json"]["questions"]) == 8
