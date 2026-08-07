"""Admin reviewer management endpoints."""
import logging
import os
import re
import time
import unicodedata
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
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


def _slugify(name: str) -> str:
    """Convert a reviewer name to a URL-safe slug."""
    s = name.lower().strip()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _supabase_upload_avatar(path: str, data: bytes, content_type: str) -> bool:
    """Upload a file to Supabase Storage. Returns True on success."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{SUPABASE_URL}/storage/v1/object/{AVATAR_BUCKET}/{path}",
                headers={
                    "Authorization": f"******",
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


class ReviewerCreate(BaseModel):
    name: str
    credentials: str = ""
    role: str = "medical_reviewer"
    bio: Optional[str] = None
    specialty: Optional[str] = None
    same_as: list[str] = []
    license_info: Optional[str] = None


class ReviewerUpdate(BaseModel):
    name: Optional[str] = None
    credentials: Optional[str] = None
    role: Optional[str] = None
    bio: Optional[str] = None
    specialty: Optional[str] = None
    same_as: Optional[list[str]] = None
    license_info: Optional[str] = None


@router.get("/reviewers")
def list_reviewers(admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, name, slug, credentials, role, bio, avatar_url, "
                    "specialty, same_as, license_info, is_active, created_at, updated_at "
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
                    "specialty, same_as, license_info, is_active, created_at, updated_at "
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
                    "INSERT INTO reviewers (name, slug, credentials, role, bio, specialty, same_as, license_info) "
                    "VALUES (:name, :slug, :credentials, :role, :bio, :specialty, :same_as, :license_info) "
                    "RETURNING id, name, slug, credentials, role, bio, avatar_url, specialty, same_as, license_info, is_active"
                ),
                {
                    "name": body.name.strip(),
                    "slug": slug,
                    "credentials": body.credentials,
                    "role": body.role,
                    "bio": body.bio,
                    "specialty": body.specialty,
                    "same_as": body.same_as,
                    "license_info": body.license_info,
                },
            ).fetchone()

        log_audit(
            admin_id=admin["id"],
            action="create_reviewer",
            resource_type="reviewer",
            resource_id=str(row._mapping["id"]),
            new_values={"name": body.name},
        )
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
        {"name", "credentials", "role", "bio", "specialty", "same_as", "license_info", "slug"}
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
            if body.same_as is not None:
                updates["same_as"] = body.same_as
            if body.license_info is not None:
                updates["license_info"] = body.license_info

            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update")

            # Only allow whitelisted columns in the SET clause
            safe_keys = [k for k in updates if k in _UPDATABLE_COLUMNS]
            set_clause = ", ".join(f"{k} = :{k}" for k in safe_keys)
            updates["id"] = reviewer_id
            row = conn.execute(
                text(
                    f"UPDATE reviewers SET {set_clause} WHERE id = :id "
                    "RETURNING id, name, slug, credentials, role, bio, avatar_url, specialty, same_as, license_info, is_active"
                ),
                updates,
            ).fetchone()

        log_audit(
            admin_id=admin["id"],
            action="update_reviewer",
            resource_type="reviewer",
            resource_id=reviewer_id,
            new_values={k: v for k, v in updates.items() if k != "id"},
        )
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

        log_audit(
            admin_id=admin["id"],
            action="deactivate_reviewer",
            resource_type="reviewer",
            resource_id=reviewer_id,
        )
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

    upload_ok = _supabase_upload_avatar(storage_path, content, content_type)
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
