"""Admin user management endpoints (superuser only).

Uses the Supabase Admin API (service_role key) to manage auth.users, then keeps
public.profiles.user_role in sync. The auto-insert trigger on auth.users guarantees
a profiles row exists for every new user (with default role 'reviewer'); we update
it after creation to the requested role.

Required env vars:
  NEXT_PUBLIC_SUPABASE_URL   -- already used everywhere
  SUPABASE_SERVICE_ROLE_KEY  -- must be set on the Render backend
"""
import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user, log_audit, require_superuser, VALID_ROLES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


_BAN_FOREVER = "876600h"  # ~100 years — effectively permanent for Supabase ban_duration


def _auth_headers() -> dict:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    return {"Authorization": f"Bearer {key}", "apikey": key}


def _supabase_url() -> str:
    return os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")


def _sb_get(path: str) -> httpx.Response:
    return httpx.get(f"{_supabase_url()}{path}", headers=_auth_headers(), timeout=10)


def _sb_post(path: str, json: dict) -> httpx.Response:
    return httpx.post(f"{_supabase_url()}{path}", headers=_auth_headers(), json=json, timeout=10)


def _sb_put(path: str, json: dict) -> httpx.Response:
    return httpx.put(f"{_supabase_url()}{path}", headers=_auth_headers(), json=json, timeout=10)


def _sb_delete(path: str) -> httpx.Response:
    return httpx.delete(f"{_supabase_url()}{path}", headers=_auth_headers(), timeout=10)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AdminUserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    role: str = "reviewer"


class AdminUserUpdate(BaseModel):
    role: Optional[str] = None
    disabled: Optional[bool] = None


# ---------------------------------------------------------------------------
# GET /api/admin/me
# ---------------------------------------------------------------------------

@router.get("/me")
def get_me(admin: dict = Depends(get_admin_user)):
    return {
        "id": str(admin["id"]),
        "email": admin["email"],
        "role": admin["role"],
        "full_name": admin.get("full_name"),
    }


# ---------------------------------------------------------------------------
# GET /api/admin/users -- list all users (superuser only)
# ---------------------------------------------------------------------------

@router.get("/users")
def list_users(admin: dict = Depends(require_superuser)):
    url = _supabase_url()
    if not url:
        raise HTTPException(status_code=500, detail="NEXT_PUBLIC_SUPABASE_URL not configured")

    try:
        resp = _sb_get("/auth/v1/admin/users?per_page=1000")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch users from Supabase")
        auth_users = {u["id"]: u for u in resp.json().get("users", [])}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_users Supabase error: {e}")
        raise HTTPException(status_code=502, detail="Supabase API error")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text("SELECT id::text, user_role, full_name FROM profiles")
            ).fetchall()
        profiles = {str(r[0]): {"user_role": r[1], "full_name": r[2]} for r in rows}
    except SQLAlchemyError as e:
        logger.error(f"list_users profiles DB error: {e}")
        profiles = {}

    result = []
    for uid, auth_u in auth_users.items():
        prof = profiles.get(uid, {})
        raw_role = prof.get("user_role") or "reviewer"
        if raw_role == "superadmin":
            raw_role = "superuser"
        result.append({
            "id": uid,
            "email": auth_u.get("email", ""),
            "full_name": prof.get("full_name") or (auth_u.get("user_metadata") or {}).get("full_name"),
            "role": raw_role,
            "created_at": auth_u.get("created_at"),
            "last_sign_in_at": auth_u.get("last_sign_in_at"),
            "disabled": bool(auth_u.get("banned_until")),
            "email_confirmed": bool(auth_u.get("email_confirmed_at")),
        })

    result.sort(key=lambda u: u.get("created_at") or "")
    return result


# ---------------------------------------------------------------------------
# POST /api/admin/users -- create user with password (superuser only)
# ---------------------------------------------------------------------------

