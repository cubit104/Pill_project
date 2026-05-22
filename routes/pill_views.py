"""POST /api/pill-views – log a pill detail-page view.

Deduplicates same slug + ip_hash within 30 minutes so page reloads
don't spam the table.  Always returns 200 (best-effort).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()

_DEDUP_WINDOW_MINUTES = 30


class PillViewBody(BaseModel):
    slug: str = Field(..., min_length=1, max_length=500)


def _hash_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


@router.post("/api/pill-views")
def record_pill_view(body: PillViewBody, request: Request) -> dict:
    """Insert a row into pill_views with IP-hash dedup."""
    slug = body.slug.strip()
    if not slug:
        return {"ok": True, "recorded": False}

    ip_hash = _hash_ip(
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or request.client.host
        if request.client
        else None
    )

    if not database.db_engine and not database.connect_to_database():
        return {"ok": True, "recorded": False}

    try:
        with database.db_engine.connect() as conn:
            # Dedup: skip if same slug+ip_hash was logged within the window
            if ip_hash:
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=_DEDUP_WINDOW_MINUTES)
                existing = conn.execute(
                    text(
                        "SELECT 1 FROM pill_views "
                        "WHERE slug = :slug AND ip_hash = :ip_hash AND viewed_at >= :cutoff "
                        "LIMIT 1"
                    ),
                    {"slug": slug, "ip_hash": ip_hash, "cutoff": cutoff},
                ).fetchone()
                if existing:
                    conn.commit()
                    return {"ok": True, "recorded": False}

            conn.execute(
                text(
                    "INSERT INTO pill_views (slug, ip_hash, viewed_at) "
                    "VALUES (:slug, :ip_hash, :now)"
                ),
                {
                    "slug": slug,
                    "ip_hash": ip_hash,
                    "now": datetime.now(timezone.utc),
                },
            )
            conn.commit()
            return {"ok": True, "recorded": True}
    except SQLAlchemyError as exc:
        logger.warning("pill-views insert failed (best-effort): %s", exc)
        return {"ok": True, "recorded": False}
