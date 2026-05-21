from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import String, bindparam, column, func, select, table, text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()

_CACHE_TTL_SECONDS = 300
_CACHE_LOCK = Lock()
_CACHE: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}
_SLUG_COLUMNS = ("slug", "pill_slug")
_TIMESTAMP_COLUMNS = ("viewed_at", "created_at", "timestamp", "viewed_on", "inserted_at")


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty_payload(days: int) -> dict[str, Any]:
    return {"pills": [], "as_of": _utc_iso_now(), "window_days": days}


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


def _validated_identifier(column: str, allowed: tuple[str, ...]) -> str:
    if column not in allowed:
        raise ValueError(f"Unexpected SQL identifier: {column}")
    return column


def _load_trending_pills(limit: int, days: int) -> list[dict[str, Any]]:
    if not database.db_engine and not database.connect_to_database():
        return []

    window_start = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        with database.db_engine.connect() as conn:
            slug_column, timestamp_column = _discover_pill_views_columns(conn)
            if not slug_column or not timestamp_column:
                return []
            safe_slug_column = _validated_identifier(slug_column, _SLUG_COLUMNS)
            safe_timestamp_column = _validated_identifier(timestamp_column, _TIMESTAMP_COLUMNS)
            pill_views = table(
                "pill_views",
                column(safe_slug_column),
                column(safe_timestamp_column),
            )
            slug_col = getattr(pill_views.c, safe_slug_column)
            timestamp_col = getattr(pill_views.c, safe_timestamp_column)

            stats_rows = conn.execute(
                select(
                    slug_col.label("slug"),
                    func.count().label("view_count"),
                )
                .where(slug_col.is_not(None))
                .where(func.trim(func.cast(slug_col, String)) != "")
                .where(timestamp_col >= window_start)
                .group_by(slug_col)
                .order_by(func.count().desc(), slug_col)
                .limit(limit)
            ).fetchall()

            slugs = [str(_row_value(row, "slug", 0)) for row in stats_rows if _row_value(row, "slug", 0)]
            pillfinder = table(
                "pillfinder",
                column("slug"),
                column("medicine_name"),
                column("spl_strength"),
                column("splcolor_text"),
                column("splshape_text"),
                column("deleted_at"),
                column("published"),
            )
            details_by_slug: dict[str, Any] = {}
            if slugs:
                detail_rows = conn.execute(
                    select(
                        pillfinder.c.slug,
                        pillfinder.c.medicine_name,
                        pillfinder.c.spl_strength,
                        pillfinder.c.splcolor_text,
                        pillfinder.c.splshape_text,
                    )
                    .where(pillfinder.c.deleted_at.is_(None))
                    .where(pillfinder.c.published.is_(True))
                    .where(pillfinder.c.slug.in_(bindparam("slugs", expanding=True))),
                    {"slugs": slugs},
                ).fetchall()
                for row in detail_rows:
                    slug = _row_value(row, "slug", 0)
                    if slug and slug not in details_by_slug:
                        details_by_slug[str(slug)] = row
    except SQLAlchemyError as exc:
        logger.info("Unable to load trending pills: %s", exc)
        return []

    pills: list[dict[str, Any]] = []
    for rank, row in enumerate(stats_rows, start=1):
        slug = _row_value(row, "slug", 0)
        if not slug:
            continue
        detail_row = details_by_slug.get(str(slug))
        pills.append(
            {
                "slug": str(slug),
                "drug_name": _row_value(detail_row, "medicine_name", 1) if detail_row else None,
                "strength": _row_value(detail_row, "spl_strength", 2) if detail_row else None,
                "color": _row_value(detail_row, "splcolor_text", 3) if detail_row else None,
                "shape": _row_value(detail_row, "splshape_text", 4) if detail_row else None,
                "view_count": int(_row_value(row, "view_count", 1) or 0),
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


def clear_trending_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


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
