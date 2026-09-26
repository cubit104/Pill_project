"""Draft review queue: the checks it runs (photo vs imprint, "pronounced as") and its endpoints."""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
import main as app_module  # noqa: E402
from routes.admin import draft_review  # noqa: E402
from routes.admin.auth import get_admin_user  # noqa: E402
from services import ai_reader  # noqa: E402
from services.draft_checks import compare_imprint, pronunciation_problem  # noqa: E402

SUPER = {"id": "u-1", "email": "owner@test.com", "role": "superuser"}
REVIEWER = {"id": "u-2", "email": "team@test.com", "role": "reviewer"}
PILL = "11111111-1111-4111-8111-111111111111"
NOW = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)


# ---- the checks ----------------------------------------------------------------------------------------------

def test_the_photo_matches_however_the_imprint_is_split_into_tokens_or_faces():
    assert compare_imprint("WATSON 3612", ["WATSON", "3612"]) == {"verdict": "match", "read": "WATSON / 3612"}
    assert compare_imprint("M366", ["M 366"])["verdict"] == "match"
    assert compare_imprint("S;10", ["10", "S"])["verdict"] == "match"
    assert compare_imprint("A;22;5;mg", ["A 22.5 MG"])["read"] == "A 22.5 MG"  # shown as read, dot kept


def test_a_misread_lookalike_is_close_one_face_is_partial_another_pill_is_a_mismatch():
    assert compare_imprint("S 10", ["S1O"])["verdict"] == "close"  # O for 0
    assert compare_imprint("B 52", ["8 52"])["verdict"] == "close"
    assert compare_imprint("WATSON 3612", ["3612"])["verdict"] == "partial"  # one face of two
    assert compare_imprint("M 366", ["L484"]) == {"verdict": "mismatch", "read": "L484"}
    assert compare_imprint("1", ["10"])["verdict"] != "match"
    assert compare_imprint("I 58", ["", ""]) == {"verdict": "unreadable", "read": ""}
    assert compare_imprint("", ["A 1"])["verdict"] == "no_imprint"


def test_pronounced_as_is_flagged_when_it_spells_out_another_name():
    # real rows from drug_pronunciations: the brand's pronunciation saved under the generic name
    assert pronunciation_problem("lisinopril", "ZES-tril") == "other_name"
    assert pronunciation_problem("fluoxetine", "PROH-zak") == "other_name"
    assert pronunciation_problem("tafamidis", "VIN-duh-kel") == "other_name"
    assert pronunciation_problem("diphenhydramine", "eye-byoo-PRO-fen") == "other_name"
    assert pronunciation_problem("amnesteem", "Syllables: am-ne-esteem  Breakdow") == "odd"
    assert pronunciation_problem("relacorilant", "pronunciation") == "odd"
    assert pronunciation_problem("trientine", "  ") == "missing"


def test_pronounced_as_passes_when_it_sounds_like_the_name_salt_or_not():
    for name, said in [
        ("tadalafil", "tuh-DAL-uh-fil"),
        ("letrozole", "let' roe zole"),
        ("metformin", "met-FOR-min HIGH-dro-klor-ide"),
        ("calcium carbonate", "KAL-see-um KAR-buh-nate"),
        ("xanax", "ZAN-aks"),
        ("deutetrabenazine", "doo-tet-ra-BEN-a-zeen"),
        ("warfarin sodium", "WAWR-fuh-rin SOH-dee-um"),
        ("cyclobenzaprine hydrochloride", "sye kloe ben' za preen"),
    ]:
        assert pronunciation_problem(name, said) is None, (name, said)


