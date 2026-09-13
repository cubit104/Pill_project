"""'What's missing?' tags on unpublished pills (Admin -> Drafts).

When a reviewer opens a draft pill and leaves without publishing, they tick
what still needs fixing. The Drafts list shows the row in amber with those
tags; publishing the pill clears them (routes/admin/pills.update_pill).

GET    /api/admin/pills/{pill_id}/review-flags
PUT    /api/admin/pills/{pill_id}/review-flags   {"missing": ["images", "imprint"], "note": "..."}
DELETE /api/admin/pills/{pill_id}/review-flags

Any admin role (reviewer, editor, superuser). Every change is audit-logged.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

import database
from routes.admin.auth import get_admin_user, log_audit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/pills", tags=["admin-review-flags"])

MISSING_KEYS = ("images", "meds_use", "imprint", "other")
EMPTY = {"missing": [], "note": None, "flagged_by": None, "flagged_at": None}


class FlagsUpdate(BaseModel):
    missing: list[str] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=200)


def _db():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    return database.db_engine


def _serialize(row) -> dict:
    return {
        "missing": list(row[0] or []),
        "note": row[1],
        "flagged_by": row[2],
        "flagged_at": row[3].isoformat() if row[3] else None,
    }


@router.get("/{pill_id}/review-flags")
def get_review_flags(pill_id: uuid.UUID, admin: dict = Depends(get_admin_user)):
    with _db().connect() as conn:
        row = conn.execute(
            text("SELECT missing, note, flagged_by, flagged_at FROM pill_review_flags WHERE pill_id = CAST(:id AS uuid)"),
            {"id": str(pill_id)},
        ).fetchone()
    return _serialize(row) if row else dict(EMPTY)


@router.put("/{pill_id}/review-flags")
def set_review_flags(request: Request, pill_id: uuid.UUID, body: FlagsUpdate, admin: dict = Depends(get_admin_user)):
    bad = [k for k in body.missing if k not in MISSING_KEYS]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown tag(s): {', '.join(bad)}. Allowed: {', '.join(MISSING_KEYS)}")
    missing = [k for k in MISSING_KEYS if k in body.missing]  # deduped, fixed order
    note = (body.note or "").strip() or None

    with _db().begin() as conn:
        exists = conn.execute(
            # Tags are for unpublished pills only; the row lock keeps a concurrent publish
            # from clearing the tags a moment before we write them.
            text("SELECT 1 FROM pillfinder WHERE id = CAST(:id AS uuid) AND published = false "
                 "AND deleted_at IS NULL LIMIT 1 FOR UPDATE"),
            {"id": str(pill_id)},
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Pill not found or already published")
        row = conn.execute(
            text(
                "INSERT INTO pill_review_flags (pill_id, missing, note, flagged_by, flagged_at) "
                "VALUES (CAST(:id AS uuid), CAST(:missing AS text[]), :note, :by, now()) "
                "ON CONFLICT (pill_id) DO UPDATE SET missing = EXCLUDED.missing, note = EXCLUDED.note, "
                "flagged_by = EXCLUDED.flagged_by, flagged_at = now() "
                "RETURNING missing, note, flagged_by, flagged_at"
            ),
            {"id": str(pill_id), "missing": missing, "note": note, "by": admin.get("email")},
        ).fetchone()
        log_audit(
            conn,
            actor_id=admin["id"],
            actor_email=admin.get("email", ""),
            action="pill_flagged",
            entity_type="pill",
            entity_id=str(pill_id),
            diff={"missing": missing, "note": note},
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    return _serialize(row)


@router.delete("/{pill_id}/review-flags")
def clear_review_flags(request: Request, pill_id: uuid.UUID, admin: dict = Depends(get_admin_user)):
    with _db().begin() as conn:
        res = conn.execute(
            text("DELETE FROM pill_review_flags WHERE pill_id = CAST(:id AS uuid)"),
            {"id": str(pill_id)},
        )
        if res.rowcount:
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin.get("email", ""),
                action="pill_flags_cleared",
                entity_type="pill",
                entity_id=str(pill_id),
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
    return {"pill_id": str(pill_id), "cleared": bool(res.rowcount)}
