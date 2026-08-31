"""Admin reviewer management endpoints."""
import json
import logging
import os
import re
import time
import unicodedata
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user, log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-reviewers"])

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
AVATAR_BUCKET = "reviewer-avatars"
ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2 MB
JSONB_COLUMNS = frozenset({"education", "registrations"})


def _slugify(name: str) -> str:
    """Convert a reviewer name to a URL-safe slug."""
    s = name.lower().strip()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


async def _supabase_upload_avatar(path: str, data: bytes, content_type: str) -> bool:
    """Upload a file to Supabase Storage. Returns True on success."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{SUPABASE_URL}/storage/v1/object/{AVATAR_BUCKET}/{path}",
                headers={
                    "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                content=data,
            )
            return resp.status_code in (200, 201)
    except Exception as exc:
        logger.error("Avatar upload error: %s", exc)
        return False


def _avatar_public_url(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{AVATAR_BUCKET}/{path}"


class EducationItem(BaseModel):
    institution: str = ""
    degree: str = ""
    url: str = ""


class RegistrationItem(BaseModel):
    title: str = ""
    board: str = ""
    url: str = ""


class ReviewerCreate(BaseModel):
    name: str
    credentials: str = ""
    role: str = "medical_reviewer"
    is_public: bool = False
    bio: Optional[str] = None
    specialty: Optional[str] = None
    linkedin_url: Optional[str] = None
    education: list[EducationItem] = Field(default_factory=list)
    registrations: list[RegistrationItem] = Field(default_factory=list)
    same_as: list[str] = Field(default_factory=list)
    license_info: Optional[str] = None


class ReviewerUpdate(BaseModel):
    name: Optional[str] = None
    credentials: Optional[str] = None
    role: Optional[str] = None
    is_public: Optional[bool] = None
    bio: Optional[str] = None
    specialty: Optional[str] = None
    linkedin_url: Optional[str] = None
    education: Optional[list[EducationItem]] = None
    registrations: Optional[list[RegistrationItem]] = None
    same_as: Optional[list[str]] = None
    license_info: Optional[str] = None


def _jsonb_value(items: list[BaseModel]) -> str:
    return json.dumps([item.model_dump() for item in items])


def _set_clause(key: str) -> str:
    if key in JSONB_COLUMNS:
        return f"{key} = CAST(:{key} AS jsonb)"
    return f"{key} = :{key}"


@router.get("/reviewers")
def list_reviewers(admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, name, slug, credentials, role, bio, avatar_url, "
                    "specialty, linkedin_url, education, registrations, same_as, "
                    "license_info, is_public, is_active, created_at, updated_at "
                    "FROM reviewers ORDER BY name"
                )
            ).fetchall()
        return [dict(r._mapping) for r in rows]
    except SQLAlchemyError as exc:
        logger.error("list_reviewers error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/reviewers/{reviewer_id}")
def get_reviewer(reviewer_id: str, admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT id, name, slug, credentials, role, bio, avatar_url, "
                    "specialty, linkedin_url, education, registrations, same_as, "
                    "license_info, is_public, is_active, created_at, updated_at "
                    "FROM reviewers WHERE id = :id LIMIT 1"
                ),
                {"id": reviewer_id},
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Reviewer not found")
        return dict(row._mapping)
    except SQLAlchemyError as exc:
        logger.error("get_reviewer error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/reviewers", status_code=201)
def create_reviewer(
    request: Request,
    body: ReviewerCreate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")

    slug = _slugify(body.name)
    if not slug:
        raise HTTPException(status_code=400, detail="Could not generate slug from name")

    valid_roles = ("author", "medical_reviewer", "editor", "fact_checker")
    if body.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Role must be one of {valid_roles}")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            # Ensure slug uniqueness by appending a counter if needed
            base_slug = slug
            counter = 1
            while conn.execute(
                text("SELECT 1 FROM reviewers WHERE slug = :slug LIMIT 1"),
                {"slug": slug},
            ).fetchone():
                slug = f"{base_slug}-{counter}"
                counter += 1

            row = conn.execute(
                text(
                    "INSERT INTO reviewers ("
                    "name, slug, credentials, role, bio, specialty, linkedin_url, "
                    "education, registrations, same_as, license_info, is_public"
                    ") VALUES ("
                    ":name, :slug, :credentials, :role, :bio, :specialty, :linkedin_url, "
                    "CAST(:education AS jsonb), CAST(:registrations AS jsonb), :same_as, :license_info, :is_public"
                    ") RETURNING id, name, slug, credentials, role, bio, avatar_url, specialty, "
                    "linkedin_url, education, registrations, same_as, license_info, is_public, is_active"
                ),
                {
                    "name": body.name.strip(),
                    "slug": slug,
                    "credentials": body.credentials,
                    "role": body.role,
                    "bio": body.bio,
                    "specialty": body.specialty,
                    "linkedin_url": body.linkedin_url,
                    "education": _jsonb_value(body.education),
                    "registrations": _jsonb_value(body.registrations),
                    "same_as": body.same_as,
                    "license_info": body.license_info,
                    "is_public": body.is_public,
                },
            ).fetchone()

            try:
                log_audit(
                    conn,
                    actor_id=admin["id"],
                    actor_email=admin["email"],
                    action="create_reviewer",
                    entity_type="reviewer",
                    entity_id=str(row._mapping["id"]),
                    diff=body.model_dump(exclude_none=True),
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
            except Exception as audit_exc:
                logger.error("create_reviewer audit log failed: %s", audit_exc)

        return dict(row._mapping)
    except SQLAlchemyError as exc:
        logger.error("create_reviewer error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")


@router.put("/reviewers/{reviewer_id}")
def update_reviewer(
    request: Request,
    reviewer_id: str,
    body: ReviewerUpdate,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    if not database.db_engine:
        database.connect_to_database()

    valid_roles = ("author", "medical_reviewer", "editor", "fact_checker")
    if body.role is not None and body.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Role must be one of {valid_roles}")

    # Whitelist of columns that may be updated to prevent SQL injection
    _UPDATABLE_COLUMNS = frozenset(
        {
            "name",
            "credentials",
            "role",
            "bio",
            "specialty",
            "linkedin_url",
            "education",
            "registrations",
            "same_as",
            "license_info",
            "is_public",
            "slug",
        }
    )

    try:
        with database.db_engine.begin() as conn:
            existing = conn.execute(
                text("SELECT id FROM reviewers WHERE id = :id LIMIT 1"),
                {"id": reviewer_id},
            ).fetchone()
            if existing is None:
                raise HTTPException(status_code=404, detail="Reviewer not found")

            updates = {}
            if body.name is not None:
                updates["name"] = body.name.strip()
                # Regenerate slug when name changes, preserving uniqueness
                new_slug = _slugify(body.name)
                if new_slug:
                    base_slug = new_slug
                    counter = 1
                    while conn.execute(
                        text("SELECT 1 FROM reviewers WHERE slug = :slug AND id != :id LIMIT 1"),
                        {"slug": new_slug, "id": reviewer_id},
                    ).fetchone():
                        new_slug = f"{base_slug}-{counter}"
                        counter += 1
                    updates["slug"] = new_slug
            if body.credentials is not None:
                updates["credentials"] = body.credentials
            if body.role is not None:
                updates["role"] = body.role
            if body.bio is not None:
                updates["bio"] = body.bio
            if body.specialty is not None:
                updates["specialty"] = body.specialty
            if body.linkedin_url is not None:
                updates["linkedin_url"] = body.linkedin_url
            if body.education is not None:
                updates["education"] = _jsonb_value(body.education)
            if body.registrations is not None:
                updates["registrations"] = _jsonb_value(body.registrations)
            if body.same_as is not None:
                updates["same_as"] = body.same_as
            if body.license_info is not None:
                updates["license_info"] = body.license_info
            if body.is_public is not None:
                updates["is_public"] = body.is_public

            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update")

            # Only allow whitelisted columns in the SET clause
            safe_keys = [k for k in updates if k in _UPDATABLE_COLUMNS]
            set_clause = ", ".join(_set_clause(k) for k in safe_keys)
            updates["id"] = reviewer_id
            row = conn.execute(
                text(
                    f"UPDATE reviewers SET {set_clause} WHERE id = :id "
                    "RETURNING id, name, slug, credentials, role, bio, avatar_url, specialty, "
                    "linkedin_url, education, registrations, same_as, license_info, is_public, is_active"
                ),
                updates,
            ).fetchone()

            try:
                log_audit(
                    conn,
                    actor_id=admin["id"],
                    actor_email=admin["email"],
                    action="update_reviewer",
                    entity_type="reviewer",
                    entity_id=reviewer_id,
                    diff=body.model_dump(exclude_none=True),
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
            except Exception as audit_exc:
                logger.error("update_reviewer audit log failed: %s", audit_exc)

        return dict(row._mapping)
    except SQLAlchemyError as exc:
        logger.error("update_reviewer error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")


@router.delete("/reviewers/{reviewer_id}", status_code=204)
def delete_reviewer(
    request: Request,
    reviewer_id: str,
    admin: dict = Depends(get_admin_user),
):
    """Soft-delete a reviewer (sets is_active=false). Superuser only."""
    if admin["role"] != "superuser":
        raise HTTPException(status_code=403, detail="Requires superuser role")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            result = conn.execute(
                text("UPDATE reviewers SET is_active = false WHERE id = :id RETURNING id"),
                {"id": reviewer_id},
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Reviewer not found")

            try:
                log_audit(
                    conn,
                    actor_id=admin["id"],
                    actor_email=admin["email"],
                    action="deactivate_reviewer",
                    entity_type="reviewer",
                    entity_id=reviewer_id,
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
            except Exception as audit_exc:
                logger.error("deactivate_reviewer audit log failed: %s", audit_exc)
    except SQLAlchemyError as exc:
        logger.error("delete_reviewer error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")


@router.post("/reviewers/{reviewer_id}/avatar")
async def upload_avatar(
    request: Request,
    reviewer_id: str,
    file: UploadFile = File(...),
    admin: dict = Depends(get_admin_user),
):
    """Upload a reviewer avatar image."""
    if admin["role"] not in ("superuser", "editor"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {ALLOWED_AVATAR_EXTENSIONS}")

    content = await file.read()
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 2MB)")

    timestamp = int(time.time())
    filename = f"{reviewer_id[:8]}-{timestamp}{ext}"
    storage_path = f"{reviewer_id}/{filename}"
    content_type = file.content_type or "image/jpeg"

    upload_ok = await _supabase_upload_avatar(storage_path, content, content_type)
    if not upload_ok and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=502, detail="Avatar upload to storage failed. Please try again.")

    if upload_ok:
        avatar_url = _avatar_public_url(storage_path)
    else:
        # Local fallback: store path only (no Supabase configured)
        avatar_url = f"/reviewer-avatars/{storage_path}"

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            result = conn.execute(
                text("UPDATE reviewers SET avatar_url = :url WHERE id = :id RETURNING id"),
                {"url": avatar_url, "id": reviewer_id},
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Reviewer not found")
        return {"avatar_url": avatar_url}
    except SQLAlchemyError as exc:
        logger.error("upload_avatar error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")
