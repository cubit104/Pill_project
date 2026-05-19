from __future__ import annotations

import logging
from time import perf_counter
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
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


def _timing_value(result: dict, key: str, fallback: float) -> float:
    value = result.get(key)
    if value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_or_400(ndc: str) -> str:
    normalized = normalize_ndc_to_11(ndc)
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid NDC format. Use a valid 10/11-digit NDC.")
    return normalized


def build_price_response(result: dict) -> dict:
    response = {
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
    for field in (
        "match_type",
        "matched_ndc",
        "source_rxcui",
        "resolved_ingredient",
        "resolved_rxcui",
        "equivalent_count",
    ):
        if field in result:
            response[field] = result[field]
    return response


@router.get("/api/prices/health")
async def get_pricing_health():
    checks: dict[str, dict] = {
        "database": {"ok": False, "detail": "not checked"},
        "drug_prices_table": {"ok": False, "row_count": 0, "detail": "not checked"},
        "drug_price_history_table": {"ok": False, "row_count": 0, "detail": "not checked"},
        "nadac_catalog": {
            "ok": False,
            "dataset_id": None,
            "as_of_week": None,
            "columns": None,
            "all_columns": None,
            "detail": "not checked",
        },
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

    for table_name, key in (
        ("drug_prices", "drug_prices_table"),
        ("drug_price_history", "drug_price_history_table"),
    ):
        if not db_available:
            checks[key] = {"ok": False, "row_count": 0, "detail": "database unavailable"}
            continue
        try:
            with database.db_engine.connect() as conn:
                row_count = int(conn.execute(text(f"SELECT count(*) FROM {table_name}")).scalar() or 0)
            checks[key] = {"ok": True, "row_count": row_count, "detail": "ok"}
        except Exception as exc:
            detail = "relation does not exist" if _relation_missing(exc) else _error_detail(exc)
            checks[key] = {"ok": False, "row_count": 0, "detail": detail}

    original_timeout = pricing_service.timeout
    try:
        pricing_service.timeout = httpx.Timeout(5.0, connect=5.0, read=5.0, write=5.0, pool=5.0)
        metadata = await pricing_service._get_latest_dataset_metadata()
        dataset_id = metadata.get("dataset_id")
        column_map = {}
        if dataset_id:
            try:
                column_map = await pricing_service._resolve_column_map(dataset_id)
            except Exception:
                logger.exception("NADAC column discovery failed for health endpoint dataset_id=%s", dataset_id)
        discovered = bool(column_map.get("all_columns")) if column_map else False
        checks["nadac_catalog"] = {
            "ok": True,
            "dataset_id": dataset_id,
            "as_of_week": metadata.get("as_of_week"),
            "columns": {
                "ndc": column_map.get("ndc"),
                "effective_date": column_map.get("effective_date"),
                "price": column_map.get("price"),
                "unit": column_map.get("unit"),
            }
            if discovered
            else None,
            "all_columns": column_map.get("all_columns") if discovered else None,
            "detail": "ok",
        }
    except Exception as exc:
        checks["nadac_catalog"] = {
            "ok": False,
            "dataset_id": None,
            "as_of_week": None,
            "columns": None,
            "all_columns": None,
            "detail": _error_detail(exc),
        }
    finally:
        pricing_service.timeout = original_timeout

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
    response: Response,
    days_supply: int = Query(30, ge=1, le=365),
    units_per_day: float = Query(1.0, gt=0, le=1000),
):
    normalized = _normalize_or_400(ndc)
    request_started = perf_counter()
    try:
        result = await pricing_service.get_price(
            normalized,
            days_supply=days_supply,
            units_per_day=units_per_day,
        )
        cache_status = str(result.get("cache_status") or "miss")
        cache_dur = _timing_value(result, "cache_duration_ms", 0.0)
        fetch_dur = _timing_value(result, "fetch_duration_ms", max(0.0, (perf_counter() - request_started) * 1000))
        response.headers["X-Price-Cache"] = cache_status
        response.headers["Server-Timing"] = f"cache;dur={cache_dur:.2f}, fetch;dur={fetch_dur:.2f}"
        return build_price_response(result)
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


@router.get("/api/prices/by-rxcui/{rxcui}")
async def get_price_by_rxcui_route(
    rxcui: str,
    response: Response,
    days_supply: int = Query(30, ge=1, le=365),
    units_per_day: float = Query(1.0, gt=0, le=1000),
):
    request_started = perf_counter()
    try:
        result = await pricing_service.get_price_by_rxcui(
            rxcui,
            days_supply=days_supply,
            units_per_day=units_per_day,
        )
        cache_status = str(result.get("cache_status") or "miss")
        cache_dur = _timing_value(result, "cache_duration_ms", 0.0)
        fetch_dur = _timing_value(result, "fetch_duration_ms", max(0.0, (perf_counter() - request_started) * 1000))
        response.headers["X-Price-Cache"] = cache_status
        response.headers["Server-Timing"] = f"cache;dur={cache_dur:.2f}, fetch;dur={fetch_dur:.2f}"
        return build_price_response(result)
    except PricingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PricingServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/prices/by-name/{name}")
async def get_price_by_name_route(
    name: str,
    response: Response,
    days_supply: int = Query(30, ge=1, le=365),
    units_per_day: float = Query(1.0, gt=0, le=1000),
):
    request_started = perf_counter()
    try:
        decoded_name = unquote(name)
        result = await pricing_service.get_price_by_name(
            decoded_name,
            days_supply=days_supply,
            units_per_day=units_per_day,
        )
        cache_status = str(result.get("cache_status") or "miss")
        cache_dur = _timing_value(result, "cache_duration_ms", 0.0)
        fetch_dur = _timing_value(result, "fetch_duration_ms", max(0.0, (perf_counter() - request_started) * 1000))
        response.headers["X-Price-Cache"] = cache_status
        response.headers["Server-Timing"] = f"cache;dur={cache_dur:.2f}, fetch;dur={fetch_dur:.2f}"
        return build_price_response(result)
    except PricingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PricingServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/prices/{ndc}/alternatives")
async def get_ndc_alternatives(ndc: str):
    normalized = _normalize_or_400(ndc)
    lookup_token = normalized.replace("-", "")
    try:
        result = await pricing_service.get_alternatives_by_ingredient(lookup_token)
        response: dict = {
            "ndc": lookup_token,
            "ingredient": result["ingredient"],
            "ingredient_rxcui": result["ingredient_rxcui"],
            "alternatives": result["alternatives"],
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
        if "generic_vs_brand_ratio" in result:
            response["generic_vs_brand_ratio"] = result["generic_vs_brand_ratio"]
        return response
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
