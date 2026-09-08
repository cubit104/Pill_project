"""Public member accounts (superuser only).

Members are the people who sign up in the PillSeek app / website for the
medicine cabinet. They are ordinary auth.users rows whose profiles.role is
'member' (the sign-up trigger sets that). This module lets a superuser see
how many there are, when they joined, whether they are active, and how much
they use the cabinet -- but never *what* is in a cabinet. A member's saved
medicines are health data and stay private to them.

Deactivate = permanent Supabase ban (same mechanism as admin users); the
member keeps their data and can be reactivated. Deleting an account is the
member's own action (delete_own_account) or a manual Supabase operation.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import log_audit, require_superuser
from routes.admin.users import _BAN_FOREVER, _sb_put, _supabase_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-members"])

_MEMBER_COLUMNS = """
    u.id::text                                   AS id,
    u.email                                      AS email,
    u.created_at                                 AS created_at,
    u.last_sign_in_at                            AS last_sign_in_at,
    (u.banned_until IS NOT NULL AND u.banned_until > now()) AS disabled,
    COALESCE(c.cabinet_count, 0)                 AS cabinet_count,
    COALESCE(r.reminder_count, 0)                AS reminder_count
"""

_MEMBER_FROM = """
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id AND p.role::text = 'member'
    LEFT JOIN (SELECT user_id, COUNT(*) AS cabinet_count FROM public.cabinet_items GROUP BY user_id) c ON c.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) AS reminder_count FROM public.reminders WHERE enabled GROUP BY user_id) r ON r.user_id = u.id
"""


def _iso(value) -> Optional[str]:
    return value.isoformat() if value is not None and hasattr(value, "isoformat") else value


def _row_to_member(row) -> dict:
    return {
        "id": row[0],
        "email": row[1],
        "created_at": _iso(row[2]),
        "last_sign_in_at": _iso(row[3]),
        "disabled": bool(row[4]),
        "cabinet_count": int(row[5] or 0),
        "reminder_count": int(row[6] or 0),
    }


def _ensure_db():
    if not database.db_engine:
        database.connect_to_database()


@router.get("/members")
def list_members(
    q: str = Query("", max_length=200, description="Filter by email (substring)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_superuser),
):
    """Paged list of public member accounts plus headline counts."""
    _ensure_db()
    q_norm = q.strip().lower()
    where = "WHERE u.email ILIKE :pattern" if q_norm else ""
    params = {"pattern": f"%{q_norm}%"} if q_norm else {}
    try:
        with database.db_engine.connect() as conn:
            totals = conn.execute(
                text(
                    "SELECT COUNT(*),"
                    " COUNT(*) FILTER (WHERE u.banned_until IS NULL OR u.banned_until <= now()),"
                    " COUNT(*) FILTER (WHERE u.created_at >= now() - interval '7 days'),"
                    " COUNT(*) FILTER (WHERE u.last_sign_in_at >= now() - interval '30 days'),"
                    " COUNT(*) FILTER (WHERE COALESCE(c.cabinet_count, 0) > 0)"
                    + _MEMBER_FROM
                )
            ).fetchone()
            rows = conn.execute(
                text(
                    "SELECT" + _MEMBER_COLUMNS + _MEMBER_FROM + where
                    + " ORDER BY u.created_at DESC LIMIT :limit OFFSET :offset"
                ),
                {**params, "limit": limit, "offset": (page - 1) * limit},
            ).fetchall()
            filtered = (
                conn.execute(text("SELECT COUNT(*)" + _MEMBER_FROM + where), params).scalar()
                if q_norm
                else (totals[0] if totals else 0)
            )
    except SQLAlchemyError as e:
        logger.error(f"list_members DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    totals = totals or (0, 0, 0, 0, 0)
    return {
        "summary": {
            "total": int(totals[0] or 0),
            "active": int(totals[1] or 0),
            "new_7d": int(totals[2] or 0),
            "signed_in_30d": int(totals[3] or 0),
            "with_cabinet": int(totals[4] or 0),
        },
        "page": page,
        "limit": limit,
        "filtered": int(filtered or 0),
        "members": [_row_to_member(r) for r in rows],
    }


def _set_member_disabled(request: Request, admin: dict, member_id: str, disabled: bool) -> dict:
    if not _supabase_url():
        raise HTTPException(status_code=500, detail="NEXT_PUBLIC_SUPABASE_URL not configured")
    _ensure_db()
    # Only genuine members can be toggled here; admin accounts go through /users.
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("SELECT u.email" + _MEMBER_FROM + " WHERE u.id = CAST(:id AS uuid)"), {"id": member_id}
            ).fetchone()
    except SQLAlchemyError as e:
        logger.error(f"member lookup DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")

    try:
        resp = _sb_put(f"/auth/v1/admin/users/{member_id}", {"ban_duration": _BAN_FOREVER if disabled else "none"})
    except Exception as e:  # network / httpx errors
        logger.error(f"member ban Supabase error: {e}")
        raise HTTPException(status_code=502, detail="Supabase API error")
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Failed to update member status in Supabase")

    try:
        with database.db_engine.begin() as conn:
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="deactivate_member" if disabled else "reactivate_member",
                entity_type="member",
                entity_id=member_id,
                metadata={"email": row[0]},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
    except SQLAlchemyError as e:  # the ban already happened; audit failure must not hide that
        logger.error(f"member audit DB error: {e}")
    return {"id": member_id, "disabled": disabled}


@router.post("/members/{member_id}/deactivate")
def deactivate_member(request: Request, member_id: str, admin: dict = Depends(require_superuser)):
    """Block the member from signing in (data kept; reversible)."""
    return _set_member_disabled(request, admin, member_id, True)


@router.post("/members/{member_id}/reactivate")
def reactivate_member(request: Request, member_id: str, admin: dict = Depends(require_superuser)):
    return _set_member_disabled(request, admin, member_id, False)
