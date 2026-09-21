"""Admin tools for IV drugs: add by Set ID, edit details, manage the label. They write only to iv_drugs and the
shared label cache, never to pillfinder, and an IV drug only accepts a label that has an intravenous product."""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
from routes.admin import auth  # noqa: E402
from routes.admin import iv_manage  # noqa: E402
from services import iv_card, iv_seo  # noqa: E402

INJECTION = "8eccafe8-40c9-495a-872d-7f45a98ee759"
CAPSULES = "01234567-89ab-cdef-0123-456789abcdef"


def label_xml(route: str, form: str = "INJECTION, SOLUTION") -> bytes:
    return f"""<?xml version="1.0"?>
<document xmlns="urn:hl7-org:v3">
 <effectiveTime value="20250813"/><title>These highlights do not include all the information needed</title><versionNumber value="5"/>
 <author><assignedEntity><representedOrganization><name>Hikma Pharmaceuticals USA Inc.</name></representedOrganization></assignedEntity></author>
 <component><structuredBody><component><section><subject><manufacturedProduct><manufacturedProduct>
   <name>Vancomycin Hydrochloride</name><formCode code="C2" displayName="{form}"/></manufacturedProduct>
   <consumedIn><substanceAdministration><routeCode code="C1" displayName="{route}"/></substanceAdministration></consumedIn>
 </manufacturedProduct></subject></section></component></structuredBody></component>
</document>""".encode()


def test_label_facts_name_maker_version_date_and_routes():
    facts = iv_card.label_facts(label_xml("INTRAVENOUS"))
    assert facts == {
        "date": "2025-08-13", "title": "Vancomycin Hydrochloride", "maker": "Hikma Pharmaceuticals USA Inc.",
        "version": 5, "routes": ["INTRAVENOUS"], "is_intravenous": True, "is_injection": True, "has_pill_form": False,
    }  # fmt: skip
    oral = iv_card.label_facts(label_xml("ORAL", "CAPSULE"))
    assert (oral["is_intravenous"], oral["is_injection"], oral["has_pill_form"]) == (False, False, True)
    # a shot in the muscle or under the skin is an injection, just not an intravenous one
    for route in ("INTRAMUSCULAR", "SUBCUTANEOUS", "INTRAVENOUS DRIP", "INTRA-ARTICULAR", "INTRAOCULAR", "INTRACAVERNOSAL"):
        assert iv_card.label_facts(label_xml(route))["is_injection"] is True
    assert iv_card.label_facts(label_xml("INTRAMUSCULAR"))["is_intravenous"] is False
    for route in ("ORAL", "TOPICAL", "OPHTHALMIC", "NASAL", "RESPIRATORY (INHALATION)", "INTRAVESICAL"):
        assert iv_card.label_facts(label_xml(route))["is_injection"] is False


def test_meta_text_is_generated_like_the_pill_pages_and_fits_a_search_result():
    row = {"generic_name": "Vancomycin", "brand_names": ["Tyzavan"], "maker_count": 24}
    assert iv_seo.build_meta_title(row) == "Vancomycin IV (Tyzavan): Infusion Rate, Mixing & Calculator"
    assert "24 manufacturers" in iv_seo.build_meta_description(row) and len(iv_seo.build_meta_description(row)) <= 160
    long_name = {"generic_name": "Sulfamethoxazole and Trimethoprim with Extra Long Name", "brand_names": ["Bactrim"], "maker_count": 1}
    assert len(iv_seo.build_meta_title(long_name)) <= 65 and len(iv_seo.build_meta_description(long_name)) <= 160
    assert iv_seo.build_meta_title({"generic_name": ""}) == ""
    # no brand: room for the whole tail; nothing the page does not have ("FDA label", uses, price) is promised
    assert iv_seo.build_meta_title({"generic_name": "Heparin"}) == "Heparin IV: Infusion Rate, Mixing, Calculator & Shortage"
    assert "FDA" not in iv_seo.build_meta_title(row) + iv_seo.build_meta_description(row)
    # an injection that is not given IV is not called IV and promises no infusion rate or drip calculator
    shot = {"generic_name": "Medroxyprogesterone", "brand_names": ["Depo-Provera"], "maker_count": 4, "routes": ["Intramuscular"]}
    assert iv_seo.build_meta_title(shot) == "Medroxyprogesterone Injection (Depo-Provera): Mixing & Storage"
    text = iv_seo.build_meta_title(shot) + iv_seo.build_meta_description(shot)
    assert " IV" not in text and "nfusion" not in text and "calculator" not in text and len(iv_seo.build_meta_description(shot)) <= 160
    assert iv_seo.build_meta_title({**row, "routes": ["Intravenous", "Oral"]}).startswith("Vancomycin IV")


