"""Private storage helpers for consented user pill photos (bucket user_pill_photos).

Uploads happen in routes/identify_feedback.py. This module covers what the
admin review needs on top of that: short-lived signed URLs so reviewers can
see photos that are never public, and deletion when a capture is judged
unusable or removed. Everything goes through the Supabase Storage REST API
with the service key, exactly like the upload does.
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

PHOTO_BUCKET = os.getenv("PILL_USER_PHOTO_BUCKET", "user_pill_photos")
VIEW_TTL_S = 60 * 60  # reviewer looking at a photo in the admin
EXPORT_TTL_S = 7 * 24 * 60 * 60  # training manifest: long enough to run a Colab session


def _conn() -> tuple[str, str]:
    base = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    return base, os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _headers(key: str) -> dict:
    return {"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"}


def sign_urls(paths: list[str], expires_in: int = VIEW_TTL_S) -> dict[str, str]:
    """Map storage path -> signed https URL. Paths that fail are simply absent."""
    base, key = _conn()
    paths = [p for p in dict.fromkeys(paths) if p]
    if not base or not key or not paths:
        return {}
    out: dict[str, str] = {}
    for i in range(0, len(paths), 100):
        chunk = paths[i : i + 100]
        try:
            r = requests.post(
                f"{base}/storage/v1/object/sign/{PHOTO_BUCKET}",
                headers=_headers(key),
                json={"expiresIn": int(expires_in), "paths": chunk},
                timeout=15,
            )
        except Exception as e:
            logger.warning("photo sign request failed: %s", e)
            continue
        if r.status_code != 200:
            logger.warning("photo sign failed %s: %s", r.status_code, r.text[:160])
            continue
        for item in r.json() if isinstance(r.json(), list) else []:
            signed = item.get("signedURL") if isinstance(item, dict) else None
            if not signed or item.get("error"):
                continue
            url = signed if signed.startswith("http") else f"{base}/storage/v1{signed}"
            out[item.get("path") or ""] = url
    return out


def delete_objects(paths: list[str]) -> bool:
    """Remove photos from the bucket. True when nothing is left to delete."""
    base, key = _conn()
    paths = [p for p in dict.fromkeys(paths) if p]
    if not paths:
        return True
    if not base or not key:
        logger.warning("photo delete skipped: storage credentials not configured")
        return False
    try:
        r = requests.delete(
            f"{base}/storage/v1/object/{PHOTO_BUCKET}",
            headers=_headers(key),
            json={"prefixes": paths},
            timeout=15,
        )
    except Exception as e:
        logger.warning("photo delete error: %s", e)
        return False
    if r.status_code != 200:
        logger.warning("photo delete failed %s: %s", r.status_code, r.text[:160])
        return False
    return True
