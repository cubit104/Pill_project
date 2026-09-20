"""Public IV drug endpoints: only published rows, and a card only once a reviewer approved it."""

import os
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
from routes import drug_index, iv_drugs  # noqa: E402

CARD = {"fields": {"iv_push": {"status": "stated", "value": "No", "quotes": [{"section": "Dosage", "text": "q"}]}}}


def iv_row(**over):
    row = {
        "slug": "vancomycin", "generic_name": "Vancomycin", "brand_names": ["Tyzavan"], "drug_class": ["Glycopeptide Antibacterial"],
        "routes": ["Intravenous"], "dea_schedule": None, "rxcuis": ["11124"], "spl_set_id": "set-1", "label_type": "generic",
        "label_brand": "Vancomycin", "label_maker": "Maker", "label_presentation": "vial", "label_version": 5,
        "label_date": date(2025, 8, 18), "strengths": [{"strength": "1 g", "form": "powder", "makers": 5}],
        "product_count": 56, "maker_count": 24, "card": CARD, "card_status": "approved", "card_label_version": 5,
        "card_reviewed_by": "pharmacist@example.com", "card_reviewed_at": datetime(2026, 9, 20, tzinfo=timezone.utc),
        "meta_title": None, "meta_description": None, "updated_at": datetime(2026, 9, 20, tzinfo=timezone.utc),
    }  # fmt: skip
    row.update(over)
    return SimpleNamespace(_mapping=row)


class FakeConn:
    """Answers each query by a word it contains; records every SQL statement it was given."""

    def __init__(self, answers, log):
        self.answers, self.log = answers, log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        sql = str(statement)
        self.log.append(sql)
        for word, rows in self.answers:
            if word in sql:
                return SimpleNamespace(fetchone=lambda: rows[0] if rows else None, fetchall=lambda: rows, scalar=lambda: rows[0] if rows else None)
        raise AssertionError("unexpected query: " + sql[:80])


def make_client(answers):
    log = []
    engine = SimpleNamespace(connect=lambda: FakeConn(answers, log), begin=lambda: FakeConn(answers, log))
    app = FastAPI()
    app.include_router(iv_drugs.router)
    app.include_router(drug_index.router)
    return TestClient(app), engine, log


@pytest.fixture
def get():
    def _get(url, answers):
        client, engine, log = make_client(answers)
        with patch.object(database, "db_engine", engine):
            response = client.get(url)
        return response, log

    return _get


DETAIL_EXTRAS = [("medication_guide", [(True, True, False, False, False)]), ("rxcui_to_ingredient", [("Vancocin", 1)])]


def test_approved_card_is_returned_with_reviewer_and_label_pages(get):
    response, log = get("/api/iv/vancomycin", [("FROM public.iv_drugs", [iv_row()])] + DETAIL_EXTRAS)
    body = response.json()
    assert response.status_code == 200
    assert body["card"]["fields"] == CARD["fields"] and body["card"]["reviewed_by"] == "pharmacist@example.com"
    assert body["card"]["label_updated_since"] is False
    assert body["label_pages"] == {
        "has_professional": True, "has_dosage": True, "has_adverse_reactions": False, "has_medguide": False, "has_boxed_warning": False,
    }  # fmt: skip
    assert body["pill_drugs"] == [{"name": "Vancocin", "pill_count": 1}]
    assert body["label"]["source_url"].endswith("setid=set-1")
    assert "deleted_at IS NULL AND published" in log[0]


@pytest.mark.parametrize("status", ["none", "draft", "rejected"])
def test_a_card_that_is_not_approved_never_leaves_the_api(get, status):
    response, _ = get("/api/iv/vancomycin", [("FROM public.iv_drugs", [iv_row(card_status=status)])] + DETAIL_EXTRAS)
    assert response.status_code == 200
    assert response.json()["card"] is None


def test_card_says_when_the_label_was_updated_after_approval(get):
    response, _ = get("/api/iv/vancomycin", [("FROM public.iv_drugs", [iv_row(label_version=6)])] + DETAIL_EXTRAS)
    assert response.json()["card"]["label_updated_since"] is True


def test_unknown_or_unpublished_drug_is_404_and_bad_slug_is_rejected(get):
    assert get("/api/iv/nothing", [("FROM public.iv_drugs", [])])[0].status_code == 404
    assert get("/api/iv/Bad_Slug", [])[0].status_code == 422


def test_list_filters_by_letter_and_only_published(get):
    rows = [("vancomycin", "Vancomycin", ["Tyzavan"], ["Glycopeptide Antibacterial"], False)]
    response, log = get("/api/iv?letter=v", [("COUNT(*)", [1]), ("FROM public.iv_drugs", rows)])
    assert response.json()["results"] == [
        {"slug": "vancomycin", "name": "Vancomycin", "brand_names": ["Tyzavan"], "drug_class": ["Glycopeptide Antibacterial"], "has_card": False}
    ]
    assert all("deleted_at IS NULL AND published" in sql and "LIKE :prefix" in sql for sql in log)
    assert get("/api/iv?letter=vv", [])[0].status_code == 422


def test_drug_index_merges_pills_and_iv_names(get):
    entries = [("vancocin", "Vancocin", 1, None), ("vancomycin", "Vancomycin", 4, "vancomycin"), ("vasostrict", "Vasostrict", None, "vasopressin")]
    counts = [("v", "va", 3), ("a", None, 10)]
    response, log = get(
        "/api/drug-index?prefix=va",
        [("drug_summary_state", [False]), ("FULL OUTER JOIN", entries), ("GROUP BY", counts)],
    )
    body = response.json()
    assert body["entries"] == [
        {"name": "Vancocin", "pill_count": 1, "iv_slug": None},
        {"name": "Vancomycin", "pill_count": 4, "iv_slug": "vancomycin"},
        {"name": "Vasostrict", "pill_count": 0, "iv_slug": "vasopressin"},
    ]
    assert body["letters"] == {"a": 10, "v": 3} and body["pairs"] == {"va": 3}
    assert all("published" in sql for sql in log if "iv_drugs" in sql)
    assert get("/api/drug-index?prefix=abc", [])[0].status_code == 422
