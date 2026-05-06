"""Admin image upload/management endpoints."""
import io
import os
import re
import logging
import time
import unicodedata
import zipfile
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
MAX_ZIP_SIZE = int(os.getenv("MAX_ZIP_SIZE_MB", "50")) * 1024 * 1024  # default 50 MB
MAX_IMAGES_PER_ZIP = int(os.getenv("MAX_IMAGES_PER_ZIP", "500"))
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "images")

_CONTENT_TYPE_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _generate_slug(name: str) -> str:
    """Mirror the frontend generateSlug(): lowercase, strip diacritics, collapse non-alnum to '-'."""
    if not name:
        return ""
    s = name.lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


def _strip_variant_suffix(stem: str) -> str:
    """Strip a trailing '-<number>' variant suffix, e.g. 'drug-1' → 'drug'."""
    return re.sub(r"-\d+$", "", stem)


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


@router.post("/bulk-images/zip", status_code=200)
async def upload_images_zip(
    request: Request,
    file: UploadFile = File(...),
    admin: dict = Depends(get_admin_user),
):
    """
    Accept a ZIP file, extract images in-memory, match each to a pill by NDC11 /
    slug / medicine_name slug (with variant-suffix stripping), upload to Supabase
    Storage, and append storage paths to pillfinder.image_filename.

    Returns structured JSON with counts and per-file results.
    Does NOT modify the existing single-image upload endpoint behaviour.
    """
    if admin["role"] not in ("superuser", "editor", "reviewer"):
        raise HTTPException(status_code=403, detail="Requires editor role or higher")

    fname = (file.filename or "").lower()
    if not fname.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    content = await file.read()
    if len(content) > MAX_ZIP_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP file too large (max {MAX_ZIP_SIZE // 1024 // 1024} MB)",
        )

    if not zipfile.is_zipfile(io.BytesIO(content)):
        raise HTTPException(status_code=400, detail="File is not a valid ZIP archive")

    zf = zipfile.ZipFile(io.BytesIO(content))

    # Collect only valid image entries (skip directories, hidden files)
    image_entries = [
        name
        for name in zf.namelist()
        if os.path.splitext(name.lower())[1] in ALLOWED_EXTENSIONS
        and os.path.basename(name)
        and not os.path.basename(name).startswith(".")
    ]

    if len(image_entries) > MAX_IMAGES_PER_ZIP:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP contains too many images (max {MAX_IMAGES_PER_ZIP})",
        )

    # ── Load pill lookup tables ────────────────────────────────────────────
    if not database.db_engine:
        database.connect_to_database()

    ndc11_map: dict = {}   # "12345678901" -> row tuple
    slug_map: dict = {}    # "aspirin-500-mg" -> row tuple
    name_slug_map: dict = {}  # generated slug -> row tuple

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, medicine_name, slug, ndc11, image_filename"
                    " FROM pillfinder WHERE deleted_at IS NULL"
                )
            ).fetchall()
    except SQLAlchemyError as e:
        logger.error(f"upload_images_zip DB load error: {e}")
        raise HTTPException(status_code=500, detail="Database error loading pill data")

    for row in rows:
        pill_id_r, medicine_name, slug, ndc11, _image_filename = row
        ndc11_str = str(ndc11).strip() if ndc11 else ""
        if ndc11_str.isdigit() and len(ndc11_str) == 11:
            ndc11_map[ndc11_str] = row
        if slug:
            slug_map[slug.strip().lower()] = row
        if medicine_name:
            ns = _generate_slug(medicine_name)
            if ns:
                name_slug_map.setdefault(ns, row)

    # ── Process each image ─────────────────────────────────────────────────
    results = []
    counts = {
        "total": len(image_entries),
        "matched": 0,
        "uploaded": 0,
        "skipped": 0,
        "failed": 0,
    }
    # Accumulate new paths per pill before writing to DB
    pill_new_paths: dict[str, list[str]] = {}

    for idx, entry_name in enumerate(image_entries):
        basename = os.path.basename(entry_name)
        stem, ext = os.path.splitext(basename)
        ext = ext.lower()

        # ── Match pill ─────────────────────────────────────────────────────
        matched_row = None

        def _lookup(s: str):
            if s.isdigit() and len(s) == 11:
                return ndc11_map.get(s)
            r = slug_map.get(s.lower())
            if r is None:
                r = name_slug_map.get(s.lower())
            return r

        matched_row = _lookup(stem)
        if matched_row is None:
            base_stem = _strip_variant_suffix(stem)
            if base_stem != stem:
                matched_row = _lookup(base_stem)

        if matched_row is None:
            results.append(
                {
                    "filename": basename,
                    "pill_id": None,
                    "storage_path": None,
                    "url": None,
                    "error": "No matching pill found",
                }
            )
            counts["skipped"] += 1
            continue

        counts["matched"] += 1
        pill_id = matched_row[0]

        # ── Read image data ─────────────────────────────────────────────────
        try:
            img_data = zf.read(entry_name)
        except Exception as e:
            results.append(
                {
                    "filename": basename,
                    "pill_id": pill_id,
                    "storage_path": None,
                    "url": None,
                    "error": f"Failed to read from ZIP: {e}",
                }
            )
            counts["failed"] += 1
            continue

        if len(img_data) > MAX_FILE_SIZE:
            results.append(
                {
                    "filename": basename,
                    "pill_id": pill_id,
                    "storage_path": None,
                    "url": None,
                    "error": "Image too large (max 5 MB)",
                }
            )
            counts["failed"] += 1
            continue

        # ── Build storage path ─────────────────────────────────────────────
        # Use millisecond timestamp + index to avoid collisions across batch
        timestamp_ms = int(time.time() * 1000) + idx
        storage_filename = f"{pill_id[:8]}-{timestamp_ms}{ext}"
        storage_path = f"{pill_id}/{storage_filename}"

        content_type = _CONTENT_TYPE_MAP.get(ext, "image/jpeg")
        upload_ok = _supabase_upload(storage_path, img_data, content_type)

        if not upload_ok and SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
            results.append(
                {
                    "filename": basename,
                    "pill_id": pill_id,
                    "storage_path": None,
                    "url": None,
                    "error": "Storage upload failed",
                }
            )
            counts["failed"] += 1
            continue

        from utils import IMAGE_BASE

        image_url = f"{IMAGE_BASE}/{storage_path}"
        results.append(
            {
                "filename": basename,
                "pill_id": pill_id,
                "storage_path": storage_path,
                "url": image_url,
                "error": None,
            }
        )
        counts["uploaded"] += 1
        pill_new_paths.setdefault(pill_id, []).append(storage_path)

    # ── Write DB updates + audit log ───────────────────────────────────────
    if pill_new_paths:
        try:
            with database.db_engine.begin() as conn:
                for pid, new_paths in pill_new_paths.items():
                    existing = conn.execute(
                        text(
                            "SELECT image_filename FROM pillfinder"
                            " WHERE id = :id LIMIT 1"
                        ),
                        {"id": pid},
                    ).fetchone()
                    if not existing:
                        continue

                    old_fn = existing[0] or ""
                    all_paths = [p.strip() for p in old_fn.split(",") if p.strip()] + new_paths
                    new_fn = ",".join(all_paths)

                    conn.execute(
                        text(
                            "UPDATE pillfinder SET image_filename = :fn,"
                            " has_image = 'TRUE', updated_at = now(),"
                            " updated_by = :uid WHERE id = :id"
                        ),
                        {"fn": new_fn, "uid": str(admin["id"]), "id": pid},
                    )

                log_audit(
                    conn,
                    actor_id=admin["id"],
                    actor_email=admin["email"],
                    action="bulk_upload_images_zip",
                    entity_type="image",
                    entity_id=None,
                    metadata={
                        "zip_filename": file.filename,
                        "total": counts["total"],
                        "matched": counts["matched"],
                        "uploaded": counts["uploaded"],
                        "skipped": counts["skipped"],
                        "failed": counts["failed"],
                    },
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )
        except SQLAlchemyError as e:
            logger.error(f"upload_images_zip DB update error: {e}")
            raise HTTPException(status_code=500, detail="Database error during image update")

    return {"counts": counts, "results": results}


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
