"""Draft review (one by one and grid): the "pronounced as" check and the endpoints."""
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
from services.draft_checks import pronunciation_problem  # noqa: E402

SUPER = {"id": "u-1", "email": "owner@test.com", "role": "superuser"}
REVIEWER = {"id": "u-2", "email": "team@test.com", "role": "reviewer"}
PILL = "11111111-1111-4111-8111-111111111111"
PILL2 = "22222222-2222-4222-8222-222222222222"
NOW = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)


# ---- the check ------------------------------------------------------------------------------------------------

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
        ("zestril", "ZES-tril"),
        ("deutetrabenazine", "doo-tet-ra-BEN-a-zeen"),
        ("warfarin sodium", "WAWR-fuh-rin SOH-dee-um"),
        ("cyclobenzaprine hydrochloride", "sye kloe ben' za preen"),
    ]:
        assert pronunciation_problem(name, said) is None, (name, said)


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
        "id": PILL, "medicine_name": "Lisinopril", "brand_names": None, "spl_strength": "10 mg",
        "splimprint": "M L 10", "splcolor_text": "PINK", "splshape_text": "ROUND", "splsize": "7", "dosage_form": "TABLET",
        "route": "ORAL", "ndc11": "00378-1234-01", "ndc9": "00378-1234", "rxcui": "314077", "author": "Mylan",
        "status_rx_otc": "Rx", "dea_schedule_name": "N/A", "slug": "lisinopril-10-mg", "published": False,
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
        pills = self.state["pills"]
        one, many = None, []
        if s.startswith("select p.*"):  # the queue
            many = [{**p, "flag_missing": None, "flag_at": None} for p in pills.values() if not p["published"]]
        elif s.startswith("select * from pillfinder where id = any"):  # grid cards
            many = [p for i, p in pills.items() if i in params["ids"]]
        elif s.startswith("select * from pillfinder"):
            one = _row(pills[params["id"]]) if params.get("id") in pills else None
        elif s.startswith("select ") and " from pillfinder where id" in s:
            cols = [c.strip() for c in s[len("select "):s.index(" from pillfinder")].split(",")]
            one = tuple(pills[params["id"]][c] for c in cols) if params.get("id") in pills else None
        elif s.startswith("select rxcui from drug_indications"):
            many = [(r,) for r in params["rxcuis"] if r in self.state.get("used_for", set())]
        elif "from drug_indications" in s:
            one = self.state.get("indication")
        elif s.startswith("select pronunciation_text from drug_pronunciations"):
            said = self.state.get("saved", {}).get(params["key"])
            one = (said,) if said is not None else None
        elif "from audit_log" in s:  # the latest confirmation of each name asked
            last = self.state.get("last_check")
            many = [(params["keys"][0], *last)] if last else []
        result.fetchone.return_value = one
        result.fetchall.return_value = many
        result.mappings.return_value.fetchall.return_value = many
        return result


@contextmanager
def _client(pills=None, admin=SUPER, **state):
    state = {"pills": pills or {PILL: _pill()}, "log": [], **state}
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
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
            with TestClient(app_module.app) as client:
                yield client, state
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


@contextmanager
def _saying(text, key="lisinopril", own_key="lisinopril"):
    """Every pill shows `text`, found under `key`, and keeps its own under `own_key`."""
    found = {"pronunciation_text": text, "audio_url": None, "source": "manual", "drug_name_matched": key}
    with patch.object(draft_review, "pill_pronunciations", side_effect=lambda conn, pills: [{"key": own_key, "found": found} for _ in pills]), \
         patch.object(draft_review, "pill_pronunciation_key", return_value=own_key):
        yield


def test_the_queue_lists_unpublished_pills_with_the_editors_score_and_used_for():
    pills = {PILL: _pill(), PILL2: _pill(id=PILL2, rxcui="999", brand_names="Zestril"), "x": _pill(id="x", published=True)}
    with _client(pills=pills, used_for={"314077"}) as (client, state):
        body = client.get("/api/admin/draft-review/queue").json()
    assert body["total"] == 2
    first, second = body["items"]
    assert first == {"id": PILL, "medicine_name": "Lisinopril", "strength": "10 mg", "imprint": "M L 10", "flagged": False,
                     "missing": [], "score": first["score"], "used_for": True}  # fmt: skip
    assert second["used_for"] is False
    assert 0 < first["score"] < second["score"] <= 100  # brand names filled in: one more field of the editor's score
    sql = next(s for s, _ in state["log"] if s.startswith("select p.*"))
    assert "published = false" in sql and "deleted_at is null" in sql and "order by lower(coalesce(p.medicine_name" in sql


def test_grid_cards_come_in_the_order_asked_with_photo_score_used_for_and_pronunciation():
    pills = {PILL: _pill(), PILL2: _pill(id=PILL2, medicine_name="Zestril", rxcui="104377", image_filename=None)}
    with _client(pills=pills, used_for={"314077"}) as (client, _), _saying("ZES-tril"):
        cards = client.get(f"/api/admin/draft-review/cards?ids={PILL2},{PILL}").json()["cards"]
    assert [c["id"] for c in cards] == [PILL2, PILL]
    assert cards[0]["photo"] is None and cards[1]["photo"] == f"{draft_review.IMAGE_BASE}/{PILL}/abc-1.avif"
    assert [c["used_for"] for c in cards] == [False, True]
    assert cards[1]["pronunciation"]["problem"] == "other_name" and cards[1]["imprint"] == "M L 10"
    assert cards[1]["updated_at"].startswith("2026-09-25") and cards[1]["published"] is False
    with _client() as (client, _):
        assert client.get("/api/admin/draft-review/cards?ids=nope").status_code == 422
        too_many = ",".join([PILL] * (draft_review.CARDS_MAX + 1))
        assert client.get(f"/api/admin/draft-review/cards?ids={too_many}").status_code == 422


