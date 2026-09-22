"""Bulk actions in the IV admin: draft the missing cards in the background, publish the ticked drugs."""

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
from routes.admin import auth, iv_bulk  # noqa: E402
from services import iv_card  # noqa: E402


class FakeConn:
    """Answers each query by a word it contains; records every statement and its parameters."""

    def __init__(self, answers, log):
        self.answers, self.log = answers, log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        self.log.append((sql, params))
        for word, rows in self.answers:
            if word in sql:
                return SimpleNamespace(fetchone=lambda: rows[0] if rows else None, fetchall=lambda: rows, scalar=lambda: rows[0] if rows else None)
        return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [], scalar=lambda: None)


def client_for(answers, role="editor"):
    log = []
    engine = SimpleNamespace(connect=lambda: FakeConn(answers, log), begin=lambda: FakeConn(answers, log))
    app = FastAPI()
    app.include_router(iv_bulk.router)
    app.dependency_overrides[auth.get_admin_user] = lambda: {"id": str(uuid.uuid4()), "email": "editor@example.com", "role": role}
    return TestClient(app), patch.object(database, "db_engine", engine), patch.object(iv_bulk, "log_audit"), log


def fresh(**over):
    return {"status": "running", "heartbeat_at": datetime.now(timezone.utc).isoformat(), **over}


def test_publishing_the_ticked_drugs_changes_only_those_and_pings_indexnow_once():
    a, b = uuid.uuid4(), uuid.uuid4()
    client, engine, audit, log = client_for([("UPDATE public.iv_drugs", [(str(a), "heparin"), (str(b), "vancomycin")])])
    with engine, audit as audited, patch.object(iv_bulk, "submit_iv_slugs_to_indexnow") as ping, \
            patch.object(iv_bulk, "can_submit_pill_slug_to_indexnow", return_value=True):
        response = client.post("/api/admin/iv/drugs/publish", json={"ids": [str(a), str(b), str(a)], "published": True})
    assert response.status_code == 200
    assert response.json() == {"published": True, "changed": 2, "unchanged": 0, "indexnow_queued": True}
    sql, params = log[0]
    assert "id = ANY(CAST(:ids AS uuid[]))" in sql and "deleted_at IS NULL" in sql and params["ids"] == [str(a), str(b)]  # the repeat is dropped
    assert audited.call_count == 2  # one audit entry per drug, like the single button
    ping.assert_called_once_with(["heparin", "vancomycin"])


def test_hiding_never_pings_and_a_reviewer_may_not_bulk_publish():
    client, engine, audit, _ = client_for([("UPDATE public.iv_drugs", [(str(uuid.uuid4()), "heparin")])])
    with engine, audit, patch.object(iv_bulk, "submit_iv_slugs_to_indexnow") as ping:
        hidden = client.post("/api/admin/iv/drugs/publish", json={"ids": [str(uuid.uuid4())], "published": False})
    assert hidden.json()["indexnow_queued"] is False and hidden.json()["changed"] == 1
    ping.assert_not_called()
    reviewer, engine, audit, log = client_for([], role="reviewer")
    with engine, audit:
        assert reviewer.post("/api/admin/iv/drugs/publish", json={"ids": [str(uuid.uuid4())], "published": True}).status_code == 403
        assert reviewer.post("/api/admin/iv/cards/draft-missing", json={}).status_code == 403
    assert log == []
    assert client.post("/api/admin/iv/drugs/publish", json={"ids": [], "published": True}).status_code == 422


def test_bulk_draft_starts_once_takes_drugs_without_a_card_and_is_capped():
    ids = [(str(uuid.uuid4()),), (str(uuid.uuid4()),)]
    answers = [("FOR UPDATE", [{}]), ("SELECT id::text FROM public.iv_drugs", ids), ("SELECT COUNT(*)", [7]), ("SELECT value FROM", [fresh(total=2)])]
    client, engine, audit, log = client_for(answers)
    with engine, audit, patch.object(iv_card, "api_key", return_value="k"), patch.object(iv_bulk, "run_bulk_draft") as job:
        started = client.post("/api/admin/iv/cards/draft-missing", json={"limit": 2})
        assert started.status_code == 202 and started.json()["started"] is True and started.json()["missing"] == 7
        assert job.call_args.args[0] == [ids[0][0], ids[1][0]]
        assert client.post("/api/admin/iv/cards/draft-missing", json={"limit": 51}).status_code == 422
    picked = next(sql for sql, _ in log if "SELECT id::text" in sql)
    assert "card_status = 'none' AND card IS NULL" in picked and "deleted_at IS NULL" in picked and "published DESC" in picked
    saved = next(params for sql, params in log if sql.startswith("INSERT INTO public.site_settings") and params.get("v"))
    assert json.loads(saved["v"])["status"] == "running" and json.loads(saved["v"])["total"] == 2


