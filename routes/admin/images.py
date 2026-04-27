"""Admin image upload/management endpoints."""
import os
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user, log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/pills", tags=["admin-images"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "images")


def _supabase_upload(path: str, data: bytes, content_type: str) -> bool:
    """Upload a file to Supabase Storage. Returns True on success."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.warning("Supabase credentials not configured — skipping storage upload")
        return False
    try:
        import httpx
        resp = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{path}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": content_type,
            },
            content=data,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return True
        logger.error(f"Supabase upload failed: {resp.status_code} {resp.text}")
        return False
    except Exception as e:
        logger.error(f"Supabase upload error: {e}")
        return False


@router.post("/{pill_id}/images")
async def upload_image(
    request: Request,
    pill_id: str,
    file: UploadFile = File(...),
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Invalid file type. Allowed: {ALLOWED_EXTENSIONS}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    import time
    timestamp = int(time.time())
    filename = f"{pill_id[:8]}-{timestamp}{ext}"
    storage_path = f"{pill_id}/{filename}"

    content_type = file.content_type or "image/jpeg"
    upload_ok = _supabase_upload(storage_path, content, content_type)
    if not upload_ok and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        # Credentials are configured but upload failed — abort to avoid a broken image reference
        raise HTTPException(status_code=502, detail="Image upload to storage failed. Please try again.")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            existing = conn.execute(
                text("SELECT image_filename FROM pillfinder WHERE id = :id LIMIT 1"),
                {"id": pill_id},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Pill not found")

            old_filenames = existing[0] or ""
            new_filenames = (old_filenames + "," + storage_path).strip(",") if old_filenames else storage_path

            conn.execute(
                text(
                    "UPDATE pillfinder SET image_filename = :fn, has_image = 'TRUE',"
                    " updated_at = now(), updated_by = :uid WHERE id = :id"
                ),
                {"fn": new_filenames, "uid": str(admin["id"]), "id": pill_id},
            )

            from utils import IMAGE_BASE
            image_url = f"{IMAGE_BASE}/{storage_path}"

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="upload_image",
                entity_type="image",
                entity_id=pill_id,
                metadata={"filename": filename, "url": image_url},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"filename": storage_path, "url": image_url}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"upload_image DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")


@router.delete("/{pill_id}/images/{filename:path}")
def delete_image(
    request: Request,
    pill_id: str,
    filename: str,
    admin: dict = Depends(get_admin_user),
):
    if admin["role"] not in ("superuser", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    # Move to deleted/ prefix in Supabase Storage.
    # `filename` may be the full storage path (new format: pill_id/bare_filename)
    # or a bare filename (legacy format). Use it directly as the source key.
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            import httpx
            httpx.post(
                f"{SUPABASE_URL}/storage/v1/object/move",
                headers={
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "bucketId": STORAGE_BUCKET,
                    "sourceKey": filename,
                    "destinationKey": f"deleted/{filename}",
                },
                timeout=10,
            )
        except Exception as e:
            logger.warning(f"Could not move image to deleted/: {e}")

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.begin() as conn:
            existing = conn.execute(
                text("SELECT image_filename FROM pillfinder WHERE id = :id LIMIT 1"),
                {"id": pill_id},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Pill not found")

            filenames = [f.strip() for f in (existing[0] or "").split(",") if f.strip() != filename]
            new_fn = ",".join(filenames)
            has_image = "TRUE" if filenames else "FALSE"

            conn.execute(
                text(
                    "UPDATE pillfinder SET image_filename = :fn, has_image = :hi,"
                    " updated_at = now(), updated_by = :uid WHERE id = :id"
                ),
                {"fn": new_fn, "hi": has_image, "uid": str(admin["id"]), "id": pill_id},
            )

            log_audit(
                conn,
                actor_id=admin["id"],
                actor_email=admin["email"],
                action="delete_image",
                entity_type="image",
                entity_id=pill_id,
                metadata={"filename": filename},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )

        return {"deleted": True}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"delete_image DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