def test_one_pill_comes_with_photo_score_used_for_and_a_pronunciation_problem():
    with _client(indication=("Lisinopril is used to treat high blood pressure.", "medlineplus", "https://medlineplus.gov/x"),
                 last_check=None) as (client, _), _saying("ZES-tril"):  # fmt: skip
        body = client.get(f"/api/admin/draft-review/{PILL}").json()
    assert body["pill"]["splimprint"] == "M L 10" and body["pill"]["updated_at"].startswith("2026-09-25")
    assert body["photos"] == [f"{draft_review.IMAGE_BASE}/{PILL}/abc-1.avif"]
    assert body["indication"]["source"] == "medlineplus" and isinstance(body["score"], int)
    assert body["pronunciation"]["problem"] == "other_name" and body["pronunciation"]["checked_by"] is None
    assert "photo_read" not in body  # nothing reads the photo: the publisher looks at it


def test_a_brand_pill_showing_the_generics_pronunciation_is_flagged_against_its_own_name():
    # Zestril has no pronunciation of its own yet, so it shows lisinopril's, which is not how "Zestril" sounds
    pills = {PILL: _pill(medicine_name="ZESTRIL", rxcui="104377")}
    with _client(pills=pills) as (client, _), _saying("lye-SIN-oh-pril", key="lisinopril", own_key="zestril"):
        said = client.get(f"/api/admin/draft-review/{PILL}").json()["pronunciation"]
    assert said["key"] == "zestril" and said["shown_from"] == "lisinopril" and said["problem"] == "other_name"


def test_a_confirmation_counts_only_for_the_text_that_was_confirmed():
    for last, expected in [(("owner@test.com", NOW, "lye-SIN-oh-pril"), "owner@test.com"), (("owner@test.com", NOW, "ZES-tril"), None)]:
        with _client(last_check=last) as (client, _), _saying("lye-SIN-oh-pril"):
            assert client.get(f"/api/admin/draft-review/{PILL}").json()["pronunciation"]["checked_by"] == expected


def test_publishing_is_refused_while_used_for_is_empty():
    with _client(indication=None) as (client, _), patch.object(draft_review.admin_pills, "update_pill") as update:
        resp = client.post(f"/api/admin/draft-review/{PILL}/publish", json={"updated_at": NOW.isoformat()})
    assert resp.status_code == 409 and "used for" in resp.json()["detail"]
    update.assert_not_called()
    with _client(pills={PILL: _pill(published=True)}) as (client, _):
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
    with _client(saved={"lisinopril": "lye-SIN-oh-pril"}) as (client, state), _saying("lye-SIN-oh-pril"):
        resp = client.post(f"/api/admin/draft-review/{PILL}/pronunciation", json={"pronunciation_text": " lye-SIN-oh-pril "})
    assert resp.status_code == 200 and resp.json()["changed"] is False
    sqls = [s for s, _ in state["log"]]
    assert not any(s.startswith("insert into drug_pronunciations") for s in sqls)
    assert any(s.startswith("update drug_pronunciations set needs_review = false") for s in sqls)
    check = next(p for s, p in state["log"] if "'pronunciation_checked'" in s)
    assert check["key"] == "lisinopril" and '"lye-SIN-oh-pril"' in check["diff"]


def test_fixing_pronounced_as_saves_it_under_the_pills_own_name_and_marks_it_checked():
    with _client(saved={"lisinopril": "ZES-tril"}) as (client, state), _saying("ZES-tril"):
        resp = client.post(f"/api/admin/draft-review/{PILL}/pronunciation", json={"pronunciation_text": "lye-SIN-oh-pril"})
    assert resp.status_code == 200 and resp.json()["changed"] is True
    upsert = next(p for s, p in state["log"] if s.startswith("insert into drug_pronunciations"))
    assert upsert == {"key": "lisinopril", "display": "Lisinopril", "said": "lye-SIN-oh-pril"}
    assert any(p.get("action") == "update_pronunciation" for _, p in state["log"])
    assert any("'pronunciation_checked'" in s for s, _ in state["log"])


def test_looks_right_on_a_brand_pill_showing_the_generics_text_copies_it_to_the_brand():
    pills = {PILL: _pill(medicine_name="ZESTRIL", rxcui="104377")}
    with _client(pills=pills, saved={"lisinopril": "lye-SIN-oh-pril"}) as (client, state), \
         _saying("lye-SIN-oh-pril", key="lisinopril", own_key="zestril"):
        resp = client.post(f"/api/admin/draft-review/{PILL}/pronunciation", json={"pronunciation_text": "ZES-tril"})
    assert resp.json()["changed"] is True
    upsert = next(p for s, p in state["log"] if s.startswith("insert into drug_pronunciations"))
    assert upsert == {"key": "zestril", "display": "ZESTRIL", "said": "ZES-tril"}  # lisinopril's row untouched


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
    with _client(pills={PILL: _pill(rxcui=None)}) as (client, _):
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
