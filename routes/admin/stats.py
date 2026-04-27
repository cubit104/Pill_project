"""Admin dashboard stats endpoint."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-stats"])


@router.get("/stats")
def get_stats(admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            total_pills = conn.execute(
                text("SELECT COUNT(*) FROM pillfinder WHERE deleted_at IS NULL")
            ).scalar() or 0

            unique_drugs = conn.execute(
                text("SELECT COUNT(DISTINCT medicine_name) FROM pillfinder WHERE deleted_at IS NULL")
            ).scalar() or 0

            missing_images = conn.execute(
                text(
                    "SELECT COUNT(*) FROM pillfinder"
                    " WHERE deleted_at IS NULL AND (has_image IS NULL OR has_image != 'TRUE')"
                )
            ).scalar() or 0

            pending_drafts = conn.execute(
                text("SELECT COUNT(*) FROM pill_drafts WHERE status IN ('pending_review', 'draft')")
            ).scalar() or 0

            recent_activity = conn.execute(
                text("""
                    SELECT id, occurred_at, actor_email, action, entity_type, entity_id
                    FROM audit_log ORDER BY occurred_at DESC LIMIT 10
                """)
            ).fetchall()

        return {
            "total_pills": int(total_pills),
            "unique_drugs": int(unique_drugs),
            "missing_images": int(missing_images),
            "pending_drafts": int(pending_drafts),
            "recent_activity": [
                {
                    "id": r[0],
                    "occurred_at": r[1].isoformat() if r[1] else None,
                    "actor_email": r[2],
                    "action": r[3],
                    "entity_type": r[4],
                    "entity_id": r[5],
                }
                for r in recent_activity
            ],
        }
    except SQLAlchemyError as e:
        logger.error(f"get_stats DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
