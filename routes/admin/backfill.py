"""Admin API endpoints for triggering/previewing backfill jobs.

NDC Backfill Endpoints
----------------------
GET  /api/admin/backfill/ndc/preview
    Dry-run: return what the backfill WOULD change for the next `limit` rows.
    Query params: limit (1-100, default 10)

POST /api/admin/backfill/ndc/run
    Live run: process up to `limit` rows and return summary counts.
    Query params: limit (1-500, default 50), offset (default 0),
                  match (rxcui|name|auto, default auto),
                  sleep_ms (default 250)

Clinical Metadata Backfill Endpoints
-------------------------------------
GET  /api/admin/backfill/clinical/preview
    Dry-run: return per-row diffs for the next `limit` rows without writing.
    Query params: limit (1-100, default 10), offset (default 0),
                  match (rxcui|ndc|auto, default auto),
                  sleep_ms (default 250),
                  only_fields (comma-separated, default all)

POST /api/admin/backfill/clinical/run
    Live run: populate NULL clinical fields for up to `limit` rows.
    Query params: same as preview.

All endpoints require superuser role.
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from typing import Optional

from routes.admin.auth import require_superuser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/backfill/ndc", tags=["admin-backfill"])

# Second router for clinical endpoints (different prefix)
clinical_router = APIRouter(prefix="/api/admin/backfill/clinical", tags=["admin-backfill"])
nadac_history_router = APIRouter(prefix="/api/admin/backfill/nadac-history", tags=["admin-backfill"])


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


# ---------------------------------------------------------------------------
# Clinical metadata backfill endpoints
# ---------------------------------------------------------------------------

_CLINICAL_KNOWN_FIELDS = [
    "dosage_form",
    "route",
    "rx_otc_status",
    "dea_schedule",
    "fda_pharma_class",
    "brand_names",
    "active_ingredients",
    "inactive_ingredients",
]


def _parse_only_fields(only_fields: Optional[str]) -> Optional[list]:
    if not only_fields:
        return None
    fields = [f.strip() for f in only_fields.split(",") if f.strip()]
    invalid = [f for f in fields if f not in _CLINICAL_KNOWN_FIELDS]
    if invalid:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=422,
            detail=f"Unknown field(s): {', '.join(invalid)}. "
                   f"Allowed: {', '.join(_CLINICAL_KNOWN_FIELDS)}",
        )
    return fields or None


@clinical_router.get("/preview")
def preview_clinical_backfill(
    limit: int = Query(10, ge=1, le=100, description="Rows to preview"),
    offset: int = Query(0, ge=0, description="Row offset"),
    match: str = Query("auto", pattern="^(rxcui|ndc|auto)$", description="Match strategy"),
    sleep_ms: int = Query(250, ge=0, le=5000, description="Sleep ms between API calls"),
    only_fields: Optional[str] = Query(
        None, description="Comma-separated field names to populate"
    ),
    admin=Depends(require_superuser),
):
    """Dry-run: return per-row diff JSON for clinical metadata without writing anything."""
    from services.clinical_metadata_backfill import run_backfill

    logger.info(
        "Clinical metadata backfill preview requested by %s (limit=%d offset=%d)",
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
        only_fields=_parse_only_fields(only_fields),
    )
    return summary


@clinical_router.post("/run")
def run_clinical_backfill(
    limit: int = Query(50, ge=1, le=500, description="Rows to process"),
    offset: int = Query(0, ge=0, description="Row offset"),
    match: str = Query("auto", pattern="^(rxcui|ndc|auto)$", description="Match strategy"),
    sleep_ms: int = Query(250, ge=0, le=5000, description="Sleep ms between API calls"),
    only_fields: Optional[str] = Query(
        None, description="Comma-separated field names to populate"
    ),
    admin=Depends(require_superuser),
):
    """Live run: populate NULL clinical metadata fields for up to `limit` rows."""
    from services.clinical_metadata_backfill import run_backfill

    logger.info(
        "Clinical metadata backfill run requested by %s (limit=%d offset=%d)",
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
        only_fields=_parse_only_fields(only_fields),
    )
    return summary


@nadac_history_router.get("/preview")
async def preview_nadac_history_backfill_route(
    weeks: int = Query(52, ge=1, le=52, description="Number of weeks to estimate"),
    limit_ndcs: int = Query(100, ge=1, description="Limit NDCs for estimate"),
    admin=Depends(require_superuser),
):
    from scripts.backfill_nadac_history import preview_nadac_history_backfill

    logger.info(
        "NADAC history backfill preview requested by %s (weeks=%d limit_ndcs=%d)",
        admin.get("email"),
        weeks,
        limit_ndcs,
    )
    return await preview_nadac_history_backfill(weeks=weeks, limit_ndcs=limit_ndcs)


@nadac_history_router.post("/run")
async def run_nadac_history_backfill_route(
    background_tasks: BackgroundTasks,
    weeks: int = Query(52, ge=1, le=52, description="Number of weeks to process"),
    limit_ndcs: int = Query(0, ge=0, description="Limit NDCs (0 = all)"),
    sleep_ms: int = Query(200, ge=0, le=5000, description="Sleep ms between CMS API calls"),
    admin=Depends(require_superuser),
):
    from scripts.backfill_nadac_history import run_nadac_history_backfill

    logger.info(
        "NADAC history backfill run requested by %s (weeks=%d limit_ndcs=%d sleep_ms=%d)",
        admin.get("email"),
        weeks,
        limit_ndcs,
        sleep_ms,
    )
    background_tasks.add_task(
        run_nadac_history_backfill,
        weeks=weeks,
        limit_ndcs=limit_ndcs,
        dry_run=False,
        sleep_ms=sleep_ms,
    )
    return {"status": "started", "weeks": weeks}
