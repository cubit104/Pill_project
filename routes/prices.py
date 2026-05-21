from __future__ import annotations

import asyncio as _asyncio
import logging
import re
from time import perf_counter
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import bindparam, text

import database
from ndc_normalize import normalize_ndc_to_11
from routes.admin.auth import require_superuser
from services.pricing_service import (
    DEFAULT_DISCLAIMERS,
    PricingNotFoundError,
    PricingServiceError,
    pricing_service,
)

logger = logging.getLogger(__name__)
router = APIRouter()
HISTORY_ENDPOINT_TIMEOUT_SECONDS = 8.0


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


def _history_row_counts_for_ndcs(ndcs: list[str]) -> dict[str, int]:
    if not ndcs:
        return {}
    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT ndc, count(*) AS row_count
                    FROM drug_price_history
                    WHERE ndc IN :ndcs
                    GROUP BY ndc
                    """
                ).bindparams(bindparam("ndcs", expanding=True)),
                {"ndcs": ndcs},
            ).mappings().all()
    except Exception:
        logger.exception("Failed to count cached history rows for ndc selection")
        return {}
    return {str(row["ndc"]): int(row["row_count"]) for row in rows}


def _pick_ndc_with_most_history_rows(
    candidates: list[str],
    *,
    tie_break_lowest: bool,
) -> str | None:
    if not candidates:
        return None
    unique_candidates = list(dict.fromkeys(candidates))
    if len(unique_candidates) == 1:
        return unique_candidates[0]

    counts = _history_row_counts_for_ndcs(unique_candidates)
    if not counts:
        return unique_candidates[0]

    max_count = max((counts.get(ndc, 0) for ndc in unique_candidates), default=0)
    if max_count <= 0:
        return unique_candidates[0]

    best = [ndc for ndc in unique_candidates if counts.get(ndc, 0) == max_count]
    if tie_break_lowest:
        return min(best)
    return best[0]


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
    response: Response,
    weeks: int = Query(52, ge=1, le=260),
):
    normalized = _normalize_or_400(ndc)
    ndc_digits = re.sub(r"\D", "", normalized)
    try:
        task = pricing_service._get_or_start_history_task(ndc_digits, weeks)
        history = await _asyncio.wait_for(
            _asyncio.shield(task),
            # Keep SSR unblocked: /pill/[slug]/price initial render should not wait on slow upstream calls.
            timeout=HISTORY_ENDPOINT_TIMEOUT_SECONDS,
        )
        response.headers["X-Price-History"] = "ready"
        return {
            "ndc": normalized.replace("-", ""),
            "weeks": weeks,
            "history": history,
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except _asyncio.TimeoutError:
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["X-Price-History"] = "warming"
        return {
            "ndc": normalized.replace("-", ""),
            "weeks": weeks,
            "history": [],
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


@router.get("/api/prices/by-name/{name}/history")
async def get_price_history_by_name_route(
    name: str,
    response: Response,
    weeks: int = Query(52, ge=1, le=260),
):
    decoded_name = unquote(name)
    normalized_name = decoded_name.strip().lower()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Drug name is required")

    try:
        ingredient = await pricing_service._resolve_ingredient(normalized_name)
        if not ingredient:
            raise PricingNotFoundError("Unable to resolve ingredient for name history lookup")

        representative_ndc = await pricing_service._ingredient_rxcui_to_representative_ndc(ingredient["rxcui"])
        candidate_ndcs: list[str] = [representative_ndc] if representative_ndc else []

        related_products = await pricing_service._related_product_rxcuis(ingredient["rxcui"])
        if related_products:
            ndc_lists = await _asyncio.gather(
                *(pricing_service._ndcs_for_rxcui(product["rxcui"]) for product in related_products),
                return_exceptions=True,
            )
            for ndc_list in ndc_lists:
                if isinstance(ndc_list, Exception):
                    continue
                candidate_ndcs.extend(ndc_list)

        chosen_ndc = _pick_ndc_with_most_history_rows(candidate_ndcs, tie_break_lowest=False)
        if not chosen_ndc:
            raise PricingNotFoundError("No candidate NDC found for ingredient history lookup")

        task = pricing_service._get_or_start_history_task(chosen_ndc, weeks)
        history = await _asyncio.wait_for(
            _asyncio.shield(task),
            timeout=HISTORY_ENDPOINT_TIMEOUT_SECONDS,
        )
        response.headers["X-Price-History"] = "ready"
        return {
            "name": decoded_name,
            "resolved_ndc": chosen_ndc,
            "ingredient": ingredient.get("name"),
            "weeks": weeks,
            "history": history,
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except _asyncio.TimeoutError:
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["X-Price-History"] = "warming"
        return {
            "name": decoded_name,
            "resolved_ndc": None,
            "ingredient": None,
            "weeks": weeks,
            "history": [],
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except PricingNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No NADAC history is currently available for this NDC.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PricingServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.exception("Unhandled error in by-name history endpoint name=%s", name)
        raise HTTPException(status_code=503, detail=f"Pricing service error: {type(exc).__name__}: {exc}")


@router.get("/api/prices/by-rxcui/{rxcui}/history")
async def get_price_history_by_rxcui_route(
    rxcui: str,
    response: Response,
    weeks: int = Query(52, ge=1, le=260),
):
    rxcui_digits = re.sub(r"\D", "", (rxcui or "").strip())
    if not rxcui_digits:
        raise HTTPException(status_code=400, detail="Invalid RxCUI format")

    try:
        candidates = await pricing_service._ndcs_for_rxcui(rxcui_digits)
        chosen_ndc = _pick_ndc_with_most_history_rows(candidates, tie_break_lowest=True)
        if not chosen_ndc:
            raise PricingNotFoundError(f"No NDCs found for RxCUI {rxcui_digits}")

        task = pricing_service._get_or_start_history_task(chosen_ndc, weeks)
        history = await _asyncio.wait_for(
            _asyncio.shield(task),
            timeout=HISTORY_ENDPOINT_TIMEOUT_SECONDS,
        )
        response.headers["X-Price-History"] = "ready"
        return {
            "rxcui": rxcui,
            "resolved_ndc": chosen_ndc,
            "weeks": weeks,
            "history": history,
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except _asyncio.TimeoutError:
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["X-Price-History"] = "warming"
        return {
            "rxcui": rxcui,
            "resolved_ndc": None,
            "weeks": weeks,
            "history": [],
            "disclaimers": DEFAULT_DISCLAIMERS,
        }
    except PricingNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No NADAC history is currently available for this NDC.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PricingServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.exception("Unhandled error in by-rxcui history endpoint rxcui=%s", rxcui)
        raise HTTPException(status_code=503, detail=f"Pricing service error: {type(exc).__name__}: {exc}")


@router.get("/api/admin/diag/pricing")
async def get_pricing_diag(
    ndc: str = Query(...),
    _admin: dict = Depends(require_superuser),
):
    normalized = _normalize_or_400(ndc).replace("-", "")
    diag: dict = {
        "ndc": normalized,
        "dataset_id": None,
        "as_of_week": None,
        "columns": [],
        "column_map": {
            "ndc": None,
            "effective_date": None,
            "price": None,
            "unit": None,
        },
        "datastore_probe": None,
        "drug_prices": {"exists": False, "row_count": 0},
        "drug_price_history": {"exists": False, "row_count": 0},
    }

    metadata: dict | None = None
    metadata_error: str | None = None
    try:
        metadata = await pricing_service._get_latest_dataset_metadata()
    except Exception as exc:
        metadata_error = f"{type(exc).__name__}: {exc}"

    if metadata:
        dataset_id = metadata.get("dataset_id")
        diag["dataset_id"] = dataset_id
        diag["as_of_week"] = metadata.get("as_of_week")
        if dataset_id:
            try:
                column_map = await pricing_service._resolve_column_map(dataset_id)
                columns = column_map.get("all_columns") or []
                diag["columns"] = columns
                diag["column_map"] = {
                    "ndc": column_map.get("ndc"),
                    "effective_date": column_map.get("effective_date"),
                    "price": column_map.get("price"),
                    "unit": column_map.get("unit"),
                }
                ndc_column = str(column_map.get("ndc") or "")
                if ndc_column:
                    try:
                        probe_payload = await pricing_service._request_datastore_query(
                            dataset_id,
                            conditions=[{"resource": "t", "property": ndc_column, "value": normalized, "operator": "="}],
                            limit=1,
                        )
                        diag["datastore_probe"] = {"ok": True, "payload": probe_payload}
                    except Exception as exc:
                        diag["datastore_probe"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
                else:
                    diag["datastore_probe"] = {"ok": False, "error": "No NDC column resolved"}
            except Exception as exc:
                diag["datastore_probe"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    elif metadata_error:
        diag["datastore_probe"] = {"ok": False, "error": metadata_error}

    if database.db_engine or database.connect_to_database():
        with database.db_engine.connect() as conn:
            price_count = int(
                conn.execute(
                    text("SELECT count(*) FROM drug_prices WHERE ndc = :ndc"),
                    {"ndc": normalized},
                ).scalar()
                or 0
            )
            history_count = int(
                conn.execute(
                    text("SELECT count(*) FROM drug_price_history WHERE ndc = :ndc"),
                    {"ndc": normalized},
                ).scalar()
                or 0
            )
        diag["drug_prices"] = {"exists": price_count > 0, "row_count": price_count}
        diag["drug_price_history"] = {"exists": history_count > 0, "row_count": history_count}

    return diag


@router.get("/api/prices/{ndc}/strengths")
async def get_ndc_strengths(ndc: str):
    normalized = _normalize_or_400(ndc)
    lookup_ndc = normalized.replace("-", "")
    empty_response: dict = {
        "ndc": lookup_ndc,
        "ingredient": None,
        "ingredient_rxcui": None,
        "strengths": [],
    }

    try:
        rxcui = await pricing_service._ndc_to_rxcui(lookup_ndc)
        if not rxcui:
            return empty_response

        ingredient_info = await pricing_service._ingredient_for_rxcui(rxcui)
        if not ingredient_info:
            return empty_response

        ingredient_name = ingredient_info["name"].lower()
        ingredient_rxcui = ingredient_info["rxcui"]

        related_rxcuis = await pricing_service._related_product_rxcuis(ingredient_rxcui)
        if not related_rxcuis:
            return {**empty_response, "ingredient": ingredient_name, "ingredient_rxcui": ingredient_rxcui}

        ndc_lists = await _asyncio.gather(
            *(pricing_service._ndcs_for_rxcui(r["rxcui"]) for r in related_rxcuis),
            return_exceptions=True,
        )
        all_ndcs: list[str] = []
        for result in ndc_lists:
            if isinstance(result, list):
                all_ndcs.extend(result)

        all_ndcs = list(dict.fromkeys(all_ndcs))
        if not all_ndcs:
            return {**empty_response, "ingredient": ingredient_name, "ingredient_rxcui": ingredient_rxcui}

        if not database.db_engine and not database.connect_to_database():
            return {**empty_response, "ingredient": ingredient_name, "ingredient_rxcui": ingredient_rxcui}

        with database.db_engine.connect() as conn:
            price_rows = conn.execute(
                text(
                    """
                    SELECT ndc, price_per_unit, unit, effective_date
                    FROM drug_prices
                    WHERE ndc = ANY(:ndcs)
                    """
                ),
                {"ndcs": all_ndcs},
            ).mappings().all()

        price_by_ndc: dict[str, dict] = {str(row["ndc"]): dict(row) for row in price_rows}
        with database.db_engine.connect() as conn:
            pf_rows = conn.execute(
                text(
                    """
                    SELECT DISTINCT ON (REGEXP_REPLACE(TRIM(ndc11), '[^0-9]', '', 'g'))
                        slug, medicine_name, spl_strength,
                        REGEXP_REPLACE(TRIM(ndc11), '[^0-9]', '', 'g') AS ndc_digits
                    FROM pillfinder
                    WHERE REGEXP_REPLACE(TRIM(ndc11), '[^0-9]', '', 'g') = ANY(:ndcs)
                      AND slug IS NOT NULL
                    """
                ),
                {"ndcs": all_ndcs},
            ).mappings().all()

        strengths: list[dict] = []
        seen_ndcs: set[str] = set()
        for pf_row in pf_rows:
            ndc_digits = str(pf_row["ndc_digits"])
            if ndc_digits in seen_ndcs:
                continue
            seen_ndcs.add(ndc_digits)
            price_info = price_by_ndc.get(ndc_digits)
            has_price = price_info is not None
            strengths.append(
                {
                    "ndc": ndc_digits,
                    "slug": pf_row["slug"],
                    "medicine_name": pf_row["medicine_name"] or "",
                    "spl_strength": pf_row["spl_strength"] or "",
                    "price_per_unit": float(price_info["price_per_unit"]) if has_price else 0.0,
                    "unit": str((price_info or {}).get("unit") or "EA"),
                    "effective_date": str((price_info or {}).get("effective_date") or ""),
                    "has_price": has_price,
                    "is_current": ndc_digits == lookup_ndc,
                }
            )

        def _strength_sort_key(s: dict) -> float:
            # Sort by leading numeric value in spl_strength (e.g. "500 mg" → 500.0).
            # Non-numeric / missing strengths sort last (float("inf")).
            m = re.match(r"(\d+(?:\.\d+)?)", s.get("spl_strength") or "")
            return float(m.group(1)) if m else float("inf")

        strengths.sort(key=_strength_sort_key)

        return {
            "ndc": lookup_ndc,
            "ingredient": ingredient_name,
            "ingredient_rxcui": ingredient_rxcui,
            "strengths": strengths,
        }

    except Exception as exc:
        logger.warning("Strengths endpoint failed for ndc=%s: %s", lookup_ndc, exc)
        return {"ndc": lookup_ndc, "ingredient": None, "ingredient_rxcui": None, "strengths": []}
