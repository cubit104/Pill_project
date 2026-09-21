"""Admin: bulk actions on IV / injection drugs.

POST /api/admin/iv/cards/draft-missing   {limit}            draft cards with AI for drugs that have none (superuser, editor)
GET  /api/admin/iv/cards/draft-status                       progress of the running (or last) bulk draft
POST /api/admin/iv/drugs/publish         {ids, published}   publish or hide many drugs at once (superuser, editor)

A bulk draft is the same draft + quote check as the single button (services/iv_card.py), one drug after the other in a
background task. Every card it makes is a DRAFT: nothing goes public until a reviewer approves it, one by one.
Progress lives in one public.site_settings row, so every worker sees it and no migration is needed. A job that stops
(deploy, restart) simply stops sending its heartbeat; pressing the button again carries on with the drugs still
without a card.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from routes.admin.auth import log_audit, require_role
from routes.admin.indexnow import can_submit_pill_slug_to_indexnow, submit_iv_slugs_to_indexnow
from routes.admin.iv_drugs import EDITORS, REVIEWERS, _actor, _engine, _store_card
from services import iv_card, iv_seo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/iv", tags=["admin-iv"])

STATE_KEY = "iv_bulk_draft"
MAX_PER_RUN = 50  # about a minute and a few cents each: small enough to watch the bill between presses
HEARTBEAT_STALE_SECONDS = 600  # one draft takes about a minute; silent this long means the job is gone
MAX_BULK_PUBLISH = 200
MISSING = "deleted_at IS NULL AND card_status = 'none' AND card IS NULL"


class DraftMissingPayload(BaseModel):
    limit: int = Field(MAX_PER_RUN, ge=1, le=MAX_PER_RUN)


class BulkPublishPayload(BaseModel):
    ids: List[uuid.UUID] = Field(..., min_length=1, max_length=MAX_BULK_PUBLISH)
    published: bool


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_running(state: dict) -> bool:
    if state.get("status") != "running":
        return False
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(state["heartbeat_at"])
    except (KeyError, ValueError):
        return False
    return age.total_seconds() < HEARTBEAT_STALE_SECONDS


def _read_state(conn) -> dict:
    value = conn.execute(text("SELECT value FROM public.site_settings WHERE key = :k"), {"k": STATE_KEY}).scalar()
    return value if isinstance(value, dict) else {}


def _write_state(conn, state: dict, by: str) -> None:
    conn.execute(
        text(
            "INSERT INTO public.site_settings (key, value, updated_at, updated_by) VALUES (:k, CAST(:v AS jsonb), now(), :by) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by"
        ),
        {"k": STATE_KEY, "v": json.dumps(state), "by": by},
    )


def _draft_one(drug_id: str, admin: dict, state: dict) -> str:
    """Draft and store one card. Returns 'done', 'skipped' (someone got there first) or raises CardError.
    Puts the drug's name in ``state['last']`` as soon as it is known, so a failure says which drug it was."""
    with _engine().connect() as conn:
        row = conn.execute(
            text(f"SELECT generic_name, spl_set_id, routes, label_version FROM public.iv_drugs WHERE id = :id AND {MISSING}"),
            {"id": drug_id},
        ).fetchone()
    if row is None:
        return "skipped"
    name, setid, routes, _version = row
    state["last"] = name
    card = iv_card.draft_card(name, setid, intravenous=iv_seo.routes_are_intravenous(routes))  # slow: no transaction open
    with _engine().begin() as conn:
        current = conn.execute(
            text(f"SELECT spl_set_id, label_version FROM public.iv_drugs WHERE id = :id AND {MISSING} FOR UPDATE"), {"id": drug_id}
        ).fetchone()
        if current is None or current[0] != setid:
            return "skipped"  # a reviewer drafted it, or switched the label, while the AI was working
        _store_card(
            conn, uuid.UUID(drug_id), card, current[1], "draft",
            ", card_generated_at = now(), card_reviewed_by = NULL, card_reviewed_at = NULL, card_review_notes = NULL",
        )  # fmt: skip
        log_audit(conn, *_actor(admin), "iv_card_generated", "iv_drug", drug_id,
                  metadata={"model": card["source"], "rejected_by_check": card["rejected_by_check"], "bulk": True})  # fmt: skip
    return "done"


