from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

import database
from ndc_normalize import normalize_ndc_to_11
from services.pricing_service import (
    DEFAULT_DISCLAIMERS,
    PricingNotFoundError,
    PricingServiceError,
    pricing_service,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _normalize_or_400(ndc: str) -> str:
    normalized = normalize_ndc_to_11(ndc)
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid NDC format. Use a valid 10/11-digit NDC.")
    return normalized


@router.get("/api/prices/health")
async def get_pricing_health():
    checks: dict[str, dict] = {
        "database": {"ok": False, "detail": "not checked"},
        "drug_prices_table": {"ok": False, "row_count": 0, "detail": "not checked"},
        "drug_price_history_table": {"ok": False, "row_count": 0, "detail": "not checked"},
        "nadac_catalog": {"ok": False, "dataset_id": None, "as_of_week": None, "detail": "not checked"},
        "rxnav": {"ok": False, "detail": "not checked"},
    }

    def _error_detail(exc: Exception) -> str:
        return f"{type(exc).__name__}: {exc}"

    def _relation_missing(exc: Exception) -> bool:
        msg = str(exc).lower()
        return "relation" in msg and "does not exist" in msg

    db_available = False
    try:
        if not database.db_engine and not database.connect_to_database():
            raise RuntimeError("Database connection not available")
        with database.db_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_available = True
        checks["database"] = {"ok": True, "detail": "ok"}
    except Exception as exc:
        checks["database"] = {"ok": False, "detail": _error_detail(exc)}

    table_checks = (
        ("drug_prices_table", text("SELECT count(*) FROM drug_prices")),
        ("drug_price_history_table", text("SELECT count(*) FROM drug_price_history")),
    )
    for key, query in table_checks:
        if not db_available:
            checks[key] = {"ok": False, "row_count": 0, "detail": "database unavailable"}
            continue
        try:
            with database.db_engine.connect() as conn:
                row_count = int(conn.execute(query).scalar() or 0)
            checks[key] = {"ok": True, "row_count": row_count, "detail": "ok"}
        except Exception as exc:
            detail = "relation does not exist" if _relation_missing(exc) else _error_detail(exc)
            checks[key] = {"ok": False, "row_count": 0, "detail": detail}

    try:
        metadata = await pricing_service._get_latest_dataset_metadata(
            timeout=httpx.Timeout(5.0, connect=5.0, read=5.0, write=5.0, pool=5.0)
        )
        checks["nadac_catalog"] = {
            "ok": True,
            "dataset_id": metadata.get("dataset_id"),
            "as_of_week": metadata.get("as_of_week"),
            "detail": "ok",
        }
    except Exception as exc:
        checks["nadac_catalog"] = {
            "ok": False,
            "dataset_id": None,
            "as_of_week": None,
            "detail": _error_detail(exc),
        }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get("https://rxnav.nlm.nih.gov/REST/version.json")
        if response.status_code == 200:
            checks["rxnav"] = {"ok": True, "detail": "ok"}
        else:
            checks["rxnav"] = {"ok": False, "detail": f"HTTP {response.status_code}"}
    except Exception as exc:
        checks["rxnav"] = {"ok": False, "detail": _error_detail(exc)}

    db_and_tables_ok = all(
        checks[key]["ok"] for key in ("database", "drug_prices_table", "drug_price_history_table")
    )
    upstream_ok = checks["nadac_catalog"]["ok"] and checks["rxnav"]["ok"]
    overall = "ok" if db_and_tables_ok and upstream_ok else "degraded" if db_and_tables_ok else "down"

    return {
        "overall": overall,
        "checks": checks,
    }


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
    except Exception as exc:
        logger.exception("Unhandled error in pricing endpoint ndc=%s", ndc)
        raise HTTPException(status_code=503, detail=f"Pricing service error: {type(exc).__name__}: {exc}")


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
    except Exception as exc:
        logger.exception("Unhandled error in pricing endpoint ndc=%s", ndc)
        raise HTTPException(status_code=503, detail=f"Pricing service error: {type(exc).__name__}: {exc}")


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
    except Exception as exc:
        logger.exception("Unhandled error in pricing endpoint ndc=%s", ndc)
        raise HTTPException(status_code=503, detail=f"Pricing service error: {type(exc).__name__}: {exc}")
