"""Medication guide API endpoints."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from routes.admin.auth import require_superuser
from services.medication_guide import GuideInternalError, GuideNotFoundError, build_guide
from services.openfda_client import OpenFDAUpstreamError
from services.rxnorm_client import RxNormClient

logger = logging.getLogger(__name__)

router = APIRouter(tags=["medication-guide"])


@router.get("/api/drugs/{rxcui}/guide")
async def get_guide_by_rxcui(rxcui: str):
    """Return medication guide for one RxCUI."""
    try:
        return await build_guide(rxcui=rxcui)
    except GuideNotFoundError as exc:
        return JSONResponse(status_code=404, content={"error": str(exc)})
    except OpenFDAUpstreamError as exc:
        return JSONResponse(status_code=502, content={"error": "Failed to fetch FDA label"})
    except GuideInternalError as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.get("/api/drugs/by-ndc/{ndc}/guide")
async def get_guide_by_ndc(ndc: str):
    """Return medication guide for one NDC."""
    try:
        return await build_guide(ndc=ndc)
    except GuideNotFoundError as exc:
        return JSONResponse(status_code=404, content={"error": str(exc)})
    except OpenFDAUpstreamError as exc:
        return JSONResponse(status_code=502, content={"error": "Failed to fetch FDA label"})
    except GuideInternalError as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.get("/api/drugs/search")
async def search_drugs(
    q: str = Query(..., min_length=1, description="Drug name query"),
    limit: int = Query(10, ge=1, le=50),
):
    """Search RxNorm approximate term endpoint for typeahead results."""
    client = RxNormClient()
    try:
        results = await client.search(term=q, limit=limit)
        return {"results": results}
    except httpx.HTTPError as exc:
        logger.warning("RxNorm search failed for q=%r: %s", q, exc)
        return JSONResponse(status_code=502, content={"error": "Failed to query RxNorm"})


@router.post("/api/admin/drugs/{rxcui}/guide/refresh")
async def refresh_guide(rxcui: str, _admin=Depends(require_superuser)):
    """Force refresh a medication guide row regardless of cache age."""
    try:
        return await build_guide(rxcui=rxcui, force_refresh=True)
    except GuideNotFoundError as exc:
        return JSONResponse(status_code=404, content={"error": str(exc)})
    except OpenFDAUpstreamError as exc:
        return JSONResponse(status_code=502, content={"error": "Failed to fetch FDA label"})
    except GuideInternalError as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