def test_the_catalogue_read_sends_one_photo_with_its_own_prompt(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    ok = MagicMock(status_code=200)
    ok.json.return_value = {"candidates": [{"content": {"parts": [{"text": '{"side1": "RP 200", "side2": "", "confidence": "high"}'}]}}]}
    with patch.object(ai_reader.requests, "post", return_value=ok) as post:
        out = ai_reader.read_catalog_photo(b"jpeg", "gemini-3.8-flash")
    assert out["side_reads"] == ["RP 200"]
    parts = post.call_args[1]["json"]["contents"][0]["parts"]
    assert parts[0]["text"] == ai_reader.CATALOG_PROMPT and len(parts) == 2
    monkeypatch.delenv("GEMINI_API_KEY")
    with patch.object(ai_reader.requests, "post") as post:
        assert ai_reader.read_catalog_photo(b"jpeg", "gemini-3.8-flash") is None
    post.assert_not_called()


# ---- endpoints -------------------------------------------------------------------------------------------------

class _Row(tuple):
    @property
    def _mapping(self):
        return self.cols


def _row(cols: dict):
    row = _Row(cols.values())
    row.cols = cols
    return row


def _pill(**over):
    pill = {
        "id": PILL, "medicine_name": "Lisinopril", "brand_names": "Zestril", "spl_strength": "10 mg",
        "splimprint": "M L 10", "splcolor_text": "PINK", "splshape_text": "ROUND", "splsize": "7", "dosage_form": "TABLET",
        "route": "ORAL", "ndc11": "00378-1234-01", "ndc9": "00378-1234", "rxcui": "314077", "author": "Mylan",
        "status_rx_otc": "Rx", "dea_schedule_name": None, "slug": "lisinopril-10-mg", "published": False,
        "image_filename": f"{PILL}/abc-1.avif", "updated_at": NOW, "has_image": "TRUE",
    }  # fmt: skip
    pill.update(over)
    return pill


class _Conn:
    def __init__(self, state):
        self.state = state
        self.log = state["log"]

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        s = " ".join(str(sql).lower().split())
        params = params or {}
        self.log.append((s, params))
        result = MagicMock()
        pill = self.state["pill"]
        one = None
        if s.startswith("select p.id::text"):
            result.fetchall.return_value = self.state.get("queue", [])
            return result
        if s.startswith("select * from pillfinder"):
            one = _row(pill) if pill else None
        elif s.startswith("select ") and " from pillfinder where id" in s:
            cols = [c.strip() for c in s[len("select "):s.index(" from pillfinder")].split(",")]
            one = tuple(pill[c] for c in cols) if pill else None
        elif "from drug_indications" in s:
            one = self.state.get("indication")
        elif "from pill_review_flags" in s:
            one = None
        elif "from audit_log" in s:
            one = self.state.get("last_check")
        result.fetchone.return_value = one
        return result


@contextmanager
def _client(pill=None, admin=SUPER, **state):
    state = {"pill": _pill() if pill is None else pill, "log": [], **state}
    conn = _Conn(state)
    engine = MagicMock()

    @contextmanager
    def cm():
        yield conn

    engine.connect.side_effect = cm
    engine.begin.side_effect = cm
    app_module.app.dependency_overrides[get_admin_user] = lambda: admin
    original = database.db_engine
    database.db_engine = engine
    draft_review._reads.clear()
    draft_review._spent.clear()
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None), \
             patch.object(draft_review, "read_flags", return_value={"ai_reader_model": "gemini-3.8-flash"}):
            with TestClient(app_module.app) as client:
                yield client, state
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


def test_the_queue_lists_unpublished_pills_in_review_order():
    queue = [(PILL, "Lisinopril", "10 mg", "M L 10", ["imprint"], NOW)]
    with _client(queue=queue) as (client, state):
        body = client.get("/api/admin/draft-review/queue").json()
    assert body == {"total": 1, "items": [{"id": PILL, "medicine_name": "Lisinopril", "strength": "10 mg", "imprint": "M L 10", "flagged": True, "missing": ["imprint"]}]}
    sql = next(s for s, _ in state["log"] if s.startswith("select p.id::text"))
    assert "published = false" in sql and "deleted_at is null" in sql and "order by lower(coalesce(p.medicine_name" in sql


def test_one_pill_comes_with_photo_used_for_pronunciation_and_its_problem():
    said = {"pronunciation_text": "ZES-tril", "audio_url": None, "source": "manual", "drug_name_matched": "lisinopril"}
    with _client(indication=("Lisinopril is used to treat high blood pressure.", "medlineplus", "https://medlineplus.gov/x"),
                 last_check=None) as (client, _), patch.object(draft_review, "get_pronunciation", return_value=said):
        body = client.get(f"/api/admin/draft-review/{PILL}").json()
    assert body["pill"]["splimprint"] == "M L 10" and body["pill"]["updated_at"].startswith("2026-09-25")
    assert body["photos"] == [f"{draft_review.IMAGE_BASE}/{PILL}/abc-1.avif"]
    assert body["indication"]["source"] == "medlineplus"
    assert body["pronunciation"]["problem"] == "other_name" and body["pronunciation"]["checked_by"] is None
    assert body["photo_read"] is None  # nothing is read (or paid for) just by opening a pill


