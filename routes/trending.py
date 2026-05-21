from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()

_CACHE_TTL_SECONDS = 300
_CACHE_LOCK = Lock()
_CACHE: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}
_SLUG_COLUMNS = ("slug", "pill_slug")
_TIMESTAMP_COLUMNS = ("viewed_at", "created_at", "timestamp", "viewed_on", "inserted_at")


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty_payload(days: int) -> dict[str, Any]:
    return {"pills": [], "as_of": _iso_now(), "window_days": days}


def _row_value(row: Any, key: str, index: int) -> Any:
    mapping = getattr(row, "_mapping", None)
    if mapping and key in mapping:
        return mapping[key]
    try:
        return row[index]
    except Exception:
        return None


def _discover_pill_views_columns(conn) -> tuple[str | None, str | None]:
    try:
        rows = conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pill_views'
                """
            )
        ).fetchall()
    except SQLAlchemyError as exc:
        logger.info("Unable to inspect pill_views columns: %s", exc)
        return None, None

    columns = {str(_row_value(row, "column_name", 0)).lower() for row in rows if _row_value(row, "column_name", 0)}
    slug_column = next((column for column in _SLUG_COLUMNS if column in columns), None)
    timestamp_column = next((column for column in _TIMESTAMP_COLUMNS if column in columns), None)
    return slug_column, timestamp_column


def _load_trending_pills(limit: int, days: int) -> list[dict[str, Any]]:
    if not database.db_engine and not database.connect_to_database():
        return []

    window_start = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        with database.db_engine.connect() as conn:
            slug_column, timestamp_column = _discover_pill_views_columns(conn)
            if not slug_column or not timestamp_column:
                return []

            rows = conn.execute(
                text(
                    f"""
                    SELECT
                        stats.slug,
                        pill.medicine_name,
                        pill.spl_strength,
                        pill.splcolor_text,
                        pill.splshape_text,
                        stats.view_count
                    FROM (
                        SELECT
                            {slug_column} AS slug,
                            COUNT(*) AS view_count
                        FROM pill_views
                        WHERE {slug_column} IS NOT NULL
                          AND TRIM(CAST({slug_column} AS TEXT)) <> ''
                          AND {timestamp_column} >= :window_start
                        GROUP BY {slug_column}
                        ORDER BY COUNT(*) DESC, {slug_column}
                        LIMIT :limit
                    ) AS stats
                    LEFT JOIN LATERAL (
                        SELECT
                            medicine_name,
                            spl_strength,
                            splcolor_text,
                            splshape_text
                        FROM pillfinder
                        WHERE deleted_at IS NULL
                          AND published = true
                          AND slug = stats.slug
                        LIMIT 1
                    ) AS pill ON TRUE
                    ORDER BY stats.view_count DESC, stats.slug
                    """
                ),
                {"window_start": window_start, "limit": limit},
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.info("Unable to load trending pills: %s", exc)
        return []

    pills: list[dict[str, Any]] = []
    for rank, row in enumerate(rows, start=1):
        slug = _row_value(row, "slug", 0)
        if not slug:
            continue
        pills.append(
            {
                "slug": str(slug),
                "drug_name": _row_value(row, "medicine_name", 1),
                "strength": _row_value(row, "spl_strength", 2),
                "color": _row_value(row, "splcolor_text", 3),
                "shape": _row_value(row, "splshape_text", 4),
                "view_count": int(_row_value(row, "view_count", 5) or 0),
                "rank": rank,
            }
        )
    return pills


def _get_cached_payload(limit: int, days: int) -> dict[str, Any] | None:
    key = (limit, days)
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if not cached:
            return None
        expires_at, payload = cached
        if expires_at <= now:
            _CACHE.pop(key, None)
            return None
        return payload


def _set_cached_payload(limit: int, days: int, payload: dict[str, Any]) -> None:
    with _CACHE_LOCK:
        _CACHE[(limit, days)] = (time.time() + _CACHE_TTL_SECONDS, payload)


@router.get("/api/trending")
def get_trending(
    limit: int = Query(20, ge=1, le=50),
    days: int = Query(7, ge=1, le=90),
) -> dict[str, Any]:
    cached = _get_cached_payload(limit, days)
    if cached is not None:
        return cached

    payload = _empty_payload(days)
    payload["pills"] = _load_trending_pills(limit, days)
    _set_cached_payload(limit, days, payload)
    return payload
