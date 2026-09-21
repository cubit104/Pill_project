"""Admin: IV drugs and their administration cards.

A card is drafted by AI from the drug's FDA label and machine-checked (services/iv_card.py). Nothing a
reviewer has not approved is ever shown on the site; this is where they read, fix, approve or reject it.

GET  /api/admin/iv/drugs?status=&q=&page=&per_page=   list, with counts per card status
GET  /api/admin/iv/drugs/{id}                          one drug with its card and label details
POST /api/admin/iv/drugs/{id}/card/generate            draft a card with AI (superuser, editor)
PUT  /api/admin/iv/drugs/{id}/card                     save a reviewer's edits (quotes are re-checked)
POST /api/admin/iv/drugs/{id}/card/approve             re-check, then approve: the card goes public
POST /api/admin/iv/drugs/{id}/card/reject              {notes}
GET  /api/admin/iv/drugs/{id}/next-draft               the next draft to review after this drug
GET  /api/admin/iv/drugs/{id}/preview                  the drug page as the site would show it, hidden drug and draft card included
PUT  /api/admin/iv/drugs/{id}/published                {published} (superuser, editor); publishing pings IndexNow

Adding a drug, editing its details and SEO text, and the FDA label tools are in routes/admin/iv_manage.py.
"""

import json
import logging
import uuid
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

import database
from routes.admin.auth import log_audit, require_role
from routes import iv_drugs as public_iv
from routes.admin.indexnow import can_submit_pill_slug_to_indexnow, submit_iv_slug_to_indexnow
from services import iv_card, iv_seo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/iv", tags=["admin-iv"])

REVIEWERS = ("superuser", "editor", "reviewer")
EDITORS = ("superuser", "editor")
CardStatus = Literal["none", "draft", "approved", "rejected"]

_LIST_COLUMNS = (
    "id::text, slug, generic_name, brand_names, label_type, label_brand, label_maker, label_presentation, "
    "maker_count, published, card_status, card_generated_at, card_reviewed_by, card_reviewed_at, "
    "(card_label_version IS NOT NULL AND label_version > card_label_version) AS label_updated_since"
)
_DETAIL_COLUMNS = _LIST_COLUMNS + (
    ", drug_class, routes, dea_schedule, spl_set_id, other_setids, setid_locked, application_number, "
    "label_version, label_date, strengths, product_count, card, card_label_version, card_review_notes, updated_at, "
    "ingredient_key, meta_title, meta_description"
)


class CardPayload(BaseModel):
    fields: Dict[str, Any]
    notes_for_reviewer: Optional[str] = Field(None, max_length=1000)


class RejectPayload(BaseModel):
    notes: str = Field("", max_length=1000)


class PublishedPayload(BaseModel):
    published: bool


def _engine():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")
    return database.db_engine


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _row(row) -> dict:
    return {key: _iso(value) for key, value in row._mapping.items()}


def _get(conn, drug_id: uuid.UUID, lock: bool = False):
    row = conn.execute(
        text(f"SELECT {_DETAIL_COLUMNS} FROM public.iv_drugs WHERE id = :id AND deleted_at IS NULL" + (" FOR UPDATE" if lock else "")),
        {"id": str(drug_id)},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="IV drug not found")
    return row


def _actor(admin: dict) -> tuple:
    return admin["id"], admin.get("email", "")


@router.get("/drugs")
def list_iv_drugs(
    status: Optional[CardStatus] = None,
    q: Optional[str] = Query(None, max_length=100),
    published: Optional[bool] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_role(*REVIEWERS)),
):
    where, params = ["deleted_at IS NULL"], {"limit": per_page, "offset": (page - 1) * per_page}
    if status:
        where.append("card_status = :status")
        params["status"] = status
    if published is not None:
        where.append("published = :published")
        params["published"] = published
    if q and q.strip():
        where.append("(generic_name ILIKE :q OR array_to_string(brand_names, ' ') ILIKE :q)")
        params["q"] = f"%{q.strip()}%"
    where_sql = " AND ".join(where)
    with _engine().connect() as conn:
        total = conn.execute(text(f"SELECT COUNT(*) FROM public.iv_drugs WHERE {where_sql}"), params).scalar() or 0
        rows = conn.execute(
            text(
                f"""
                SELECT {_LIST_COLUMNS} FROM public.iv_drugs WHERE {where_sql}
                ORDER BY maker_count DESC, generic_name
                LIMIT :limit OFFSET :offset
                """
            ),
            params,
        ).fetchall()
        counts = conn.execute(
            text(
                """
                SELECT card_status, COUNT(*), COUNT(*) FILTER (WHERE published)
                FROM public.iv_drugs WHERE deleted_at IS NULL GROUP BY card_status
                """
            )
        ).fetchall()
    return {
        "drugs": [_row(r) for r in rows],
        "total": int(total),
        "page": page,
        "per_page": per_page,
        "counts": {r[0]: int(r[1]) for r in counts},
        "published": sum(int(r[2]) for r in counts),
        "ai_available": bool(iv_card.api_key()),
    }