def run_bulk_draft(ids: List[str], admin: dict) -> None:
    """The background job. Never raises; every step writes progress so the admin page and a restart can see it."""
    by = admin.get("email", "")
    state = {"status": "running", "total": len(ids), "done": 0, "failed": 0, "skipped": 0, "last": "", "last_error": "",
             "started_at": _now(), "heartbeat_at": _now(), "started_by": by}  # fmt: skip
    for drug_id in ids:
        try:
            outcome = _draft_one(drug_id, admin, state)
            state["done" if outcome == "done" else "skipped"] += 1
        except iv_card.CardError as exc:
            state["failed"] += 1
            state["last_error"] = str(exc)[:300]
        except Exception as exc:  # noqa: BLE001 - one bad label must not stop the other 49
            logger.error("bulk draft failed for %s: %s", drug_id, exc, exc_info=True)
            state["failed"] += 1
            state["last_error"] = "Server error (see the log)"
        state["heartbeat_at"] = _now()
        try:
            with _engine().begin() as conn:
                _write_state(conn, state, by)
        except Exception:  # noqa: BLE001
            logger.warning("bulk draft: could not save progress", exc_info=True)
    state["status"], state["finished_at"] = "finished", _now()
    try:
        with _engine().begin() as conn:
            _write_state(conn, state, by)
    except Exception:  # noqa: BLE001
        logger.warning("bulk draft: could not save the final state", exc_info=True)


def _status(conn) -> dict:
    state = _read_state(conn)
    missing = conn.execute(text(f"SELECT COUNT(*) FROM public.iv_drugs WHERE {MISSING}")).scalar() or 0
    return {**state, "running": _is_running(state), "missing": int(missing), "max_per_run": MAX_PER_RUN, "ai_available": bool(iv_card.api_key())}


@router.get("/cards/draft-status")
def draft_status(admin: dict = Depends(require_role(*REVIEWERS))):
    with _engine().connect() as conn:
        return _status(conn)


@router.post("/cards/draft-missing", status_code=202)
def draft_missing(payload: DraftMissingPayload, background_tasks: BackgroundTasks, admin: dict = Depends(require_role(*EDITORS))):
    """Start drafting cards for up to `limit` drugs that have none: published first, then the most widely made."""
    if not iv_card.api_key():
        raise HTTPException(status_code=503, detail="AI drafting is off on this server (no GEMINI_API_KEY).")
    by = admin.get("email", "")
    with _engine().begin() as conn:
        # the settings row is the lock: two presses at the same moment wait here, and the second one sees "running"
        conn.execute(
            text("INSERT INTO public.site_settings (key, value, updated_by) VALUES (:k, CAST('{}' AS jsonb), :by) ON CONFLICT (key) DO NOTHING"),
            {"k": STATE_KEY, "by": by},
        )
        state = conn.execute(text("SELECT value FROM public.site_settings WHERE key = :k FOR UPDATE"), {"k": STATE_KEY}).scalar() or {}
        if _is_running(state):
            raise HTTPException(status_code=409, detail="A bulk draft is already running. Wait for it to finish.")
        ids = [
            r[0]
            for r in conn.execute(
                text(f"SELECT id::text FROM public.iv_drugs WHERE {MISSING} ORDER BY published DESC, maker_count DESC, lower(generic_name) LIMIT :n"),
                {"n": payload.limit},
            ).fetchall()
        ]
        if not ids:
            return {**_status(conn), "started": False}
        _write_state(conn, {"status": "running", "total": len(ids), "done": 0, "failed": 0, "skipped": 0, "last": "", "last_error": "",
                            "started_at": _now(), "heartbeat_at": _now(), "started_by": by}, by)  # fmt: skip
        log_audit(conn, *_actor(admin), "iv_cards_bulk_draft_started", "iv_drug", None, metadata={"count": len(ids)})
        status = _status(conn)
    background_tasks.add_task(run_bulk_draft, ids, admin)  # after the response, so after the commit
    return {**status, "started": True}


@router.post("/drugs/publish")
def bulk_publish(payload: BulkPublishPayload, background_tasks: BackgroundTasks, admin: dict = Depends(require_role(*EDITORS))):
    """Publish or hide the ticked drugs. Same effect as the single button for each, one audit entry each."""
    ids = [str(i) for i in dict.fromkeys(payload.ids)]
    action = "iv_drug_published" if payload.published else "iv_drug_unpublished"
    with _engine().begin() as conn:
        rows = conn.execute(
            text(
                "UPDATE public.iv_drugs SET published = :p WHERE id = ANY(CAST(:ids AS uuid[])) AND deleted_at IS NULL "
                "AND published IS DISTINCT FROM :p RETURNING id::text, slug"
            ),
            {"p": payload.published, "ids": ids},
        ).fetchall()
        for drug_id, _slug in rows:
            log_audit(conn, *_actor(admin), action, "iv_drug", drug_id, metadata={"bulk": True})
    slugs = [slug for _id, slug in rows]
    queued = bool(payload.published and slugs and can_submit_pill_slug_to_indexnow(slugs[0]))
    if queued:
        background_tasks.add_task(submit_iv_slugs_to_indexnow, slugs)
    return {"published": payload.published, "changed": len(rows), "unchanged": len(ids) - len(rows), "indexnow_queued": queued}
