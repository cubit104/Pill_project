"""Admin API endpoints for triggering/previewing the NDC backfill.

Endpoints
---------
GET  /api/admin/backfill/ndc/preview
    Dry-run: return what the backfill WOULD change for the next `limit` rows.
    Query params: limit (1-100, default 10)

POST /api/admin/backfill/ndc/run
    Live run: process up to `limit` rows and return summary counts.
    Query params: limit (1-500, default 50), offset (default 0),
                  match (rxcui|name|auto, default auto),
                  sleep_ms (default 250)

Both require superuser role.
"""

import logging

from fastapi import APIRouter, Depends, Query

from routes.admin.auth import require_superuser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/backfill/ndc", tags=["admin-backfill"])


@router.get("/preview")
def preview_ndc_backfill(
    limit: int = Query(10, ge=1, le=100, description="Rows to preview"),
    offset: int = Query(0, ge=0, description="Row offset"),
    match: str = Query("auto", pattern="^(rxcui|name|auto)$", description="Match strategy"),
    sleep_ms: int = Query(250, ge=0, le=5000, description="Sleep ms between API calls"),
    admin=Depends(require_superuser),
):
    """Dry-run: return per-row diff JSON for the next `limit` rows without writing anything."""
    from services.ndc_backfill import run_backfill

    logger.info(
        "NDC backfill preview requested by %s (limit=%d offset=%d)",
        admin.get("email"),
        limit,
        offset,
    )

    summary = run_backfill(
        limit=limit,
        offset=offset,
        dry_run=True,
        match_mode=match,
        sleep_ms=sleep_ms,
    )
    return summary


@router.post("/run")
def run_ndc_backfill(
    limit: int = Query(50, ge=1, le=500, description="Rows to process"),
    offset: int = Query(0, ge=0, description="Row offset"),
    match: str = Query("auto", pattern="^(rxcui|name|auto)$", description="Match strategy"),
    sleep_ms: int = Query(250, ge=0, le=5000, description="Sleep ms between API calls"),
    admin=Depends(require_superuser),
):
    """Live run: process up to `limit` rows and return summary counts."""
    from services.ndc_backfill import run_backfill

    logger.info(
        "NDC backfill run requested by %s (limit=%d offset=%d)",
        admin.get("email"),
        limit,
        offset,
    )

    summary = run_backfill(
        limit=limit,
        offset=offset,
        dry_run=False,
        match_mode=match,
        sleep_ms=sleep_ms,
    )
    return summary
