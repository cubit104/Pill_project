from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text

import database
from routes.admin.auth import require_superuser
from services.snapshot_resolver import _relation_missing, fetch_attention_rows

router = APIRouter()


def _ensure_db() -> None:
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")


def _serialize_snapshot_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _serialize_snapshot_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _serialize_snapshot_value(value) for key, value in row.items()}


@router.get("/api/snapshot/{slug}")
def get_price_snapshot(slug: str, response: Response):
    _ensure_db()
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT
                      slug,
                      pill_id,
                      resolved_ndc11,
                      match_type,
                      resolved_via,
                      price_per_unit,
                      unit,
                      effective_date,
                      total_acquisition_cost,
                      fair_retail_low,
                      fair_retail_high,
                      history_52w,
                      history_source_ndc,
                      alternatives,
                      is_estimate,
                      estimate_basis,
                      display_disclaimer,
                      schema_offers_valid,
                      resolved_at,
                      resolver_version,
                      resolver_notes,
                      created_at,
                      updated_at
                    FROM public.pill_price_snapshot
                    WHERE slug = :slug
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            ).mappings().first()
    except Exception as exc:
        if _relation_missing(exc):
            raise HTTPException(status_code=404, detail="Snapshot not found")
        raise

    if not row:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=300"
    return _serialize_snapshot_row(dict(row))


@router.get("/api/admin/snapshots/attention")
def get_snapshots_needing_attention(
    limit: int = Query(200, ge=1, le=1000),
    _admin: dict = Depends(require_superuser),
):
    try:
        return {"rows": fetch_attention_rows(limit=limit)}
    except Exception as exc:
        if _relation_missing(exc):
            return {"rows": []}
        raise
