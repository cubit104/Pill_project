"""Admin authentication helpers for FastAPI admin routes."""
import os
import logging
from typing import Optional

from fastapi import Header, HTTPException, Request
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


def get_admin_user(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Dependency: extract + verify Supabase JWT, look up admin_users row.
    Returns the admin_users row dict if valid, raises 401/403 otherwise.
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
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database unavailable")

    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text("SELECT id, email, role, full_name, is_active FROM admin_users WHERE id = :id LIMIT 1"),
                {"id": user_id},
            ).fetchone()
    except Exception as e:
        logger.error(f"Error looking up admin user: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    if not row:
        raise HTTPException(status_code=403, detail="Not an admin user")

    admin = dict(zip(["id", "email", "role", "full_name", "is_active"], row))
    if not admin.get("is_active"):
        raise HTTPException(status_code=403, detail="Admin account is deactivated")

    # Store token for downstream use
    admin["_token"] = token
    return admin


def require_role(*roles: str):
    """Returns a dependency that requires one of the given roles."""
    def _dep(admin: dict = None) -> dict:
        if admin is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if admin.get("role") not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {', '.join(roles)}. Your role: {admin.get('role')}",
            )
        return admin
    return _dep


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
                   :diff::jsonb, :metadata::jsonb, :ip::inet, :user_agent)
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