@router.get("/drugs/{drug_id}")
def get_iv_drug(drug_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    with _engine().connect() as conn:
        drug = _row(_get(conn, drug_id))
    drug["suggested_meta_title"] = iv_seo.build_meta_title(drug)
    drug["suggested_meta_description"] = iv_seo.build_meta_description(drug)
    fields = iv_card.card_fields(iv_seo.routes_are_intravenous(drug.get("routes")))
    drug["card_questions"] = {key: question for key, (_label, question) in fields.items()}
    drug["card_labels"] = {key: label for key, (label, _question) in fields.items()}
    drug["ai_available"] = bool(iv_card.api_key())
    return drug


def _store_card(conn, drug_id: uuid.UUID, card: dict, label_version, status: str, extra_sql: str = "", extra: Optional[dict] = None):
    conn.execute(
        text(
            f"""
            UPDATE public.iv_drugs
            SET card = CAST(:card AS jsonb), card_status = :status, card_label_version = :label_version {extra_sql}
            WHERE id = :id
            """
        ),
        {"card": json.dumps(card), "status": status, "label_version": label_version, "id": str(drug_id), **(extra or {})},
    )


@router.post("/drugs/{drug_id}/card/generate")
def generate_card(drug_id: uuid.UUID, admin: dict = Depends(require_role(*EDITORS))):
    """Draft a card with AI. An approved card is never replaced silently: reject it first."""
    with _engine().connect() as conn:
        m = _get(conn, drug_id)._mapping
    if m["card_status"] == "approved":
        raise HTTPException(status_code=409, detail="This card is approved and live. Reject it first to draft a new one.")
    try:
        # slow (label download + AI): no transaction held open
        card = iv_card.draft_card(m["generic_name"], m["spl_set_id"], intravenous=iv_seo.routes_are_intravenous(m["routes"]))
    except iv_card.CardError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    with _engine().begin() as conn:
        current = _get(conn, drug_id, lock=True)._mapping
        if current["card_status"] == "approved" or current["spl_set_id"] != m["spl_set_id"]:
            raise HTTPException(status_code=409, detail="The drug changed while the card was being drafted. Try again.")
        _store_card(
            conn, drug_id, card, current["label_version"], "draft",
            ", card_generated_at = now(), card_reviewed_by = NULL, card_reviewed_at = NULL, card_review_notes = NULL",
        )  # fmt: skip
        log_audit(conn, *_actor(admin), "iv_card_generated", "iv_drug", str(drug_id),
                  metadata={"model": card["source"], "rejected_by_check": card["rejected_by_check"]})  # fmt: skip
        return _row(_get(conn, drug_id))


@router.put("/drugs/{drug_id}/card")
def save_card(drug_id: uuid.UUID, payload: CardPayload, admin: dict = Depends(require_role(*REVIEWERS))):
    """Save a reviewer's edits as a draft. Quotes are checked against the label again; an edited approved card
    goes back to draft until it is approved again."""
    with _engine().connect() as conn:
        m = _get(conn, drug_id)._mapping
    merged = {**(m["card"] or {}), "fields": payload.fields, "notes_for_reviewer": payload.notes_for_reviewer or ""}
    try:
        card = iv_card.recheck_card(merged, m["spl_set_id"])
    except iv_card.CardError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    with _engine().begin() as conn:
        current = _get(conn, drug_id, lock=True)._mapping
        if current["spl_set_id"] != m["spl_set_id"]:
            raise HTTPException(status_code=409, detail="The label was switched while you were editing. Reload the page.")
        _store_card(conn, drug_id, card, current["label_version"], "draft", ", card_reviewed_by = NULL, card_reviewed_at = NULL")
        log_audit(conn, *_actor(admin), "iv_card_saved", "iv_drug", str(drug_id), metadata={"rejected_by_check": card["rejected_by_check"]})
        return _row(_get(conn, drug_id))


def approve_stored_card(drug_id: uuid.UUID, admin: dict) -> tuple:
    """Approve the stored card of one drug. Returns (drug row, answers the quote check removed).

    The quote check runs once more against the label; if it throws any fact out, NOTHING is approved: the cleaned
    draft is saved for the reviewer to look at and the removed answers are returned. Used by the Approve button and,
    one drug at a time, by "Approve selected", so both approve by exactly the same rules.
    """
    with _engine().connect() as conn:
        m = _get(conn, drug_id)._mapping
    if not m["card"] or m["card_status"] == "none":
        raise HTTPException(status_code=409, detail="There is no card to approve yet.")
    try:
        card = iv_card.recheck_card(m["card"], m["spl_set_id"])
    except iv_card.CardError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    with _engine().begin() as conn:
        current = _get(conn, drug_id, lock=True)._mapping
        if current["spl_set_id"] != m["spl_set_id"]:
            raise HTTPException(status_code=409, detail="The label was switched. Reload the page.")
        # the quote check ran on the card as it was a moment ago: if someone saved an edit, rejected or re-drafted it
        # since, approving now would publish the older text and lose their change
        if current["card"] != m["card"] or current["card_status"] != m["card_status"]:
            raise HTTPException(status_code=409, detail="The card changed while it was being checked. Reload the page and review it again.")
        if card["rejected_by_check"]:
            # back to draft, and nobody has reviewed this cleaned version yet
            _store_card(conn, drug_id, card, current["label_version"], "draft", ", card_reviewed_by = NULL, card_reviewed_at = NULL")
        else:
            _store_card(
                conn, drug_id, card, current["label_version"], "approved",
                ", card_reviewed_by = :by, card_reviewed_at = now(), card_review_notes = NULL", {"by": admin.get("email", "")},
            )  # fmt: skip
            log_audit(conn, *_actor(admin), "iv_card_approved", "iv_drug", str(drug_id), metadata={"label_version": current["label_version"]})
        return _row(_get(conn, drug_id)), list(card["rejected_by_check"])


@router.post("/drugs/{drug_id}/card/approve")
def approve_card(drug_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    """Approve the stored draft. The quote check runs once more; if it throws any fact out, nothing is approved
    and the cleaned draft is saved for the reviewer to look at."""
    result, removed = approve_stored_card(drug_id, admin)
    if removed:
        raise HTTPException(
            status_code=409,
            detail="Not approved: the quote check removed " + ", ".join(removed) + ". The cleaned draft was saved; review it again.",
        )
    return result


@router.get("/drugs/{drug_id}/next-draft")
def next_draft(drug_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    """The draft that follows this drug in the review list (most makers first, then by name); wraps around to the top.
    Lets a reviewer go from one card straight to the next without returning to the list."""
    with _engine().connect() as conn:
        m = _get(conn, drug_id)._mapping
        row = conn.execute(
            text(
                """
                SELECT id::text, generic_name FROM public.iv_drugs
                WHERE deleted_at IS NULL AND card_status = 'draft' AND id <> :id
                ORDER BY (maker_count < :makers OR (maker_count = :makers AND generic_name > :name)) DESC, maker_count DESC, generic_name
                LIMIT 1
                """
            ),
            {"id": str(drug_id), "makers": m["maker_count"], "name": m["generic_name"]},
        ).fetchone()
        drafts = conn.execute(text("SELECT COUNT(*) FROM public.iv_drugs WHERE deleted_at IS NULL AND card_status = 'draft'")).scalar() or 0
    found = row._mapping if row else None
    return {"next": {"id": found["id"], "generic_name": found["generic_name"]} if found else None, "drafts": int(drafts)}


@router.post("/drugs/{drug_id}/card/reject")
def reject_card(drug_id: uuid.UUID, payload: RejectPayload, admin: dict = Depends(require_role(*REVIEWERS))):
    with _engine().begin() as conn:
        m = _get(conn, drug_id, lock=True)._mapping
        if not m["card"]:
            raise HTTPException(status_code=409, detail="There is no card to reject.")
        conn.execute(
            text(
                """
                UPDATE public.iv_drugs
                SET card_status = 'rejected', card_review_notes = :notes, card_reviewed_by = :by, card_reviewed_at = now()
                WHERE id = :id
                """
            ),
            {"notes": payload.notes.strip() or None, "by": admin.get("email", ""), "id": str(drug_id)},
        )
        log_audit(conn, *_actor(admin), "iv_card_rejected", "iv_drug", str(drug_id), metadata={"notes": payload.notes.strip()})
        return _row(_get(conn, drug_id))


@router.get("/drugs/{drug_id}/preview")
def preview_iv_drug(drug_id: uuid.UUID, admin: dict = Depends(require_role(*REVIEWERS))):
    """The public page payload for staff: a hidden drug is shown, and so is a card nobody approved yet."""
    with _engine().connect() as conn:
        row = conn.execute(
            text(f"SELECT {public_iv.DRUG_PAGE_COLUMNS}, published FROM public.iv_drugs WHERE id = :id AND deleted_at IS NULL"),
            {"id": str(drug_id)},
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="IV drug not found")
        m = row._mapping
        payload = public_iv.drug_page_payload(conn, m, any_card=True)
    payload["card_status"] = m["card_status"]
    payload["published"] = bool(m["published"])
    return payload


@router.put("/drugs/{drug_id}/published")
def set_published(
    drug_id: uuid.UUID,
    payload: PublishedPayload,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_role(*EDITORS)),
):
    with _engine().begin() as conn:
        _get(conn, drug_id, lock=True)
        conn.execute(text("UPDATE public.iv_drugs SET published = :p WHERE id = :id"), {"p": payload.published, "id": str(drug_id)})
        log_audit(conn, *_actor(admin), "iv_drug_published" if payload.published else "iv_drug_unpublished", "iv_drug", str(drug_id))
        drug = _row(_get(conn, drug_id))
    # the helper only checks that a slug and an IndexNow key exist, nothing about pills
    if payload.published and can_submit_pill_slug_to_indexnow(drug["slug"]):
        # after the response, so after the commit; best effort, a failed ping never undoes the publish
        background_tasks.add_task(submit_iv_slug_to_indexnow, drug["slug"])
        drug["indexnow_queued"] = True
    return drug
