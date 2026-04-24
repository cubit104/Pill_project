"""Admin authentication helpers for FastAPI admin routes."""
import os
import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import text
import database

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Critical fields requiring reviewer role
CRITICAL_FIELDS = {
    "spl_strength",
    "spl_ingredients",
    "dea_schedule_name",
    "pharmclass_fda_epc",
    "dosage_form",
    "route",
}

# Roles recognised by the new profiles-based system and the legacy admin_users table.
# Treat 'superadmin' (legacy) as equivalent to 'superuser' everywhere.
VALID_ROLES = ("superuser", "editor", "reviewer")
_SUPERUSER_ALIASES = frozenset({"superuser", "superadmin"})


def _verify_jwt(token: str) -> Optional[dict]:
    """Verify Supabase JWT and return payload. Returns None if invalid."""
    if not token:
        return None
    try:
        import httpx
        resp = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_SERVICE_ROLE_KEY},
            timeout=5,
        )
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        logger.warning(f"JWT verification failed: {e}")
        return None


def _normalise_role(raw_role: Optional[str]) -> str:
    """Map legacy 'superadmin' → 'superuser'; pass other values through."""
    if raw_role == "superadmin":
        return "superuser"
    return raw_role or "reviewer"


def get_admin_user(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Dependency: extract + verify Supabase JWT, then resolve role.

    Role resolution order (first match wins):
    1. ``public.profiles.user_role``  (new Supabase-native table, roles: superuser/editor/reviewer)
    2. ``public.admin_users.role``    (legacy table, backward compatibility)

    Returns a dict with keys: id, email, role, full_name, is_active, _token.
    Raises 401/403 on failure.
    """
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if not token:
        cookie_name = os.getenv("ADMIN_SESSION_COOKIE_NAME", "pillseek_admin_session")
        cookie = request.cookies.get(cookie_name)
        if cookie:
            token = cookie

    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    user_payload = _verify_jwt(token)
    if not user_payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = user_payload.get("id")
    email = user_payload.get("email", "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Check if user is banned (Supabase sets banned_until for disabled users)
    banned_until = user_payload.get("banned_until")
    if banned_until:
        raise HTTPException(status_code=403, detail="Admin account is deactivated")

    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database unavailable")

    role: Optional[str] = None
    full_name: Optional[str] = None
    is_active: bool = True

    # 1. Try profiles table (new, Supabase-native)
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("SELECT user_role FROM profiles WHERE id = :id LIMIT 1"),
                {"id": user_id},
            ).fetchone()
            if row:
                role = _normalise_role(row[0])
    except Exception as e:
        logger.debug(f"profiles lookup failed (will try admin_users): {e}")

    # 2. Fall back to legacy admin_users table
    if role is None:
        try:
            with database.db_engine.connect() as conn:
                row = conn.execute(
                    text("SELECT role, full_name, is_active FROM admin_users WHERE id = :id LIMIT 1"),
                    {"id": user_id},
                ).fetchone()
                if row:
                    role = _normalise_role(row[0])
                    full_name = row[1]
                    is_active = bool(row[2])
        except Exception as e:
            logger.debug(f"admin_users lookup failed: {e}")

    if role is None:
        raise HTTPException(status_code=403, detail="Not an admin user")

    if not is_active:
        raise HTTPException(status_code=403, detail="Admin account is deactivated")

    return {
        "id": user_id,
        "email": email,
        "role": role,
        "full_name": full_name,
        "is_active": is_active,
        "_token": token,
    }


def require_role(*roles: str):
    """Returns a FastAPI dependency that requires one of the given roles."""
    def _dep(admin: dict = Depends(get_admin_user)) -> dict:
        # Accept both 'superuser' and 'superadmin' when 'superuser' is in roles list
        effective_roles = set(roles)
        if "superuser" in effective_roles:
            effective_roles.add("superadmin")
        if admin.get("role") not in effective_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {', '.join(roles)}. Your role: {admin.get('role')}",
            )
        return admin
    return _dep


def require_superuser(admin: dict = Depends(get_admin_user)) -> dict:
    """Dependency: requires superuser (or legacy superadmin) role."""
    if admin.get("role") not in _SUPERUSER_ALIASES:
        raise HTTPException(
            status_code=403,
            detail=f"Requires superuser role. Your role: {admin.get('role')}",
        )
    return admin


def get_current_user_role(admin: dict = Depends(get_admin_user)) -> str:
    """Dependency helper: returns the caller's normalised role string."""
    return admin["role"]


def is_superuser(role: str) -> bool:
    """Return True if role is superuser or its legacy alias."""
    return role in _SUPERUSER_ALIASES


def log_audit(
    conn,
    actor_id: str,
    actor_email: str,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    diff: Optional[dict] = None,
    metadata: Optional[dict] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
):
    """Insert a row into audit_log. Call within an existing DB connection."""
    import json
    try:
        conn.execute(
            text("""
                INSERT INTO audit_log
                  (actor_id, actor_email, action, entity_type, entity_id, diff, metadata, ip_address, user_agent)
                VALUES
                  (:actor_id, :actor_email, :action, :entity_type, :entity_id,
                   CAST(:diff AS jsonb), CAST(:metadata AS jsonb), CAST(:ip AS inet), :user_agent)
            """),
            {
                "actor_id": str(actor_id),
                "actor_email": actor_email,
                "action": action,
                "entity_type": entity_type,
                "entity_id": str(entity_id) if entity_id else None,
                "diff": json.dumps(diff) if diff else None,
                "metadata": json.dumps(metadata) if metadata else None,
                "ip": ip_address,
                "user_agent": user_agent,
            },
        )
    except Exception as e:
        logger.error(f"Failed to write audit log: {e}")
