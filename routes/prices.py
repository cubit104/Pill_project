from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ndc_normalize import normalize_ndc_to_11
from services.pricing_service import (
    DEFAULT_DISCLAIMERS,
    PricingNotFoundError,
    PricingServiceError,
    pricing_service,
)

router = APIRouter()


def _normalize_or_400(ndc: str) -> str:
    normalized = normalize_ndc_to_11(ndc)
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid NDC format. Use a valid 10/11-digit NDC.")
    return normalized


@router.get("/api/prices/{ndc}")
async def get_ndc_price(
    ndc: str,
    days_supply: int = Query(30, ge=1, le=365),
    units_per_day: float = Query(1.0, gt=0, le=1000),
):
    normalized = _normalize_or_400(ndc)
    try:
        result = await pricing_service.get_price(
            normalized,
            days_supply=days_supply,
            units_per_day=units_per_day,
        )
        return {
            "ndc": result["ndc"],
            "price_per_unit": result["price_per_unit"],
            "unit": result["unit"],
            "effective_date": result["effective_date"],
            "source": result["source"],
            "as_of_week": result.get("as_of_week"),
            "days_supply": result["days_supply"],
            "units_per_day": result["units_per_day"],
            "total_acquisition_cost": result["total_acquisition_cost"],
            "fair_retail_low": result["fair_retail_low"],
            "fair_retail_high": result["fair_retail_high"],
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except PricingNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No NADAC pricing data is currently available for this NDC.",
        )
    except (PricingServiceError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/api/prices/{ndc}/alternatives")
async def get_ndc_alternatives(ndc: str):
    normalized = _normalize_or_400(ndc)
    lookup_token = normalized.replace("-", "")
    try:
        result = await pricing_service.get_alternatives_by_ingredient(lookup_token)
        return {
            "ndc": lookup_token,
            "ingredient": result["ingredient"],
            "ingredient_rxcui": result["ingredient_rxcui"],
            "alternatives": result["alternatives"],
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except PricingNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No NADAC alternatives were found for this ingredient.",
        )
    except (PricingServiceError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/api/prices/{ndc}/history")
async def get_ndc_price_history(
    ndc: str,
    weeks: int = Query(52, ge=1, le=260),
):
    normalized = _normalize_or_400(ndc)
    try:
        history = await pricing_service.get_price_history(normalized, weeks=weeks)
        return {
            "ndc": normalized.replace("-", ""),
            "weeks": weeks,
            "history": history,
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except PricingNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No NADAC history is currently available for this NDC.",
        )
    except (PricingServiceError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc))
