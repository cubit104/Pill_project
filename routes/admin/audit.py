"""Admin audit log endpoints."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/audit", tags=["admin-audit"])


@router.get("")
def get_audit_log(
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    actor_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    admin: dict = Depends(get_admin_user),
):
    if not database.db_engine:
        database.connect_to_database()

    filters = []
    params: dict = {"limit": limit, "offset": offset}
    if entity_type:
        filters.append("entity_type = :entity_type")
        params["entity_type"] = entity_type
    if entity_id:
        filters.append("entity_id = :entity_id")
        params["entity_id"] = entity_id
    if actor_id:
        filters.append("actor_id = :actor_id")
        params["actor_id"] = actor_id
    if action:
        filters.append("action = :action")
        params["action"] = action

    where = "WHERE " + " AND ".join(filters) if filters else ""

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(f"""
                    SELECT id, occurred_at, actor_id, actor_email, action,
                           entity_type, entity_id, diff, metadata
                    FROM audit_log {where}
                    ORDER BY occurred_at DESC
                    LIMIT :limit OFFSET :offset
                """),
                params,
            ).fetchall()

        return [
            {
                "id": r[0],
                "occurred_at": r[1].isoformat() if r[1] else None,
                "actor_id": str(r[2]) if r[2] else None,
                "actor_email": r[3],
                "action": r[4],
                "entity_type": r[5],
                "entity_id": r[6],
                "diff": r[7],
                "metadata": r[8],
            }
            for r in rows
        ]
    except SQLAlchemyError as e:
        logger.error(f"get_audit_log DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
