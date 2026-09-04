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


class Feedback(BaseModel):
    capture_id: str = Field(min_length=8, max_length=64)
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
    """Insert one identify_feedback row (+ consented photos). Never raises."""
    capture_id = str(uuid.uuid4())
    paths: list[str] = []
    if consent and photos:
        paths = _upload_photos(capture_id, photos)
    try:
        if not database.db_engine and not database.connect_to_database():
            return None
        with database.db_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO identify_feedback "
                    "(capture_id, imprint_read, tokens, attrs_guess, top_slugs, consent, photo_paths) "
                    "VALUES (CAST(:id AS uuid), :read, CAST(:tokens AS jsonb), CAST(:attrs AS jsonb), "
                    "CAST(:top AS jsonb), :consent, CAST(:paths AS jsonb))"
                ),
                {
                    "id": capture_id,
                    "read": imprint_read or None,
                    "tokens": json.dumps(tokens),
                    "attrs": json.dumps(attrs_guess or {}),
                    "top": json.dumps(top_slugs[:6]),
                    "consent": bool(consent),
                    "paths": json.dumps(paths) if paths else None,
                },
            )
        return capture_id
    except Exception as e:  # feedback must never break identification
        logger.warning("identify_feedback insert failed: %s", e)
        return None


def _upload_photos(capture_id: str, photos: list[bytes]) -> list[str]:
    base = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        return []
    paths = []
    for i, raw in enumerate(photos[:2], start=1):
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
                    "id": payload.capture_id,
                },
            )
    except Exception as e:
        logger.warning("feedback update failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not save feedback")
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Unknown capture")
    return {"ok": True}
