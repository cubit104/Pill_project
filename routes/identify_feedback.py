"""Learning-loop feedback for camera identification.

POST /api/identify/feedback
    {"capture_id": "...", "verdict": "up" | "down", "chosen_slug": "...", "corrected_imprint": "..."}

Rows are created by /api/identify/photo (one per identification); this
endpoint only records the user's verdict. Consented photos live in the
private storage bucket `user_pill_photos` (uploaded by the photo endpoint).
"""

import json
import logging
import os
import uuid

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import database

logger = logging.getLogger(__name__)
router = APIRouter()

PHOTO_BUCKET = os.getenv("PILL_USER_PHOTO_BUCKET", "user_pill_photos")
# Abuse limits for consented photo retention.
MAX_CONSENT_UPLOADS_PER_DAY = int(os.getenv("PILL_CONSENT_UPLOADS_PER_DAY", "500"))
STORED_PHOTO_MAX_SIDE = 1600  # px; stored photos are re-encoded JPEGs, never raw uploads


class Feedback(BaseModel):
    capture_id: uuid.UUID
    verdict: str = Field(pattern="^(up|down)$")
    chosen_slug: str | None = Field(default=None, max_length=300)
    corrected_imprint: str | None = Field(default=None, max_length=80)


def record_capture(
    imprint_read: str,
    tokens: list[str],
    attrs_guess: dict,
    top_slugs: list[str],
    consent: bool,
    photos: list[bytes],
) -> str | None:
    """Insert one identify_feedback row, then (with consent) attach photos.

    The row is written first so an upload can never leave orphaned objects;
    if the upload fails the row simply has no photos. Never raises.
    """
    capture_id = str(uuid.uuid4())
    try:
        if not database.db_engine and not database.connect_to_database():
            return None
        with database.db_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO identify_feedback "
                    "(capture_id, imprint_read, tokens, attrs_guess, top_slugs, consent) "
                    "VALUES (CAST(:id AS uuid), :read, CAST(:tokens AS jsonb), CAST(:attrs AS jsonb), "
                    "CAST(:top AS jsonb), :consent)"
                ),
                {
                    "id": capture_id,
                    "read": imprint_read or None,
                    "tokens": json.dumps(tokens),
                    "attrs": json.dumps(attrs_guess or {}),
                    "top": json.dumps(top_slugs[:6]),
                    "consent": bool(consent),
                },
            )
    except Exception as e:  # feedback must never break identification
        logger.warning("identify_feedback insert failed: %s", e)
        return None

    if consent and photos and _consent_quota_available():
        paths = _upload_photos(capture_id, photos)
        if paths:
            try:
                with database.db_engine.begin() as conn:
                    conn.execute(
                        text("UPDATE identify_feedback SET photo_paths = CAST(:paths AS jsonb) "
                             "WHERE capture_id = CAST(:id AS uuid)"),
                        {"paths": json.dumps(paths), "id": capture_id},
                    )
            except Exception as e:
                logger.warning("identify_feedback photo_paths update failed: %s", e)
    return capture_id


def _consent_quota_available() -> bool:
    """Cap how many consented photo sets are stored per day (abuse guard)."""
    try:
        with database.db_engine.connect() as conn:
            n = conn.execute(
                text("SELECT count(*) FROM identify_feedback "
                     "WHERE photo_paths IS NOT NULL AND created_at > now() - interval '1 day'")
            ).scalar() or 0
        if n >= MAX_CONSENT_UPLOADS_PER_DAY:
            logger.warning("consent photo quota reached (%d/day); skipping upload", n)
            return False
        return True
    except Exception:
        return False


def _bounded_jpeg(raw: bytes) -> bytes | None:
    """Re-encode to a modest JPEG so stored photos are small and safe."""
    import io

    from PIL import Image

    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        img.thumbnail((STORED_PHOTO_MAX_SIDE, STORED_PHOTO_MAX_SIDE))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88, optimize=True)
        return buf.getvalue()
    except Exception:
        return None


def _upload_photos(capture_id: str, photos: list[bytes]) -> list[str]:
    base = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        return []
    paths = []
    for i, raw in enumerate(photos[:2], start=1):
        raw = _bounded_jpeg(raw)
        if not raw:
            continue
        path = f"{capture_id}/side{i}.jpg"
        try:
            r = requests.post(
                f"{base}/storage/v1/object/{PHOTO_BUCKET}/{path}",
                headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "image/jpeg"},
                data=raw,
                timeout=30,
            )
            if r.status_code in (200, 201):
                paths.append(path)
            else:
                logger.warning("photo upload failed %s: %s", r.status_code, r.text[:120])
        except Exception as e:
            logger.warning("photo upload error: %s", e)
    return paths


@router.post("/api/identify/feedback")
def submit_feedback(payload: Feedback):
    from routes.site_settings import read_flags

    if not read_flags().get("photo_id_enabled"):
        raise HTTPException(status_code=404, detail="Photo identification is not enabled")
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    try:
        with database.db_engine.begin() as conn:
            res = conn.execute(
                text(
                    "UPDATE identify_feedback SET verdict = :v, chosen_slug = :slug, "
                    "corrected_imprint = :imp WHERE capture_id = CAST(:id AS uuid)"
                ),
                {
                    "v": payload.verdict,
                    "slug": payload.chosen_slug,
                    "imp": payload.corrected_imprint,
                    "id": str(payload.capture_id),
                },
            )
    except Exception as e:
        logger.warning("feedback update failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not save feedback")
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Unknown capture")
    return {"ok": True}