def test_a_confirmation_counts_only_for_the_text_that_was_confirmed():
    said = {"pronunciation_text": "lye-SIN-oh-pril", "audio_url": None, "source": "manual", "drug_name_matched": "lisinopril"}
    for last, expected in [(("owner@test.com", NOW, "lye-SIN-oh-pril"), "owner@test.com"), (("owner@test.com", NOW, "ZES-tril"), None)]:
        with _client(last_check=last) as (client, _), patch.object(draft_review, "get_pronunciation", return_value=said):
            assert client.get(f"/api/admin/draft-review/{PILL}").json()["pronunciation"]["checked_by"] == expected


def test_the_photo_is_read_once_and_compared_with_the_typed_imprint(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    reply = {"tokens": ["M", "L", "10"], "side_reads": ["M L", "10"], "confidence": "high", "cost_micros": 1500}
    with _client() as (client, _), patch.object(draft_review, "_photo_jpeg", return_value=b"jpeg") as fetched, \
         patch.object(draft_review.ai_reader, "read_catalog_photo", return_value=reply) as read:
        first = client.post(f"/api/admin/draft-review/{PILL}/read-photo").json()
        again = client.post(f"/api/admin/draft-review/{PILL}/read-photo").json()
        shown = client.get(f"/api/admin/draft-review/{PILL}").json()["photo_read"]
    assert first == again == shown == {"verdict": "match", "read": "M L / 10", "confidence": "high", "model": "gemini-3.8-flash"}
    assert read.call_count == 1 and fetched.call_args[0][0] == f"{PILL}/abc-1.avif"


def test_a_different_photo_is_a_mismatch(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    reply = {"tokens": ["L484"], "side_reads": ["L484"], "confidence": "high", "cost_micros": 1500}
    with _client() as (client, _), patch.object(draft_review, "_photo_jpeg", return_value=b"jpeg"), \
         patch.object(draft_review.ai_reader, "read_catalog_photo", return_value=reply):
        assert client.post(f"/api/admin/draft-review/{PILL}/read-photo").json()["verdict"] == "mismatch"


def test_photo_reads_stop_without_a_key_without_a_photo_and_at_the_daily_cap(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with _client() as (client, _):
        assert client.post(f"/api/admin/draft-review/{PILL}/read-photo").status_code == 503
    with _client(pill=_pill(image_filename=None)) as (client, _):
        assert client.post(f"/api/admin/draft-review/{PILL}/read-photo").status_code == 409
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    with _client() as (client, _), patch.object(draft_review, "REVIEW_READS_PER_DAY", 0), \
         patch.object(draft_review.ai_reader, "read_catalog_photo") as read:
        assert client.post(f"/api/admin/draft-review/{PILL}/read-photo").status_code == 429
    read.assert_not_called()


def test_publishing_is_refused_while_used_for_is_empty():
    with _client(indication=None) as (client, _), patch.object(draft_review.admin_pills, "update_pill") as update:
        resp = client.post(f"/api/admin/draft-review/{PILL}/publish", json={"updated_at": NOW.isoformat()})
    assert resp.status_code == 409 and "used for" in resp.json()["detail"]
    update.assert_not_called()
    with _client(pill=_pill(published=True)) as (client, _):
        assert client.post(f"/api/admin/draft-review/{PILL}/publish", json={}).status_code == 409


def test_publishing_runs_the_editors_save_and_publish():
    with _client(indication=("Used for high blood pressure.", "manual", None)) as (client, _), \
         patch.object(draft_review.admin_pills, "update_pill", return_value={"updated": True, "warnings": []}) as update:
        resp = client.post(f"/api/admin/draft-review/{PILL}/publish", json={"updated_at": "2026-09-25T09:00:00+00:00"})
    assert resp.status_code == 200 and resp.json()["published"] is True
    args, kwargs = update.call_args
    assert args[1] == PILL and args[2].updated_at == "2026-09-25T09:00:00+00:00" and kwargs["publish"] is True


def test_a_reviewer_can_check_but_not_publish():
    with _client(admin=REVIEWER, indication=("Used for pain.", "manual", None)) as (client, _):
        assert client.post(f"/api/admin/draft-review/{PILL}/publish", json={}).status_code == 403
        assert client.get("/api/admin/draft-review/queue").status_code == 200


def test_confirming_pronounced_as_marks_it_checked_without_rewriting_it():
    said = {"pronunciation_text": "lye-SIN-oh-pril", "audio_url": None, "source": "manual", "drug_name_matched": "lisinopril"}
    with _client() as (client, state), patch.object(draft_review, "get_pronunciation", return_value=said):
        resp = client.post(f"/api/admin/draft-review/{PILL}/pronunciation", json={"pronunciation_text": " lye-SIN-oh-pril "})
    assert resp.status_code == 200 and resp.json()["changed"] is False
    sqls = [s for s, _ in state["log"]]
    assert not any(s.startswith("insert into drug_pronunciations") for s in sqls)
    assert any(s.startswith("update drug_pronunciations set needs_review = false") for s in sqls)
    check = next(p for s, p in state["log"] if "'pronunciation_checked'" in s)
    assert check["key"] == "lisinopril" and '"lye-SIN-oh-pril"' in check["diff"]


def test_fixing_pronounced_as_saves_it_by_hand_and_marks_it_checked():
    wrong = {"pronunciation_text": "ZES-tril", "audio_url": None, "source": "manual", "drug_name_matched": "lisinopril"}
    with _client() as (client, state), patch.object(draft_review, "get_pronunciation", return_value=wrong), \
         patch.object(draft_review, "get_pronunciation_lookup_keys", return_value=["lisinopril", "zestril"]):
        resp = client.post(f"/api/admin/draft-review/{PILL}/pronunciation", json={"pronunciation_text": "lye-SIN-oh-pril"})
    assert resp.status_code == 200 and resp.json()["changed"] is True
    upsert = next(p for s, p in state["log"] if s.startswith("insert into drug_pronunciations"))
    assert upsert == {"key": "lisinopril", "display": "Lisinopril", "said": "lye-SIN-oh-pril"}
    assert any(p.get("action") == "update_pronunciation" for _, p in state["log"])
    assert any("'pronunciation_checked'" in s for s, _ in state["log"])


def test_used_for_from_medlineplus_is_credited_and_never_replaces_a_hand_written_one():
    page = {"rxcui": "314077", "title": "Lisinopril", "plain_text": "Lisinopril is used to treat high blood pressure.", "source_url": "https://medlineplus.gov/druginfo/meds/a692051.html"}
    with _client(indication=("Lisinopril is used to treat high blood pressure.", "medlineplus", page["source_url"])) as (client, _), \
         patch.object(draft_review, "fetch_by_rxcui", return_value=page), \
         patch.object(draft_review, "upsert_from_medlineplus", return_value="inserted") as upsert:
        resp = client.post(f"/api/admin/draft-review/{PILL}/indication/medlineplus")
    assert resp.status_code == 200 and resp.json()["indication"]["source"] == "medlineplus"
    assert upsert.call_args[0][1:] == ("314077", page)
    with _client() as (client, _), patch.object(draft_review, "fetch_by_rxcui", return_value=page), \
         patch.object(draft_review, "upsert_from_medlineplus", return_value="skipped_manual"):
        assert client.post(f"/api/admin/draft-review/{PILL}/indication/medlineplus").status_code == 409
    with _client() as (client, _), patch.object(draft_review, "fetch_by_rxcui", return_value=None):
        assert client.post(f"/api/admin/draft-review/{PILL}/indication/medlineplus").status_code == 404
    with _client(pill=_pill(rxcui=None)) as (client, _):
        assert client.post(f"/api/admin/draft-review/{PILL}/indication/medlineplus").status_code == 400


def test_the_fda_label_text_comes_without_its_heading_and_shortened():
    label = {"indications_text": "1 INDICATIONS AND USAGE Lisinopril tablets are indicated for the treatment of hypertension. " + "More text. " * 80}
    with _client() as (client, _), patch.object(draft_review, "get_pronunciation_lookup_keys", return_value=["lisinopril"]), \
         patch.object(draft_review, "fetch_indications_from_openfda", return_value=label):
        body = client.get(f"/api/admin/draft-review/{PILL}/indication/label").json()
    assert body["text"].startswith("Lisinopril tablets are indicated") and len(body["text"]) <= draft_review.LABEL_TEXT_LIMIT + 1
    assert body["searched"] == "lisinopril"
    with _client() as (client, _), patch.object(draft_review, "get_pronunciation_lookup_keys", return_value=["x"]), \
         patch.object(draft_review, "fetch_indications_from_openfda", return_value=None):
        assert client.get(f"/api/admin/draft-review/{PILL}/indication/label").status_code == 404