# ---- endpoints ------------------------------------------------------------------------------------------


def drug(**over):
    row = {
        "id": "x", "slug": "vancomycin", "generic_name": "Vancomycin", "brand_names": ["Tyzavan"], "drug_class": [],
        "spl_set_id": INJECTION, "other_setids": ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"], "published": False,
        "card": {"fields": {}}, "card_status": "approved", "meta_title": None, "meta_description": None,
    }  # fmt: skip
    row.update(over)
    return row


class FakeConn:
    """Answers a query by the first matching word; remembers every statement."""

    def __init__(self, answers, log):
        self.answers, self.log = answers, log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        self.log.append((sql, params))
        for word, value in self.answers:
            if word in sql:
                rows = value if isinstance(value, list) else [value]
                first = rows[0] if rows else None
                mapped = SimpleNamespace(_mapping=first) if isinstance(first, dict) else first
                return SimpleNamespace(fetchone=lambda: mapped, fetchall=lambda: rows, scalar=lambda: first, rowcount=1, __iter__=lambda s: iter(rows))
        return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [], scalar=lambda: 0, rowcount=0)


@pytest.fixture
def call():
    def _call(method, path, answers, role="editor", xml=None, **kwargs):
        log = []
        engine = SimpleNamespace(connect=lambda: FakeConn(answers, log), begin=lambda: FakeConn(answers, log))
        app = FastAPI()
        app.include_router(iv_manage.router)
        app.dependency_overrides[auth.get_admin_user] = lambda: {"id": str(uuid.uuid4()), "email": "ed@example.com", "role": role}
        with patch.object(database, "db_engine", engine), patch.object(iv_manage, "log_audit"), patch.object(
            iv_card, "fetch_label_xml", return_value=xml or label_xml("INTRAVENOUS")
        ), patch.object(iv_manage, "_resolve_ingredient", return_value=[["11124", "vancomycin"]]):
            response = TestClient(app).request(method, path, **kwargs)
        return response, log

    return _call


def writes(log):
    return [sql for sql, _ in log if sql.split()[0] in ("INSERT", "UPDATE", "DELETE")]


def test_add_creates_a_hidden_drug_with_its_label_locked(call):
    answers = [("SELECT slug FROM", []), ("RETURNING id", [(uuid.uuid4(),)]), ("WHERE id = :id", drug())]
    response, log = call("POST", "/api/admin/iv/drugs", answers, json={"name": "Vancomycin &amp; Co", "spl_set_id": INJECTION.upper(), "brand_names": ["Vancocin", "Vancocin", " "]})
    assert response.status_code == 201
    sql, params = next((s, p) for s, p in log if s.startswith("INSERT INTO public.iv_drugs"))
    assert "setid_locked" in sql and ":setid, true" in sql and "published" not in sql  # hidden by the column default
    assert params["name"] == "Vancomycin & Co" and params["setid"] == INJECTION and params["key"] == "11124"
    assert params["brands"] == ["Vancocin"] and params["label_maker"] == "Hikma Pharmaceuticals USA Inc." and params["label_date"] == "2025-08-13"


def test_a_tablet_or_capsule_label_is_refused_for_an_iv_drug(call):
    response, log = call("POST", "/api/admin/iv/drugs", [], xml=label_xml("ORAL"), json={"name": "Vancomycin", "spl_set_id": CAPSULES})
    assert response.status_code == 422 and "not for an injection product" in response.json()["detail"]
    response2, log2 = call("PUT", f"/api/admin/iv/drugs/{uuid.uuid4()}/label", [("WHERE id = :id", drug())], xml=label_xml("ORAL"), json={"spl_set_id": CAPSULES})
    assert response2.status_code == 422
    assert writes(log) == [] and writes(log2) == []


