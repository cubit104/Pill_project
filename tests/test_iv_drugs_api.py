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


# answers are tried in order, so the pill-names query (it also reads iv_drugs) has to come before the drug row
PILL_NAMES = ("JOIN public.drug_summary", [("Vancocin", 1)])
LABEL_PAGES = ("medication_guide", [(True, True, False, False, False)])


def test_approved_card_is_returned_with_label_pages_and_never_the_reviewers_email(get):
    response, log = get("/api/iv/vancomycin", [PILL_NAMES, ("FROM public.iv_drugs", [iv_row()]), LABEL_PAGES])
    body = response.json()
    assert response.status_code == 200
    assert body["card"]["fields"] == CARD["fields"] and body["card"]["reviewed_at"].startswith("2026-09-20")
    assert body["card"]["label_updated_since"] is False
    # the reviewer's staff email is for the admin only: not in the payload, and not even selected
    assert "pharmacist@example.com" not in response.text and "reviewed_by" not in response.text
    assert "card_reviewed_by" not in log[0]
    assert body["label_pages"] == {
        "has_professional": True, "has_dosage": True, "has_adverse_reactions": False, "has_medguide": False, "has_boxed_warning": False,
    }  # fmt: skip
    assert body["pill_drugs"] == [{"name": "Vancocin", "pill_count": 1}]
    assert body["label"]["source_url"].endswith("setid=set-1")
    assert "deleted_at IS NULL AND published" in log[0]


def test_page_gets_the_editors_meta_text_or_the_same_automatic_text_the_admin_shows(get):
    from services import iv_seo

    automatic, _ = get("/api/iv/vancomycin", [PILL_NAMES, ("FROM public.iv_drugs", [iv_row()]), LABEL_PAGES])
    body = automatic.json()
    assert body["meta_title"] == iv_seo.build_meta_title({"generic_name": "Vancomycin", "brand_names": ["Tyzavan"]})
    assert body["meta_title"] == "Vancomycin IV (Tyzavan): Infusion Rate, Mixing & Calculator" and "24 manufacturers" in body["meta_description"]

    typed, _ = get("/api/iv/vancomycin", [PILL_NAMES, ("FROM public.iv_drugs", [iv_row(meta_title="My title", meta_description="My text")]), LABEL_PAGES])
    assert (typed.json()["meta_title"], typed.json()["meta_description"]) == ("My title", "My text")


@pytest.mark.parametrize("status", ["none", "draft", "rejected"])
def test_a_card_that_is_not_approved_never_leaves_the_api(get, status):
    response, _ = get("/api/iv/vancomycin", [PILL_NAMES, ("FROM public.iv_drugs", [iv_row(card_status=status)]), LABEL_PAGES])
    assert response.status_code == 200
    assert response.json()["card"] is None


def test_card_says_when_the_label_was_updated_after_approval(get):
    response, _ = get("/api/iv/vancomycin", [PILL_NAMES, ("FROM public.iv_drugs", [iv_row(label_version=6)]), LABEL_PAGES])
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


def test_pill_drug_page_finds_its_iv_drug_by_name_never_by_ingredient(get):
    response, log = get("/api/iv/for-pill-drug?name=vancomycin-hydrochloride", [("JOIN public.iv_drugs", [("Vancomycin", "vancomycin")])])
    # reached its own route, not /api/iv/{slug}
    assert response.status_code == 200 and response.json() == {"results": [{"name": "Vancomycin", "slug": "vancomycin"}]}
    sql = log[0]
    assert "i.deleted_at IS NULL AND i.published" in sql
    # rxcui_to_ingredient keeps one ingredient per product: Percocet would pass for plain acetaminophen
    assert "rxcui" not in sql and "lower(i.generic_name) = ds.key" in sql and ":salt_words" in sql
    assert get("/api/iv/for-pill-drug?name=Bad Name", [])[0].status_code == 422


def test_salt_words_are_only_stripped_from_the_end_of_a_name():
    import re

    strip = lambda name: re.sub(iv_drugs.SALT_WORDS_RE, "", name)  # noqa: E731
    assert strip("diltiazem hydrochloride") == "diltiazem" and strip("labetalol hcl") == "labetalol"
    assert strip("azithromycin dihydrate") == "azithromycin" and strip("doxycycline hyclate") == "doxycycline"
    # a combination or a different product keeps its own name, so it never equals an IV generic name
    assert strip("acetaminophen and codeine phosphate") == "acetaminophen and codeine"
    assert strip("morphine sulfate extended release") == "morphine sulfate extended release"
    assert strip("sodium bicarbonate") == "sodium bicarbonate"


def test_sitemap_feed_says_which_drugs_have_a_card(get):
    rows = [("heparin", datetime(2026, 9, 20, tzinfo=timezone.utc), True, True, True, False)]
    response, log = get("/api/slugs/iv", [("FROM public.iv_drugs", rows)])
    assert response.json() == [
        {"slug": "heparin", "updated_at": "2026-09-20T00:00:00+00:00", "has_card": True, "has_professional": True,
         "has_dosage": True, "has_adverse_reactions": False}
    ]  # fmt: skip
    assert "i.deleted_at IS NULL AND i.published" in log[0]


def test_search_dropdown_gets_published_iv_drugs_by_generic_or_brand_name(get):
    rows = [("Heparin", "heparin", True, None), ("Norepinephrine", "norepinephrine", False, "Levophed")]
    response, log = get("/api/iv/suggest?q=He%25", [("FROM public.iv_drugs", rows)])
    # reached its own route, not /api/iv/{slug}; a brand match says which drug it is
    assert response.status_code == 200
    assert response.json() == [{"label": "Heparin", "slug": "heparin"}, {"label": "Levophed (Norepinephrine)", "slug": "norepinephrine"}]
    assert "deleted_at IS NULL AND published" in log[0]
    # too short to suggest anything: no query at all (the % the visitor typed is dropped, not used as a wildcard)
    short, short_log = get("/api/iv/suggest?q=h%25", [])
    assert short.json() == [] and short_log == []
