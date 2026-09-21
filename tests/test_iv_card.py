"""IV administration card: label text extraction, the quote check, the AI call and the admin approval rule."""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services import iv_card  # noqa: E402

LABEL_XML = b"""<?xml version="1.0"?>
<document xmlns="urn:hl7-org:v3"><component><structuredBody>
 <component><section><code code="34068-7"/><title>2 DOSAGE AND ADMINISTRATION</title>
  <text><paragraph>Administer over a period of at least 60 minutes. Do not give as a rapid bolus.</paragraph>
        <paragraph>Reconstitute the 1 g vial with 20 mL of Sterile Water for Injection.</paragraph></text></section></component>
 <component><section><code code="42229-5"/><title>COMPATIBILITY AND STABILITY</title>
  <text><paragraph>After reconstitution, vials may be stored in a refrigerator for 14 days.</paragraph></text></section></component>
 <component><section><code code="43685-7"/><title>5 WARNINGS</title>
  <text><paragraph>Rapid intravenous administration may be associated with hypotension and, rarely, cardiac arrest.</paragraph>
        <paragraph>Nephrotoxicity has been reported in patients receiving this drug for a long time at high doses.</paragraph></text></section></component>
 <component><section><code code="34067-9"/><title>1 INDICATIONS</title><text><paragraph>Treatment of infections.</paragraph></text></section></component>
</structuredBody></component></document>"""

SECTIONS = iv_card.label_sections(LABEL_XML)


def field(status="stated", value="At least 60 minutes", quote="Administer over a period of at least 60 minutes."):
    return {"status": status, "value": value, "quotes": [{"section": "Dosage and administration", "text": quote}] if quote else []}


def test_label_sections_keep_only_text_about_giving_the_drug():
    names = [s["name"] for s in SECTIONS]
    assert names == ["Dosage and administration", "Compatibility And Stability", "Warnings (only lines about giving the drug)"]
    warnings = SECTIONS[-1]["text"]
    assert "Rapid intravenous administration" in warnings and "Nephrotoxicity" not in warnings
    assert not any("Treatment of infections" in s["text"] for s in SECTIONS)


def test_quote_found_word_for_word_survives_ignoring_case_and_whitespace():
    checked = iv_card.verify_card({"infusion": field(quote="administer over a  period of\nAT LEAST 60 minutes.")}, SECTIONS)
    assert checked["fields"]["infusion"]["status"] == "stated"
    assert checked["rejected"] == []
    assert set(checked["fields"]) == set(iv_card.CARD_FIELDS)
    assert checked["fields"]["special_handling"] == {"status": "not_stated", "value": "", "quotes": []}


@pytest.mark.parametrize(
    "bad",
    [
        field(quote="Administer over a period of at least 30 minutes."),  # a changed number
        field(quote="Infuse slowly over one hour to avoid reactions."),  # not in the label at all
        field(quote=None),  # a fact with no quote
        field(quote="at least 60 minutes"),  # too short to be a checkable quote
        field(value="x" * 171),  # a value that is an essay, not a glance
    ],
)
def test_invented_or_unsupported_fact_is_thrown_away(bad):
    checked = iv_card.verify_card({"infusion": bad}, SECTIONS)
    assert checked["fields"]["infusion"] == {"status": "not_stated", "value": "", "quotes": []}
    assert checked["rejected"] == ["infusion"]


def test_one_bad_quote_is_dropped_but_a_good_one_keeps_the_fact():
    mixed = field()
    mixed["quotes"].append({"section": "x", "text": "This sentence was never printed in the label text."})
    checked = iv_card.verify_card({"infusion": mixed}, SECTIONS)
    assert checked["fields"]["infusion"]["status"] == "stated"
    assert len(checked["fields"]["infusion"]["quotes"]) == 1 and checked["quotes_checked"] == 2


def test_prompt_carries_the_label_text_and_every_question():
    prompt = iv_card.build_prompt("Vancomycin", SECTIONS)
    assert "at least 60 minutes" in prompt and "Vancomycin" in prompt
    assert all(f'"{key}"' in prompt for key in iv_card.CARD_FIELDS) and "all 6 keys" in prompt