def test_an_intramuscular_label_is_accepted_but_never_one_that_includes_tablets(call):
    answers = [("SELECT slug FROM", []), ("RETURNING id", [(uuid.uuid4(),)]), ("WHERE id = :id", drug())]
    added, log = call("POST", "/api/admin/iv/drugs", answers, xml=label_xml("INTRAMUSCULAR"), json={"name": "Ceftriaxone", "spl_set_id": INJECTION})
    assert added.status_code == 201
    params = next(p for s, p in log if s.startswith("INSERT INTO public.iv_drugs"))
    assert params["routes"] == ["Intramuscular"]
    # a kit that packs tablets with the injection: the injection route alone is not enough
    kit, kit_log = call("POST", "/api/admin/iv/drugs", [], xml=label_xml("INTRAMUSCULAR", "TABLET, FILM COATED"), json={"name": "Kit", "spl_set_id": INJECTION})
    assert kit.status_code == 422 and "tablets or capsules" in kit.json()["detail"] and writes(kit_log) == []


def test_the_same_ingredient_or_label_cannot_be_added_twice(call):
    response, log = call("POST", "/api/admin/iv/drugs", [("ingredient_key = :k OR spl_set_id = :s", [("Vancomycin", False)])], json={"name": "Vancomycin", "spl_set_id": INJECTION})
    assert response.status_code == 409 and "already in the list" in response.json()["detail"]
    assert writes(log) == []


def test_switching_the_label_locks_it_and_clears_the_card_made_from_the_old_one(call):
    new = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    response, log = call("PUT", f"/api/admin/iv/drugs/{uuid.uuid4()}/label", [("WHERE id = :id", drug())], json={"spl_set_id": new})
    assert response.status_code == 200
    sql, params = next((s, p) for s, p in log if s.startswith("UPDATE public.iv_drugs"))
    assert "setid_locked = true" in sql and "card = NULL" in sql and "card_status = 'none'" in sql
    assert params["new"] == new and params["others"][0] == INJECTION and params["label_version"] == 5


def test_details_are_cleaned_and_the_address_of_a_published_page_is_frozen(call):
    path = f"/api/admin/iv/drugs/{uuid.uuid4()}/details"
    response, log = call("PUT", path, [("WHERE id = :id", drug())], json={"generic_name": "G&amp;W <b>Drug</b>", "meta_title": "", "slug": "new-address"})
    assert response.status_code == 200
    params = next(p for s, p in log if s.startswith("UPDATE public.iv_drugs"))
    assert params["generic_name"] == "G&W Drug" and params["meta_title"] is None and params["slug"] == "new-address"

    published, log2 = call("PUT", path, [("WHERE id = :id", drug(published=True))], json={"slug": "new-address"})
    assert published.status_code == 409 and writes(log2) == []
    bad, _ = call("PUT", path, [("WHERE id = :id", drug())], json={"slug": "Bad Slug"})
    assert bad.status_code == 422


def test_clearing_the_cache_never_touches_a_label_that_pills_use(call):
    path = f"/api/admin/iv/drugs/{uuid.uuid4()}/label/clear-cache"
    shared, log = call("POST", path, [("FROM pillfinder", [3]), ("WHERE id = :id", drug())])
    assert shared.status_code == 409 and "3 pill(s)" in shared.json()["detail"] and writes(log) == []

    own, log2 = call("POST", path, [("FROM pillfinder", [0]), ("WHERE id = :id", drug())])
    assert own.status_code == 200
    delete = next(s for s in writes(log2) if s.startswith("DELETE"))
    assert "FROM public.medication_guide WHERE spl_set_id = :s" in delete and "NULLIF(rxcui, '') IS NULL" in delete and "NULLIF(ndc, '') IS NULL" in delete


def test_refetch_uses_the_same_label_fetch_as_the_pill_tool(call):
    with patch.object(iv_manage, "build_guide", new=AsyncMock(return_value={})) as build:
        response, _ = call("POST", f"/api/admin/iv/drugs/{uuid.uuid4()}/label/refetch", [("WHERE id = :id", drug())])
    assert response.status_code == 200
    assert build.await_args.kwargs == {
        "spl_set_id": INJECTION, "force_refresh": True, "include_professional": True, "include_medguide": True, "include_boxed_warning": True,
    }  # fmt: skip