@router.post("/users", status_code=201)
def create_user(
    request: Request,
    body: AdminUserCreate,
    admin: dict = Depends(require_superuser),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    if not _supabase_url():
        raise HTTPException(status_code=500, detail="NEXT_PUBLIC_SUPABASE_URL not configured")
    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""):
        raise HTTPException(status_code=500, detail="SUPABASE_SERVICE_ROLE_KEY not configured")

    create_payload: dict = {
        "email": body.email,
        "password": body.password,
        "email_confirm": True,
    }
    if body.full_name:
        create_payload["user_metadata"] = {"full_name": body.full_name}

    try:
        resp = _sb_post("/auth/v1/admin/users", create_payload)
    except Exception as e:
        logger.error(f"create_user Supabase API error: {e}")
        raise HTTPException(status_code=502, detail="Supabase API error")

    if resp.status_code == 422:
        raise HTTPException(status_code=409, detail="Email already exists")
    if resp.status_code not in (200, 201):
        detail = resp.json().get("msg", resp.text)
        raise HTTPException(status_code=502, detail=f"Failed to create user: {detail}")

    new_user = resp.json()
    user_id = new_user.get("id")
    if not user_id:
        raise HTTPException(status_code=502, detail="Supabase did not return user id")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO profiles (id, user_role, full_name)
                    VALUES (:id, :role, :full_name)
                    ON CONFLICT (id) DO UPDATE
                      SET user_role = :role,
                          full_name = COALESCE(:full_name, profiles.full_name)
                """),
                {"id": user_id, "role": body.role, "full_name": body.full_name},
            )
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="create_user",
                entity_type="user",
                entity_id=user_id,
                metadata={"email": body.email, "role": body.role},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
    except SQLAlchemyError as e:
        logger.error(f"create_user profiles DB error: {e}")
        logger.warning(f"Profile role update failed for {user_id}; manual fix may be needed")

    return {"id": user_id, "email": body.email, "role": body.role, "created": True}


# ---------------------------------------------------------------------------
# PATCH /api/admin/users/{user_id} -- update role / disabled flag (superuser)
# ---------------------------------------------------------------------------

@router.patch("/users/{user_id}")
def update_user(
    request: Request,
    user_id: str,
    body: AdminUserUpdate,
    admin: dict = Depends(require_superuser),
):
    # Prevent superuser from demoting their own role
    if body.role is not None and str(user_id) == str(admin["id"]):
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    if body.role is not None and body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    if not _supabase_url():
        raise HTTPException(status_code=500, detail="NEXT_PUBLIC_SUPABASE_URL not configured")

    if body.disabled is not None:
        try:
            ban_payload = {"ban_duration": _BAN_FOREVER if body.disabled else "none"}
            resp = _sb_put(f"/auth/v1/admin/users/{user_id}", ban_payload)
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=502, detail="Failed to update user status in Supabase")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"update_user ban Supabase error: {e}")
            raise HTTPException(status_code=502, detail="Supabase API error")

    if body.role is not None:
        if not database.db_engine:
            database.connect_to_database()
        try:
            with database.db_engine.begin() as conn:
                conn.execute(
                    text("UPDATE profiles SET user_role = :role WHERE id = :id"),
                    {"role": body.role, "id": user_id},
                )
                log_audit(
                    conn,
                    actor_id=admin["id"],
                    actor_email=admin["email"],
                    action="update_user",
                    entity_type="user",
                    entity_id=user_id,
                    diff={"after": body.model_dump(exclude_none=True)},
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
        except SQLAlchemyError as e:
            logger.error(f"update_user profiles DB error: {e}")
            raise HTTPException(status_code=500, detail="Database error")

    return {"updated": True}


# ---------------------------------------------------------------------------
# POST /api/admin/users/{user_id}/reset-password (superuser only)
# ---------------------------------------------------------------------------

@router.post("/users/{user_id}/reset-password")
def reset_password(
    request: Request,
    user_id: str,
    admin: dict = Depends(require_superuser),
):
    if not _supabase_url():
        raise HTTPException(status_code=500, detail="NEXT_PUBLIC_SUPABASE_URL not configured")

    try:
        resp = _sb_get(f"/auth/v1/admin/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch user from Supabase")
        email = resp.json().get("email")
        if not email:
            raise HTTPException(status_code=400, detail="User has no email address")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"reset_password fetch user error: {e}")
        raise HTTPException(status_code=502, detail="Supabase API error")

    try:
        reset_resp = _sb_post("/auth/v1/recover", {"email": email})
        if reset_resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail="Failed to send password reset email")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"reset_password send error: {e}")
        raise HTTPException(status_code=502, detail="Supabase API error")

    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.begin() as conn:
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="reset_password",
                entity_type="user",
                entity_id=user_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
    except Exception:
        pass

    return {"sent": True, "email": email}


# ---------------------------------------------------------------------------
# DELETE /api/admin/users/{user_id} -- permanently delete user (superuser only)
# ---------------------------------------------------------------------------

@router.delete("/users/{user_id}")
def delete_user(
    request: Request,
    user_id: str,
    admin: dict = Depends(require_superuser),
):
    if str(user_id) == str(admin["id"]):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    if not _supabase_url():
        raise HTTPException(status_code=500, detail="NEXT_PUBLIC_SUPABASE_URL not configured")

    try:
        resp = _sb_delete(f"/auth/v1/admin/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        if resp.status_code not in (200, 204):
            raise HTTPException(status_code=502, detail="Failed to delete user from Supabase")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_user Supabase error: {e}")
        raise HTTPException(status_code=502, detail="Supabase API error")

    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.begin() as conn:
            # Also remove from legacy admin_users if present
            conn.execute(text("DELETE FROM admin_users WHERE id = :id"), {"id": user_id})
            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="delete_user",
                entity_type="user",
                entity_id=user_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
    except SQLAlchemyError as e:
        logger.error(f"delete_user DB error (non-fatal): {e}")

    return {"deleted": True}
