"""Public pill image redirect endpoint.

GET /api/pill-image/{filename}
    - No auth required — images are public (same as pill detail pages).
    - Looks up any pill whose `image_filename` column contains the given filename.
    - Tries the new-upload URL layout ({IMAGE_BASE}/{pill_id}/{filename}) first.
    - Falls back to the legacy URL layout ({IMAGE_BASE}/{filename}).
    - 302-redirects to the first URL that returns HTTP 200 on a HEAD check.
    - In-memory TTL cache (60 s) avoids repeated HEAD requests for the same filename.
    - Returns 404 with Cache-Control: no-cache when both candidates fail.
"""

import logging
import time
from typing import Dict, Optional, Tuple

from fastapi import APIRouter
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from utils import IMAGE_BASE

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pill-images"])

# ---------------------------------------------------------------------------
# In-memory resolution cache:  filename -> (resolved_url, expires_at)
# ---------------------------------------------------------------------------
_url_cache: Dict[str, Tuple[Optional[str], float]] = {}
_CACHE_TTL = 60.0  # seconds


def _cached_url(filename: str) -> Optional[str]:
    entry = _url_cache.get(filename)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None  # cache miss or expired


def _cache_url(filename: str, url: Optional[str]) -> None:
    _url_cache[filename] = (url, time.monotonic() + _CACHE_TTL)


def _head_ok(url: str) -> bool:
    """Return True if the URL responds with HTTP 200 to a HEAD request."""
    try:
        import httpx
        r = httpx.head(url, follow_redirects=True, timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


def _resolve_url(pill_id: str, filename: str) -> Optional[str]:
    """Determine the correct public URL for a pill image without a HEAD check.

    New-style uploads (via the admin upload endpoint) are stored at
    ``{pill_id}/{filename}`` in Supabase Storage.  The upload code names
    files as ``{pill_id[:8]}-{timestamp}{ext}``, so we can detect them
    by prefix to avoid unnecessary HEAD requests.
    """
    pill_prefix = str(pill_id)[:8] + "-"
    if filename.startswith(pill_prefix):
        # New-style upload — try without a HEAD check first
        return f"{IMAGE_BASE}/{pill_id}/{filename}"

    # Legacy filename — might be either layout; verify with HEAD
    new_url = f"{IMAGE_BASE}/{pill_id}/{filename}"
    legacy_url = f"{IMAGE_BASE}/{filename}"
    if _head_ok(new_url):
        return new_url
    if _head_ok(legacy_url):
        return legacy_url
    return None


@router.get("/api/pill-image/{filename:path}")
def get_pill_image(filename: str):
    """Redirect to the public Supabase Storage URL for a pill image."""
    # Check the in-memory cache first
    cached = _cached_url(filename)
    if cached is not None:
        return RedirectResponse(url=cached, status_code=302)
    if cached == "":  # explicit "not found" cached
        return JSONResponse(
            status_code=404,
            content={"detail": "Image not found"},
            headers={"Cache-Control": "no-cache"},
        )

    if not database.db_engine:
        database.connect_to_database()

    pill_id: Optional[str] = None
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT id FROM pillfinder "
                    "WHERE image_filename LIKE :pat AND deleted_at IS NULL "
                    "LIMIT 1"
                ),
                {"pat": f"%{filename}%"},
            ).fetchone()
            if row:
                pill_id = str(row[0])
    except SQLAlchemyError as e:
        logger.warning(f"get_pill_image DB lookup error for {filename!r}: {e}")

    resolved: Optional[str] = None
    if pill_id:
        resolved = _resolve_url(pill_id, filename)

    if not resolved:
        # Fall back to legacy URL without pill_id context
        legacy_url = f"{IMAGE_BASE}/{filename}"
        if _head_ok(legacy_url):
            resolved = legacy_url

    if resolved:
        _cache_url(filename, resolved)
        return RedirectResponse(url=resolved, status_code=302)

    # Cache the "not found" result to avoid repeated DB + HEAD hits
    _url_cache[filename] = ("", time.monotonic() + _CACHE_TTL)
    return JSONResponse(
        status_code=404,
        content={"detail": "Image not found"},
        headers={"Cache-Control": "no-cache"},
    )
