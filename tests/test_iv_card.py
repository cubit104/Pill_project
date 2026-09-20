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


def test_prompt_asks_for_shorthand_and_keeps_routine_label_text_off_the_card():
    prompt = iv_card.build_prompt("Heparin", SECTIONS)
    assert "q4h" in prompt and "Telegraphic" in prompt
    assert "inspect visually" in prompt and "discard unused portion" in prompt  # named so the AI leaves them out
    assert 'ONLY for "mixing"' in prompt and "Anything else is not_stated" in prompt
