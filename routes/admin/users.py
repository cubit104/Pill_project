"""Admin user management endpoints (superadmin only)."""
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user, log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-users"])

VALID_ROLES = ("superadmin", "editor", "reviewer", "readonly")


class AdminUserCreate(BaseModel):
    email: str
    role: str
    full_name: Optional[str] = None


class AdminUserUpdate(BaseModel):
    role: Optional[str] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/me")
def get_me(admin: dict = Depends(get_admin_user)):
    return {
        "id": str(admin["id"]),
        "email": admin["email"],
        "role": admin["role"],
        "full_name": admin.get("full_name"),
    }


@router.get("/users")
def list_users(admin: dict = Depends(get_admin_user)):
    if admin["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Requires superadmin role")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, email, role, full_name, is_active, created_at, last_login_at"
                    " FROM admin_users ORDER BY created_at"
                )
            ).fetchall()

        return [
            {
                "id": str(r[0]),
                "email": r[1],
                "role": r[2],
                "full_name": r[3],
                "is_active": r[4],
                "created_at": r[5].isoformat() if r[5] else None,
                "last_login_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]
    except SQLAlchemyError as e:
        logger.error(f"list_users DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/users", status_code=201)
def invite_user(
    request: Request,
    body: AdminUserCreate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Requires superadmin role")

    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    # Invite via Supabase Admin API
    user_id = None
    if supabase_url and service_key:
        try:
            import httpx
            resp = httpx.post(
                f"{supabase_url}/auth/v1/admin/users",
                headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
                json={"email": body.email, "email_confirm": True},
                timeout=10,
            )
            if resp.status_code in (200, 201):
                user_id = resp.json().get("id")
        except Exception as e:
            logger.error(f"Supabase invite error: {e}")

    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to create user in Supabase Auth")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO admin_users (id, email, role, full_name)
                    VALUES (:id, :email, :role, :full_name)
                    ON CONFLICT (id) DO UPDATE SET role = :role, full_name = :full_name, is_active = true
                """),
                {"id": user_id, "email": body.email, "role": body.role, "full_name": body.full_name},
            )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="invite_admin",
                entity_type="admin_user",
                entity_id=user_id,
                metadata={"email": body.email, "role": body.role},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"id": user_id, "email": body.email, "role": body.role}
    except SQLAlchemyError as e:
        logger.error(f"invite_user DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.put("/users/{user_id}")
def update_user(
    request: Request,
    user_id: str,
    body: AdminUserUpdate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Requires superadmin role")

    if body.role is not None and body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")

    if not database.db_engine:
        database.connect_to_database()

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"updated": False}

    set_clause = ", ".join(f"{k} = :{k}" for k in updates.keys())
    updates["id"] = user_id

    try:
        with database.db_engine.begin() as conn:
            conn.execute(
                text(f"UPDATE admin_users SET {set_clause} WHERE id = :id"),
                updates,
            )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="update_admin",
                entity_type="admin_user",
                entity_id=user_id,
                diff={"after": body.model_dump(exclude_none=True)},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"updated": True}
    except SQLAlchemyError as e:
        logger.error(f"update_user DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.delete("/users/{user_id}")
def deactivate_user(
    request: Request,
    user_id: str,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Requires superadmin role")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            conn.execute(
                text("UPDATE admin_users SET is_active = false WHERE id = :id"),
                {"id": user_id},
            )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="deactivate_admin",
                entity_type="admin_user",
                entity_id=user_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"deactivated": True}
    except SQLAlchemyError as e:
        logger.error(f"deactivate_user DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
