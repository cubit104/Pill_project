"""Admin draft management endpoints."""
import json
import logging
from typing import Optional

import bleach
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user, log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-drafts"])

_BLEACH_ALLOWED_TAGS: list = []  # strip all HTML


def _sanitize(value: object) -> Optional[str]:
    """Sanitize a draft_data value: None/empty → None, else HTML-strip to string."""
    if value is None:
        return None
    s = str(value)
    if s == "":
        return None
    return bleach.clean(s, tags=_BLEACH_ALLOWED_TAGS, strip=True)


PUBLISHABLE_FIELDS = [
    "medicine_name", "author", "brand_names", "splimprint", "splcolor_text", "splshape_text",
    "splsize", "spl_strength", "spl_ingredients", "spl_inactive_ing", "dosage_form",
    "route", "dea_schedule_name", "pharmclass_fda_epc", "ndc9", "ndc11", "rxcui",
    "rxcui_1", "status_rx_otc", "imprint_status", "slug", "meta_title", "meta_description",
    "image_filename", "has_image", "image_alt_text", "tags",
]


class DraftCreate(BaseModel):
    draft_data: dict
    # Status on creation is always 'draft'; use the dedicated /submit endpoint to advance state.


class DraftUpdate(BaseModel):
    draft_data: dict


class ReviewAction(BaseModel):
    review_notes: Optional[str] = None