def ai_response(payload, status=200):
    import json

    body = {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    return SimpleNamespace(status_code=status, json=lambda: body, text="")


def test_draft_card_runs_the_ai_reply_through_the_quote_check():
    reply = {
        "fields": {"infusion": field(), "iv_push": field(value="Allowed over 1 minute", quote="May be given as a rapid push over one minute.")},
        "notes_for_reviewer": "ok",
    }
    with patch.object(iv_card, "fetch_label_sections", return_value=SECTIONS), patch.object(iv_card, "api_key", return_value="k"), patch.object(
        iv_card.requests, "post", return_value=ai_response(reply)
    ) as post:
        card = iv_card.draft_card("Vancomycin", "set-1")
    assert card["fields"]["infusion"]["status"] == "stated"
    assert card["fields"]["iv_push"]["status"] == "not_stated" and card["rejected_by_check"] == ["iv_push"]
    assert card["label_setid"] == "set-1" and card["source"] == iv_card.DEFAULT_MODEL
    assert post.call_args.kwargs["headers"] == {"x-goog-api-key": "k"} and "key=" not in post.call_args.args[0]


def test_no_key_or_a_bad_reply_is_a_clear_error():
    with patch.object(iv_card, "api_key", return_value=""):
        with pytest.raises(iv_card.CardError, match="GEMINI_API_KEY"):
            iv_card.ask_ai("p")
    with patch.object(iv_card, "api_key", return_value="k"), patch.object(iv_card.requests, "post", return_value=ai_response({}, status=500)):
        with pytest.raises(iv_card.CardError, match="500"):
            iv_card.ask_ai("p")
    with patch.object(iv_card, "api_key", return_value="k"), patch.object(iv_card.requests, "post", return_value=ai_response({"nope": 1})):
        with pytest.raises(iv_card.CardError, match="no card"):
            iv_card.ask_ai("p")


# ---- admin approval -------------------------------------------------------------------------------


class FakeConn:
    def __init__(self, row, log):
        self.row, self.log = row, log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        sql = str(statement)
        self.log.append((sql, params))
        return SimpleNamespace(fetchone=lambda: SimpleNamespace(_mapping=self.row), fetchall=lambda: [], scalar=lambda: 0)


def admin_client(row, role="reviewer"):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import database
    from routes.admin import auth
    from routes.admin import iv_drugs as admin_iv

    log = []
    engine = SimpleNamespace(connect=lambda: FakeConn(row, log), begin=lambda: FakeConn(row, log))
    app = FastAPI()
    app.include_router(admin_iv.router)
    app.dependency_overrides[auth.get_admin_user] = lambda: {"id": str(uuid.uuid4()), "email": "rph@example.com", "role": role}
    return TestClient(app), patch.object(database, "db_engine", engine), patch.object(admin_iv, "log_audit"), log


def drug_row(**over):
    row = {"id": "x", "generic_name": "Vancomycin", "spl_set_id": "set-1", "label_version": 5, "card_status": "draft",
           "card": {"fields": {"infusion": field()}}, "other_setids": ["set-2"]}  # fmt: skip
    row.update(over)
    return row


def test_approve_stores_the_reviewer_and_makes_the_card_public():
    client, engine, audit, log = admin_client(drug_row())
    with engine, audit, patch.object(iv_card, "fetch_label_sections", return_value=SECTIONS):
        response = client.post(f"/api/admin/iv/drugs/{uuid.uuid4()}/card/approve")
    assert response.status_code == 200
    update = next(params for sql, params in log if "UPDATE public.iv_drugs" in sql)
    assert update["status"] == "approved" and update["by"] == "rph@example.com" and update["label_version"] == 5


def test_a_card_that_changed_while_it_was_being_checked_is_not_approved():
    """Another reviewer saved an edit during the quote check: approving would publish the older text."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import database
    from routes.admin import auth
    from routes.admin import iv_drugs as admin_iv

    checked = drug_row()
    edited = drug_row(card={"fields": {"infusion": field(value="At least 90 minutes")}})
    log = []

    class Conn(FakeConn):
        def execute(self, statement, params=None):
            sql = str(statement)
            self.log.append((sql, params))
            row = edited if "FOR UPDATE" in sql else checked  # what is there once the row is locked
            return SimpleNamespace(fetchone=lambda: SimpleNamespace(_mapping=row), fetchall=lambda: [], scalar=lambda: 0)

    engine = SimpleNamespace(connect=lambda: Conn(None, log), begin=lambda: Conn(None, log))
    app = FastAPI()
    app.include_router(admin_iv.router)
    app.dependency_overrides[auth.get_admin_user] = lambda: {"id": str(uuid.uuid4()), "email": "rph@example.com", "role": "reviewer"}
    with patch.object(database, "db_engine", engine), patch.object(admin_iv, "log_audit") as audit, \
            patch.object(iv_card, "fetch_label_sections", return_value=SECTIONS):
        response = TestClient(app).post(f"/api/admin/iv/drugs/{uuid.uuid4()}/card/approve")
    assert response.status_code == 409 and "changed while it was being checked" in response.json()["detail"]
    assert not any("UPDATE public.iv_drugs" in sql for sql, _ in log)  # nothing approved, nothing overwritten
    audit.assert_not_called()


def test_approve_refuses_when_the_quote_check_removes_a_fact():
    tampered = drug_row(card={"fields": {"infusion": field(value="Over 30 minutes", quote="Administer over a period of at least 30 minutes.")}})
    client, engine, audit, log = admin_client(tampered)
    with engine, audit, patch.object(iv_card, "fetch_label_sections", return_value=SECTIONS):
        response = client.post(f"/api/admin/iv/drugs/{uuid.uuid4()}/card/approve")
    assert response.status_code == 409 and "infusion" in response.json()["detail"]
    sql, update = next((sql, params) for sql, params in log if "UPDATE public.iv_drugs" in sql)
    assert update["status"] == "draft"
    # an earlier decision must not stay attached to a draft nobody has reviewed
    assert "card_reviewed_by = NULL" in sql and "card_reviewed_at = NULL" in sql


def test_approved_card_cannot_be_regenerated_and_reviewers_cannot_publish():
    client, engine, audit, _ = admin_client(drug_row(card_status="approved"), role="editor")
    with engine, audit:
        assert client.post(f"/api/admin/iv/drugs/{uuid.uuid4()}/card/generate").status_code == 409
    client, engine, audit, _ = admin_client(drug_row())
    with engine, audit:
        assert client.put(f"/api/admin/iv/drugs/{uuid.uuid4()}/published", json={"published": True}).status_code == 403
        assert client.post(f"/api/admin/iv/drugs/{uuid.uuid4()}/card/generate").status_code == 403


def test_card_is_six_answers_and_keeps_at_most_three_quotes_each():
    assert list(iv_card.CARD_FIELDS) == ["iv_push", "infusion", "mixing", "special_handling", "storage", "monitoring"]
    assert iv_card.CARD_LABELS["monitoring"] == "Watch" and set(iv_card.CARD_QUESTIONS) == set(iv_card.CARD_FIELDS)
    many = field()
    many["quotes"] = [many["quotes"][0]] * 5
    checked = iv_card.verify_card({"infusion": many}, SECTIONS)
    assert len(checked["fields"]["infusion"]["quotes"]) == iv_card.MAX_QUOTES and checked["quotes_checked"] == iv_card.MAX_QUOTES


def test_the_ai_is_asked_for_a_little_less_than_the_check_accepts():
    assert iv_card.VALUE_ASK < iv_card.VALUE_MAX
    assert f"never more than {iv_card.VALUE_ASK}" in iv_card.build_prompt("Vancomycin", SECTIONS)
    just_over_the_ask = field(value="x" * (iv_card.VALUE_ASK + 5))
    assert iv_card.verify_card({"infusion": just_over_the_ask}, SECTIONS)["rejected"] == []


def test_not_applicable_answer_survives_the_check_with_its_quote():
    ready = field(status="not_applicable", value="Ready to use", quote="Reconstitute the 1 g vial with 20 mL of Sterile Water for Injection.")
    checked = iv_card.verify_card({"mixing": ready}, SECTIONS)
    assert checked["fields"]["mixing"]["status"] == "not_applicable" and checked["fields"]["mixing"]["value"] == "Ready to use"
    # only Mixing may say so: on any other answer it is thrown out, and the reviewer is told
    elsewhere = iv_card.verify_card({"storage": ready}, SECTIONS)
    assert elsewhere["fields"]["storage"] == {"status": "not_stated", "value": "", "quotes": []} and elsewhere["rejected"] == ["storage"]


def test_a_drug_that_is_not_given_iv_is_asked_where_and_how_to_inject_instead_of_push_and_infusion():
    shot = iv_card.build_prompt("Tirzepatide", SECTIONS, intravenous=False)
    assert "injection glance card" in shot and "Injection site(s) the label names" in shot and "Do not answer about IV push or infusion" in shot
    assert "direct IV push" not in shot and "Usual infusion time" not in shot and "Adult intravenous use only" not in shot
    # the keys are the same six, so stored cards and the quote check are unchanged
    assert list(iv_card.card_fields(False)) == list(iv_card.CARD_FIELDS) and iv_card.card_fields(False)["iv_push"][0] == "Where to inject"
    assert iv_card.card_fields(False)["mixing"] == iv_card.CARD_FIELDS["mixing"]
    iv = iv_card.build_prompt("Heparin", SECTIONS)
    assert "bedside IV glance card" in iv and "direct IV push" in iv and "Adult intravenous use only" in iv


def test_prompt_asks_for_shorthand_and_keeps_routine_label_text_off_the_card():
    prompt = iv_card.build_prompt("Heparin", SECTIONS)
    assert "q4h" in prompt and "Telegraphic" in prompt
    assert "inspect visually" in prompt and "discard unused portion" in prompt  # named so the AI leaves them out
    assert 'ONLY for "mixing"' in prompt and "Anything else is not_stated" in prompt


def test_publishing_pings_indexnow_for_the_drug_page_and_unpublishing_does_not():
    from routes.admin import iv_drugs as admin_iv

    client, engine, audit, _ = admin_client(drug_row(slug="heparin"), role="editor")
    url = f"/api/admin/iv/drugs/{uuid.uuid4()}/published"
    with engine, audit, patch.object(admin_iv, "submit_iv_slug_to_indexnow") as ping:
        with patch.object(admin_iv, "can_submit_pill_slug_to_indexnow", return_value=True):
            published = client.put(url, json={"published": True})
            assert published.status_code == 200 and published.json()["indexnow_queued"] is True  # the admin shows a notice
            ping.assert_called_once_with("heparin")
            ping.reset_mock()
            hidden = client.put(url, json={"published": False})
            assert hidden.status_code == 200 and "indexnow_queued" not in hidden.json()
            ping.assert_not_called()
        # no IndexNow key on this server: publishing still works, nothing is queued or claimed
        with patch.object(admin_iv, "can_submit_pill_slug_to_indexnow", return_value=False):
            quiet = client.put(url, json={"published": True})
            assert quiet.status_code == 200 and "indexnow_queued" not in quiet.json()
            ping.assert_not_called()


def test_staff_preview_shows_a_hidden_drug_with_its_draft_card():
    from routes import iv_drugs as public_iv

    row = {
        "slug": "heparin", "generic_name": "Heparin", "brand_names": [], "drug_class": [], "routes": ["Intravenous"], "dea_schedule": None,
        "rxcuis": [], "spl_set_id": "set-1", "label_type": "generic", "label_brand": "Heparin", "label_maker": "Maker",
        "label_presentation": "vial", "label_version": 6, "label_date": None, "strengths": [], "product_count": 1, "maker_count": 1,
        "card": {"fields": {"infusion": field()}}, "card_status": "draft", "card_label_version": 6, "card_reviewed_at": None,
        "meta_title": None, "meta_description": None, "updated_at": None, "published": False,
    }  # fmt: skip
    client, engine, audit, log = admin_client(row)
    with engine, audit, patch.object(public_iv, "_label_pages", return_value={}), patch.object(public_iv, "_pill_drugs", return_value=[]):
        response = client.get(f"/api/admin/iv/drugs/{uuid.uuid4()}/preview")
    body = response.json()
    assert response.status_code == 200
    assert body["card"]["fields"]["infusion"]["value"] == "At least 60 minutes"  # a draft, visible to staff only
    assert body["card_status"] == "draft" and body["published"] is False
    # the preview never filters on published, and it is behind the admin login like every /api/admin route
    assert "AND published" not in log[0][0] and "deleted_at IS NULL" in log[0][0]
    # the public builder, asked the public way, keeps the same draft back
    from types import SimpleNamespace as NS

    with patch.object(public_iv, "_label_pages", return_value={}), patch.object(public_iv, "_pill_drugs", return_value=[]):
        assert public_iv.drug_page_payload(NS(), row)["card"] is None


def test_indexnow_gets_only_the_iv_drug_page_and_a_failed_ping_never_raises():
    from routes.admin import indexnow as admin_indexnow
    from services.indexnow import build_iv_page_urls, load_indexnow_config

    config = load_indexnow_config({"INDEXNOW_KEY": "k", "SITE_URL": "https://pillseek.com"})
    # the label pages are noindex, so they are not announced
    assert build_iv_page_urls("heparin", config) == ["https://pillseek.com/iv/heparin"]
    assert build_iv_page_urls("  ", config) == []
    with patch.object(admin_indexnow, "load_indexnow_config", return_value=config),             patch.object(admin_indexnow, "submit_indexnow_urls", side_effect=RuntimeError("network down")) as submit:
        admin_indexnow.submit_iv_slug_to_indexnow("heparin")  # must not raise
    assert submit.call_args.args[0] == ["https://pillseek.com/iv/heparin"]


def test_next_draft_follows_the_review_list_order_and_skips_the_open_drug():
    client, engine, audit, log = admin_client(drug_row(maker_count=5, generic_name="Heparin"))
    with engine, audit:
        response = client.get(f"/api/admin/iv/drugs/{uuid.uuid4()}/next-draft")
    assert response.status_code == 200 and set(response.json()) == {"next", "drafts"}
    sql, params = next((s, p) for s, p in log if "card_status = 'draft' AND id <> :id" in s)
    assert "maker_count DESC, generic_name" in sql and (params["makers"], params["name"]) == (5, "Heparin")