def test_no_iv_tool_ever_writes_to_the_pill_table(call):
    drug_id = uuid.uuid4()
    logs = []
    for method, path, body in [
        ("POST", "/api/admin/iv/drugs", {"name": "Vancomycin", "spl_set_id": INJECTION}),
        ("PUT", f"/api/admin/iv/drugs/{drug_id}/details", {"meta_title": "T"}),
        ("PUT", f"/api/admin/iv/drugs/{drug_id}/label", {"spl_set_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}),
        ("POST", f"/api/admin/iv/drugs/{drug_id}/label/clear-cache", None),
    ]:
        answers = [("SELECT slug FROM", []), ("RETURNING id", [(uuid.uuid4(),)]), ("FROM pillfinder", [0]), ("WHERE id = :id", drug())]
        _, log = call(method, path, answers, json=body)
        logs += log
    assert writes(logs) and not any("pillfinder" in sql for sql in writes(logs))


def test_reviewers_may_look_but_not_add_edit_or_switch(call):
    drug_id = uuid.uuid4()
    assert call("GET", f"/api/admin/iv/drugs/{drug_id}/label", [("WHERE id = :id", drug())], role="reviewer")[0].status_code == 200
    for method, path, body in [
        ("POST", "/api/admin/iv/drugs", {"name": "Vancomycin", "spl_set_id": INJECTION}),
        ("PUT", f"/api/admin/iv/drugs/{drug_id}/details", {"meta_title": "T"}),
        ("PUT", f"/api/admin/iv/drugs/{drug_id}/label", {"spl_set_id": INJECTION}),
        ("POST", f"/api/admin/iv/drugs/{drug_id}/label/refetch", None),
        ("POST", f"/api/admin/iv/drugs/{drug_id}/label/clear-cache", None),
    ]:
        assert call(method, path, [], role="reviewer", json=body)[0].status_code == 403


def test_a_hand_added_combination_drug_gets_the_same_identity_the_importer_gives_it():
    """The importer joins ingredient ids in NAME order and ignores carrier fluids; "Add IV drug" must do exactly the
    same, or the next import would not recognise the row and would add a twin."""
    from services.iv_drugs_import import group_products, ingredient_identity

    # rxcui order (37617 < 8339 as text) is the opposite of name order (piperacillin < tazobactam)
    rx = {"PIPERACILLIN SODIUM": [["8339", "piperacillin"]], "TAZOBACTAM SODIUM": [["37617", "tazobactam"]], "DEXTROSE": [["4850", "glucose"]]}
    product = {
        "dosage_form": "INJECTION", "setids": ["s"],
        "ingredients": [{"name": "TAZOBACTAM SODIUM"}, {"name": "PIPERACILLIN SODIUM"}, {"name": "DEXTROSE"}],
    }  # fmt: skip
    groups, _ = group_products([product], rx)
    assert list(groups) == ["8339+37617"]
    assert ingredient_identity({"37617": "tazobactam", "4850": "glucose", "8339": "piperacillin"})[0] == "8339+37617"


def test_add_uses_the_importers_identity_for_a_combination_drug(call):
    answers = [("SELECT slug FROM", []), ("RETURNING id", [(uuid.uuid4(),)]), ("WHERE id = :id", drug())]
    with patch.object(iv_manage, "_resolve_ingredient", return_value=[["37617", "tazobactam"], ["4850", "glucose"], ["8339", "piperacillin"]]):
        log = []
        engine = SimpleNamespace(connect=lambda: FakeConn(answers, log), begin=lambda: FakeConn(answers, log))
        app = FastAPI()
        app.include_router(iv_manage.router)
        app.dependency_overrides[auth.get_admin_user] = lambda: {"id": str(uuid.uuid4()), "email": "ed@example.com", "role": "editor"}
        with patch.object(database, "db_engine", engine), patch.object(iv_manage, "log_audit"), patch.object(iv_card, "fetch_label_xml", return_value=label_xml("INTRAVENOUS")):
            response = TestClient(app).post("/api/admin/iv/drugs", json={"name": "Piperacillin and Tazobactam", "spl_set_id": INJECTION})
    assert response.status_code == 201
    params = next(p for s, p in log if s.startswith("INSERT INTO public.iv_drugs"))
    assert params["key"] == "8339+37617" and params["rxcuis"] == ["8339", "37617"]