def test_a_second_press_is_refused_while_a_job_is_alive_but_not_after_it_went_silent():
    client, engine, audit, _ = client_for([("FOR UPDATE", [fresh()])])
    with engine, audit, patch.object(iv_card, "api_key", return_value="k"), patch.object(iv_bulk, "run_bulk_draft") as job:
        assert client.post("/api/admin/iv/cards/draft-missing", json={}).status_code == 409
        job.assert_not_called()
    stale = (datetime.now(timezone.utc) - timedelta(seconds=iv_bulk.HEARTBEAT_STALE_SECONDS + 5)).isoformat()
    assert iv_bulk._is_running(fresh()) is True
    assert iv_bulk._is_running({"status": "running", "heartbeat_at": stale}) is False  # killed by a deploy: press again
    assert iv_bulk._is_running({"status": "finished", "heartbeat_at": datetime.now(timezone.utc).isoformat()}) is False
    no_key, engine, audit, _ = client_for([])
    with engine, audit, patch.object(iv_card, "api_key", return_value=""):
        assert no_key.post("/api/admin/iv/cards/draft-missing", json={}).status_code == 503


def test_the_job_keeps_going_after_a_failure_and_every_card_it_stores_is_a_draft():
    rows = [("SELECT generic_name, spl_set_id", [("Heparin", "set-1", ["Intravenous"], 6)]), ("FOR UPDATE", [("set-1", 6)])]
    log = []
    engine = SimpleNamespace(connect=lambda: FakeConn(rows, log), begin=lambda: FakeConn(rows, log))
    card = {"fields": {}, "source": "gemini", "rejected_by_check": []}
    drafts = [card, iv_card.CardError("The label could not be read"), card]
    with patch.object(database, "db_engine", engine), patch.object(iv_bulk, "log_audit"), \
            patch.object(iv_card, "draft_card", side_effect=drafts) as draft, \
            patch.object(iv_bulk, "_card_model", return_value="gemini-3.8-flash") as chosen:
        iv_bulk.run_bulk_draft([str(uuid.uuid4()) for _ in range(3)], {"id": "u", "email": "editor@example.com"})
    assert draft.call_count == 3 and draft.call_args.kwargs == {"model": "gemini-3.8-flash", "intravenous": True}
    assert chosen.call_count == 1  # the model chosen in Settings, read once for the whole run
    stored = [params for sql, params in log if sql.startswith("UPDATE public.iv_drugs")]
    assert len(stored) == 2 and all(p["status"] == "draft" for p in stored)  # never approved, never published
    final = json.loads([params for sql, params in log if sql.startswith("INSERT INTO public.site_settings")][-1]["v"])
    assert (final["status"], final["done"], final["failed"], final["total"]) == ("finished", 2, 1, 3)
    assert final["last"] == "Heparin" and "could not be read" in final["last_error"]


def test_a_drug_someone_already_drafted_is_skipped_not_overwritten():
    log = []
    engine = SimpleNamespace(connect=lambda: FakeConn([], log), begin=lambda: FakeConn([], log))  # the row no longer matches "no card"
    with patch.object(database, "db_engine", engine), patch.object(iv_card, "draft_card") as draft:
        assert iv_bulk._draft_one("a1", {"id": "u", "email": "e"}, {}) == "skipped"
    draft.assert_not_called()


def test_approve_selected_uses_the_single_buttons_routine_and_only_touches_drafts():
    draft, approved_already, shaky = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    status = {str(draft): ("Heparin", "draft"), str(approved_already): ("Vancomycin", "approved"), str(shaky): ("Insulin", "draft")}

    class Conn(FakeConn):
        def execute(self, statement, params=None):
            self.log.append((" ".join(str(statement).split()), params))
            row = status.get((params or {}).get("id"))
            return SimpleNamespace(fetchone=lambda: row)

    log = []
    engine = SimpleNamespace(connect=lambda: Conn([], log), begin=lambda: Conn([], log))
    app = FastAPI()
    app.include_router(iv_bulk.router)
    app.dependency_overrides[auth.get_admin_user] = lambda: {"id": "u", "email": "rph@example.com", "role": "reviewer"}  # a reviewer may approve
    outcomes = {draft: ({}, []), shaky: ({}, ["infusion"])}
    with patch.object(database, "db_engine", engine), \
            patch.object(iv_bulk, "approve_stored_card", side_effect=lambda drug_id, admin: outcomes[drug_id]) as approve:
        response = TestClient(app).post("/api/admin/iv/cards/approve", json={"ids": [str(draft), str(approved_already), str(shaky), str(draft)]})
    body = response.json()
    assert response.status_code == 200
    assert body["approved"] == [{"id": str(draft), "name": "Heparin"}]
    reasons = {item["name"]: item["reason"] for item in body["not_approved"]}
    assert reasons == {"Vancomycin": "not a draft (approved)", "Insulin": "the quote check removed: infusion"}
    # only the two drafts went through the approval routine, each once, with the reviewer who pressed the button
    assert [call.args[0] for call in approve.call_args_list] == [draft, shaky]
    assert approve.call_args.args[1]["email"] == "rph@example.com"
    too_many = [str(uuid.uuid4()) for _ in range(iv_bulk.MAX_BULK_APPROVE + 1)]
    assert TestClient(app).post("/api/admin/iv/cards/approve", json={"ids": too_many}).status_code == 422
