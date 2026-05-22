"""POST /api/pill-views – log a pill detail-page view.

Deduplicates same slug + ip_hash within 30 minutes so page reloads
don't spam the table.  Always returns 200 (best-effort).
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

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


def _get_request_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    for part in forwarded_for.split(","):
        candidate = part.strip()
        if candidate:
            return candidate

    client = getattr(request, "client", None)
    host = getattr(client, "host", None)
    if isinstance(host, str):
        host = host.strip()
    return host or None


def get_pill_views_table_status(engine: Any | None = None) -> dict[str, bool | int | None]:
    engine = engine or database.db_engine
    if not engine:
        return {"pill_views_table_exists": False, "row_count": None}

    with engine.connect() as conn:
        table_name = conn.execute(text("SELECT to_regclass('public.pill_views')")).scalar()
        if table_name is None:
            return {"pill_views_table_exists": False, "row_count": None}

        row_count = conn.execute(text("SELECT COUNT(*) FROM public.pill_views")).scalar()
        return {
            "pill_views_table_exists": True,
            "row_count": int(row_count or 0),
        }


@router.post("/api/pill-views")
def record_pill_view(body: PillViewBody, request: Request) -> dict:
    """Insert a row into pill_views with IP-hash dedup."""
    slug = None
    try:
        slug = body.slug.strip()
        if not slug:
            return {"ok": True, "recorded": False}

        ip_hash = _hash_ip(_get_request_ip(request))

        if not database.db_engine and not database.connect_to_database():
            return {"ok": True, "recorded": False}

        engine = database.db_engine
        if not engine:
            return {"ok": True, "recorded": False}

        try:
            with engine.connect() as conn:
                # Dedup: skip if same slug+ip_hash was logged within the window
                if ip_hash:
                    cutoff = datetime.now(timezone.utc) - timedelta(minutes=_DEDUP_WINDOW_MINUTES)
                    existing = conn.execute(
                        text(
                            "SELECT 1 FROM public.pill_views "
                            "WHERE slug = :slug AND ip_hash = :ip_hash AND viewed_at >= :cutoff "
                            "LIMIT 1"
                        ),
                        {"slug": slug, "ip_hash": ip_hash, "cutoff": cutoff},
                    ).fetchone()
                    if existing:
                        return {"ok": True, "recorded": False}

                conn.execute(
                    text(
                        "INSERT INTO public.pill_views (slug, ip_hash, viewed_at) "
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
            logger.warning(
                "pill-views insert failed (best-effort): slug=%s db_engine_available=%s exception_type=%s error=%s",
                slug,
                bool(engine),
                type(exc).__name__,
                exc,
            )
            return {"ok": True, "recorded": False}
    except SQLAlchemyError as exc:
        logger.warning(
            "pill-views insert failed (best-effort): slug=%s db_engine_available=%s exception_type=%s error=%s",
            slug,
            bool(database.db_engine),
            type(exc).__name__,
            exc,
        )
        return {"ok": True, "recorded": False}
    except Exception as exc:
        logger.warning(
            "pill-views unexpected failure context: slug=%s db_engine_available=%s exception_type=%s",
            slug,
            bool(database.db_engine),
            type(exc).__name__,
        )
        logger.exception("pill-views unexpected failure (best-effort)")
        return {"ok": True, "recorded": False}