@router.post("/pills/{pill_id}/drafts", status_code=201)
def create_draft(
    request: Request,
    pill_id: str,
    body: DraftCreate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            result = conn.execute(
                text("""
                    INSERT INTO pill_drafts (pill_id, draft_data, status, created_by)
                    VALUES (:pill_id, CAST(:draft_data AS jsonb), 'draft', :created_by)
                    RETURNING id
                """),
                {
                    "pill_id": pill_id,
                    "draft_data": json.dumps(body.draft_data),
                    "created_by": str(admin["id"]),
                },
            )
            draft_id = str(result.scalar())

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="create_draft",
                entity_type="draft",
                entity_id=draft_id,
                metadata={"pill_id": pill_id, "status": "draft"},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"id": draft_id, "created": True}
    except SQLAlchemyError as e:
        logger.error(f"create_draft DB error: {e}", exc_info=True)
        # Surface the root DB error so frontend/devtools can display it.
        # Safe to expose here because all admin endpoints are behind get_admin_user auth.
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.get("/drafts/count")
def get_draft_count(admin: dict = Depends(get_admin_user)):
    """Return the count of active (non-published, non-rejected) drafts."""
    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            count = conn.execute(
                text("""
                    SELECT COUNT(*) FROM pill_drafts
                    WHERE status NOT IN ('published', 'rejected')
                """),
            ).scalar() or 0
        return {"count": int(count)}
    except SQLAlchemyError as e:
        logger.error(f"get_draft_count DB error: {e}", exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str, admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT d.id, d.pill_id, d.status, d.created_at, d.updated_at,
                           d.review_notes, d.draft_data, d.created_by,
                           COALESCE(p.medicine_name, d.draft_data->>'medicine_name') AS medicine_name
                    FROM pill_drafts d
                    LEFT JOIN pillfinder p ON p.id = d.pill_id
                    WHERE d.id = :id
                    LIMIT 1
                """),
                {"id": draft_id},
            ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Draft not found")

        draft_data = row[6] if isinstance(row[6], dict) else json.loads(row[6]) if row[6] else {}
        return {
            "id": str(row[0]),
            "pill_id": str(row[1]) if row[1] else None,
            "status": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "updated_at": row[4].isoformat() if row[4] else None,
            "review_notes": row[5],
            "draft_data": draft_data,
            "created_by": str(row[7]) if row[7] else None,
            "medicine_name": row[8],
        }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"get_draft DB error: {e}", exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.put("/drafts/{draft_id}")
def update_draft(
    request: Request,
    draft_id: str,
    body: DraftUpdate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            result = conn.execute(
                text("""
                    UPDATE pill_drafts
                    SET draft_data = CAST(:draft_data AS jsonb), updated_at = now()
                    WHERE id = :id AND status = 'draft'
                    RETURNING id
                """),
                {"id": draft_id, "draft_data": json.dumps(body.draft_data)},
            )
            row = result.fetchone()
            if not row:
                exists = conn.execute(
                    text("SELECT status FROM pill_drafts WHERE id = :id LIMIT 1"),
                    {"id": draft_id},
                ).fetchone()
                if not exists:
                    raise HTTPException(status_code=404, detail="Draft not found")
                raise HTTPException(
                    status_code=409,
                    detail=f"Draft cannot be updated: current status is '{exists[0]}'. Only 'draft' status drafts can be edited.",
                )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="update_draft",
                entity_type="draft",
                entity_id=draft_id,
                metadata={"status": "draft"},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"id": draft_id, "updated": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"update_draft DB error: {e}", exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.get("/drafts")
def list_drafts(
    status: Optional[str] = Query(None),
    admin: dict = Depends(get_admin_user),
):
    if not database.db_engine:
        database.connect_to_database()

    where = "WHERE 1=1"
    params: dict = {}
    if status:
        where += " AND d.status = :status"
        params["status"] = status

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(f"""
                    SELECT d.id, d.pill_id, d.status, d.created_at, d.updated_at,
                           d.review_notes,
                           COALESCE(p.medicine_name, d.draft_data->>'medicine_name') AS medicine_name,
                           d.created_by
                    FROM pill_drafts d
                    LEFT JOIN pillfinder p ON p.id = d.pill_id
                    {where}
                    ORDER BY d.created_at DESC
                    LIMIT 100
                """),
                params,
            ).fetchall()

        return [
            {
                "id": str(r[0]),
                "pill_id": str(r[1]) if r[1] else None,
                "status": r[2],
                "created_at": r[3].isoformat() if r[3] else None,
                "updated_at": r[4].isoformat() if r[4] else None,
                "review_notes": r[5],
                "medicine_name": r[6],
                "created_by": str(r[7]) if r[7] else None,
            }
            for r in rows
        ]
    except SQLAlchemyError as e:
        logger.error(f"list_drafts DB error: {e}", exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


@router.post("/drafts/{draft_id}/submit")
def submit_draft(request: Request, draft_id: str, admin: dict = Depends(get_admin_user)):
    if admin["role"] not in ("superuser", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")
    return _transition_draft(request, draft_id, "pending_review", admin, "submit_draft",
                             allowed_from=("draft",))


@router.post("/drafts/{draft_id}/approve")
def approve_draft(
    request: Request,
    draft_id: str,
    body: ReviewAction = ReviewAction(),
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor"):
        raise HTTPException(status_code=403, detail="Requires reviewer role or higher")
    return _transition_draft(request, draft_id, "approved", admin, "approve_draft",
                             notes=body.review_notes, allowed_from=("pending_review",))


@router.post("/drafts/{draft_id}/reject")
def reject_draft(
    request: Request,
    draft_id: str,
    body: ReviewAction = ReviewAction(),
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor"):
        raise HTTPException(status_code=403, detail="Requires reviewer role or higher")
    return _transition_draft(request, draft_id, "rejected", admin, "reject_draft",
                             notes=body.review_notes, allowed_from=("pending_review",))


@router.post("/drafts/{draft_id}/publish")
def publish_draft(request: Request, draft_id: str, admin: dict = Depends(get_admin_user)):
    if admin["role"] not in ("superuser", "editor"):
        raise HTTPException(status_code=403, detail="Requires reviewer role or higher")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            draft = conn.execute(
                text("SELECT id, pill_id, draft_data, status FROM pill_drafts WHERE id = :id LIMIT 1"),
                {"id": draft_id},
            ).fetchone()
            if not draft:
                raise HTTPException(status_code=404, detail="Draft not found")
            if draft[3] != "approved":
                raise HTTPException(
                    status_code=400,
                    detail=f"Draft must be approved before publishing (current: {draft[3]}). "
                           "Use /approve first.",
                )

            pill_id_raw = draft[1]
            draft_data = draft[2] if isinstance(draft[2], dict) else json.loads(draft[2])

            # Sanitize all values the same way the admin pill routes do
            sanitized = {k: _sanitize(v) for k, v in draft_data.items()} if draft_data else {}

            if pill_id_raw is None:
                # Draft for a brand-new pill (e.g. from bulk upload). Insert into pillfinder.
                insert_data = {k: v for k, v in sanitized.items() if k in PUBLISHABLE_FIELDS}
                if not insert_data:
                    raise HTTPException(
                        status_code=400,
                        detail="Draft contains no publishable fields. Cannot create a pill row.",
                    )
                insert_data["published"] = True
                insert_data["updated_by"] = str(admin["id"])
                cols = ", ".join(insert_data.keys())
                vals = ", ".join(f":{k}" for k in insert_data.keys())
                new_pill = conn.execute(
                    text(f"INSERT INTO pillfinder ({cols}) VALUES ({vals}) RETURNING id"),
                    insert_data,
                ).fetchone()
                pill_id = str(new_pill[0]) if new_pill else None
                # Link the draft back to the newly created pill
                if pill_id:
                    conn.execute(
                        text("UPDATE pill_drafts SET pill_id = :pill_id WHERE id = :id"),
                        {"pill_id": pill_id, "id": draft_id},
                    )
            else:
                pill_id = str(pill_id_raw)
                # Apply draft_data to existing pillfinder row and mark as published
                publishable = {k: v for k, v in sanitized.items() if k in PUBLISHABLE_FIELDS}
                if not publishable:
                    raise HTTPException(
                        status_code=400,
                        detail="Draft contains no publishable fields. Nothing to apply.",
                    )
                set_parts = [f"{k} = :{k}" for k in publishable.keys()]
                set_parts.append("updated_at = now()")
                set_parts.append("updated_by = :updated_by_id")
                set_parts.append("published = true")
                params = dict(publishable)
                params["updated_by_id"] = str(admin["id"])
                params["pill_id"] = pill_id
                conn.execute(
                    text(f"UPDATE pillfinder SET {', '.join(set_parts)} WHERE id = :pill_id"),
                    params,
                )

            conn.execute(
                text("""
                    UPDATE pill_drafts
                    SET status = 'published', published_at = now(), published_by = :published_by, updated_at = now()
                    WHERE id = :id
                """),
                {"id": draft_id, "published_by": str(admin["id"])},
            )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="publish",
                entity_type="draft",
                entity_id=draft_id,
                metadata={"pill_id": pill_id},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"published": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"publish_draft DB error: {e}", exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")


VALID_DRAFT_STATUSES = frozenset(("draft", "pending_review", "approved", "published", "rejected"))


def _transition_draft(
    request: Request,
    draft_id: str,
    new_status: str,
    admin: dict,
    action_name: str,
    notes: Optional[str] = None,
    allowed_from: Optional[tuple] = None,
):
    # Validate that all status values are known (defence against programming errors)
    if allowed_from:
        unknown = set(allowed_from) - VALID_DRAFT_STATUSES
        if unknown:
            raise ValueError(f"Unknown draft status values in allowed_from: {unknown}")
    if new_status not in VALID_DRAFT_STATUSES:
        raise ValueError(f"Unknown target draft status: {new_status}")

    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.begin() as conn:
            params: dict = {"id": draft_id, "status": new_status}
            note_clause = ""
            if notes is not None:
                note_clause = ", review_notes = :notes"
                params["notes"] = notes

            # Validate current status is in the allowed set (state machine enforcement)
            if allowed_from:
                placeholders = ", ".join(f":af{i}" for i in range(len(allowed_from)))
                params.update({f"af{i}": s for i, s in enumerate(allowed_from)})
                sql = (
                    f"UPDATE pill_drafts SET status = :status, updated_at = now() {note_clause} "
                    f"WHERE id = :id AND status IN ({placeholders}) RETURNING id, status"
                )
            else:
                sql = (
                    f"UPDATE pill_drafts SET status = :status, updated_at = now() {note_clause} "
                    f"WHERE id = :id RETURNING id, status"
                )

            result = conn.execute(text(sql), params)
            row = result.fetchone()
            if not row:
                # Check if the draft exists at all to give a better error
                exists = conn.execute(
                    text("SELECT status FROM pill_drafts WHERE id = :id LIMIT 1"),
                    {"id": draft_id},
                ).fetchone()
                if not exists:
                    raise HTTPException(status_code=404, detail="Draft not found")
                raise HTTPException(
                    status_code=409,
                    detail=f"Invalid state transition: draft is currently '{exists[0]}'. "
                           f"Allowed from: {list(allowed_from)}.",
                )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action=action_name,
                entity_type="draft",
                entity_id=draft_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"updated": True, "status": new_status}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"{action_name} DB error: {e}", exc_info=True)
        root = getattr(e, "orig", None) or e
        raise HTTPException(status_code=500, detail=f"Database error: {root}")
