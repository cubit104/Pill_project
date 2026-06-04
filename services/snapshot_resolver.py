from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

import database
from ndc_normalize import normalize_ndc_to_11
from services.pricing_service import PricingNotFoundError, PricingServiceError, pricing_service

logger = logging.getLogger(__name__)

RESOLVER_VERSION = 1


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_ndc_digits(value: Any) -> str | None:
    if value in (None, ""):
        return None
    normalized = normalize_ndc_to_11(str(value))
    if not normalized:
        return None
    digits = re.sub(r"\D", "", normalized)
    return digits if len(digits) == 11 else None


def _family_prefix_from_pill(pill: dict[str, Any]) -> str | None:
    ndc9_digits = re.sub(r"\D", "", str(pill.get("ndc9") or ""))
    if len(ndc9_digits) >= 7:
        return ndc9_digits[:7]
    ndc11_digits = _normalize_ndc_digits(pill.get("ndc11") or pill.get("ndc"))
    if ndc11_digits:
        return ndc11_digits[:7]
    return None


def _schema_offers_valid(snapshot: dict[str, Any]) -> bool:
    return (
        snapshot.get("price_per_unit") is not None
        and snapshot.get("fair_retail_low") is not None
        and snapshot.get("fair_retail_high") is not None
    )


def _empty_snapshot(pill: dict[str, Any], *, notes: str | None = None) -> dict[str, Any]:
    now = _utcnow()
    snapshot = {
        "slug": pill.get("slug"),
        "pill_id": pill.get("id"),
        "resolved_ndc11": None,
        "match_type": "none",
        "resolved_via": None,
        "price_per_unit": None,
        "unit": None,
        "effective_date": None,
        "total_acquisition_cost": None,
        "fair_retail_low": None,
        "fair_retail_high": None,
        "history_52w": [],
        "history_source_ndc": None,
        "alternatives": [],
        "is_estimate": False,
        "estimate_basis": None,
        "display_disclaimer": None,
        "schema_offers_valid": False,
        "resolved_at": now,
        "resolver_version": RESOLVER_VERSION,
        "resolver_notes": notes,
        "created_at": now,
        "updated_at": now,
    }
    return snapshot


def _build_snapshot_from_price(
    pill: dict[str, Any],
    price_result: dict[str, Any],
    *,
    resolved_via: str,
    resolved_ndc11: str | None,
    history: list[dict[str, Any]],
    history_source_ndc: str | None,
    alternatives: list[dict[str, Any]],
    is_estimate: bool = False,
    estimate_basis: str | None = None,
    display_disclaimer: str | None = None,
    resolver_notes: str | None = None,
) -> dict[str, Any]:
    snapshot = _empty_snapshot(pill, notes=resolver_notes)
    snapshot.update(
        {
            "resolved_ndc11": resolved_ndc11,
            "match_type": price_result.get("match_type") or "exact",
            "resolved_via": resolved_via,
            "price_per_unit": price_result.get("price_per_unit"),
            "unit": price_result.get("unit"),
            "effective_date": price_result.get("effective_date"),
            "total_acquisition_cost": price_result.get("total_acquisition_cost"),
            "fair_retail_low": price_result.get("fair_retail_low"),
            "fair_retail_high": price_result.get("fair_retail_high"),
            "history_52w": history,
            "history_source_ndc": history_source_ndc,
            "alternatives": alternatives,
            "is_estimate": is_estimate,
            "estimate_basis": estimate_basis,
            "display_disclaimer": display_disclaimer,
        }
    )
    snapshot["schema_offers_valid"] = _schema_offers_valid(snapshot)
    return snapshot


def _sibling_disclaimer(pill: dict[str, Any], resolved_ndc11: str | None) -> str:
    strength = str(pill.get("spl_strength") or pill.get("strength") or "").strip()
    if resolved_ndc11:
        return (
            "Pricing resolved from a sibling NDC in the same labeler/product family"
            f"{f' at {strength}' if strength else ''} (matched {resolved_ndc11})."
        )
    return "Pricing resolved from a sibling NDC in the same labeler/product family."


def _name_estimate_basis(pill: dict[str, Any], price_result: dict[str, Any]) -> str:
    ingredient = price_result.get("resolved_ingredient")
    if ingredient:
        return f"Ingredient-level name match for {ingredient}"
    medicine_name = str(pill.get("medicine_name") or pill.get("drug_name") or "").strip()
    return f"Ingredient-level name match for {medicine_name}" if medicine_name else "Ingredient-level name match"


def _history_ndc_for_price(pill: dict[str, Any], price_result: dict[str, Any], resolved_ndc11: str | None) -> str | None:
    matched_ndc = _normalize_ndc_digits(price_result.get("matched_ndc"))
    if price_result.get("match_type") == "equivalent" and matched_ndc:
        return matched_ndc
    return resolved_ndc11 or _normalize_ndc_digits(pill.get("ndc11") or pill.get("ndc"))


def _alternatives_lookup_token(pill: dict[str, Any], resolved_ndc11: str | None, price_result: dict[str, Any]) -> str | None:
    for value in (
        price_result.get("matched_ndc"),
        resolved_ndc11,
        pill.get("ndc11"),
        pill.get("ndc"),
        price_result.get("resolved_rxcui"),
        price_result.get("source_rxcui"),
        pill.get("rxcui"),
        pill.get("medicine_name"),
        pill.get("drug_name"),
    ):
        if value:
            return str(value)
    return None


def _relation_missing(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "relation" in msg and "does not exist" in msg


def _ensure_db() -> None:
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")


def _sibling_family_candidates(pill: dict[str, Any]) -> list[str]:
    family_prefix = _family_prefix_from_pill(pill)
    strength = str(pill.get("spl_strength") or pill.get("strength") or "").strip()
    medicine_name = str(pill.get("medicine_name") or pill.get("drug_name") or "").strip()
    if not family_prefix or not strength:
        return []

    _ensure_db()
    query = text(
        """
        SELECT DISTINCT REGEXP_REPLACE(TRIM(ndc11), '[^0-9]', '', 'g') AS ndc_digits
        FROM pillfinder
        WHERE deleted_at IS NULL
          AND published = true
          AND slug <> :slug
          AND COALESCE(TRIM(spl_strength), '') = :strength
          AND LOWER(COALESCE(TRIM(medicine_name), '')) = LOWER(:medicine_name)
          AND LEFT(
            REGEXP_REPLACE(COALESCE(NULLIF(TRIM(ndc9), ''), TRIM(ndc11)), '[^0-9]', '', 'g'),
            7
          ) = :family_prefix
          AND COALESCE(TRIM(ndc11), '') <> ''
        ORDER BY ndc_digits
        """
    )
    with database.db_engine.connect() as conn:
        rows = conn.execute(
            query,
            {
                "slug": pill.get("slug"),
                "strength": strength,
                "medicine_name": medicine_name,
                "family_prefix": family_prefix,
            },
        ).mappings().all()
    return [str(row["ndc_digits"]) for row in rows if row.get("ndc_digits")]


async def _try_exact_price(pill: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    ndc_digits = _normalize_ndc_digits(pill.get("ndc11") or pill.get("ndc"))
    if not ndc_digits:
        return None

    # Try local drug_prices DB first — no CMS API call needed
    cached = pricing_service._get_cached_price(ndc_digits)
    if cached:
        priced = pricing_service._add_totals(
            pricing_service._payload_from_cached_row(cached, latest_week=None),
            days_supply=30, units_per_day=1.0,
        )
        priced["match_type"] = "exact"
        return priced, ndc_digits

    # Fall through to live CMS only if not in local DB
    try:
        latest = await pricing_service._fetch_nadac_latest_for_ndc(ndc_digits)
    except PricingNotFoundError:
        return None
    except PricingServiceError as exc:
        logger.warning("exact price CMS lookup failed for ndc=%s: %s", ndc_digits, exc)
        return None
    priced = pricing_service._add_totals(latest, days_supply=30, units_per_day=1.0)
    priced["match_type"] = "exact"
    return priced, ndc_digits


async def _try_sibling_family(pill: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    candidates = _sibling_family_candidates(pill)
    if not candidates:
        return None

    parsed_rows: list[tuple[dict[str, Any], str]] = []

    # Try local DB cache first for all siblings in bulk
    bulk_cached = pricing_service._get_cached_prices_bulk(candidates)
    for sibling_ndc, cached in bulk_cached.items():
        priced = pricing_service._add_totals(
            pricing_service._payload_from_cached_row(cached, latest_week=None),
            days_supply=30, units_per_day=1.0,
        )
        priced["match_type"] = "equivalent"
        priced["matched_ndc"] = sibling_ndc
        parsed_rows.append((priced, sibling_ndc))

    # For any siblings not in local cache, try live CMS
    cached_ndcs = set(bulk_cached.keys())
    for sibling_ndc in candidates:
        if sibling_ndc in cached_ndcs:
            continue
        try:
            latest = await pricing_service._fetch_nadac_latest_for_ndc(sibling_ndc)
        except PricingNotFoundError:
            continue
        except PricingServiceError as exc:
            logger.warning("sibling price CMS lookup failed for ndc=%s: %s", sibling_ndc, exc)
            continue
        priced = pricing_service._add_totals(latest, days_supply=30, units_per_day=1.0)
        priced["match_type"] = "equivalent"
        priced["matched_ndc"] = sibling_ndc
        parsed_rows.append((priced, sibling_ndc))

    if not parsed_rows:
        return None

    cheapest, matched_ndc = min(parsed_rows, key=lambda row: row[0]["price_per_unit"])
    cheapest["match_type"] = "equivalent"
    cheapest["matched_ndc"] = matched_ndc
    return cheapest, matched_ndc


async def _try_rxcui_price(pill: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    rxcui = str(pill.get("rxcui") or "").strip()
    if not rxcui:
        return None
    try:
        priced = await pricing_service.get_price_by_rxcui(rxcui, days_supply=30, units_per_day=1.0)
    except PricingNotFoundError:
        return None
    resolved_ndc11 = _normalize_ndc_digits(priced.get("matched_ndc")) or _normalize_ndc_digits(priced.get("ndc"))
    return priced, resolved_ndc11 or ""


async def _try_name_price(pill: dict[str, Any]) -> tuple[dict[str, Any], str] | None:
    medicine_name = str(pill.get("medicine_name") or pill.get("drug_name") or "").strip()
    if not medicine_name:
        return None
    try:
        priced = await pricing_service.get_price_by_name(medicine_name, days_supply=30, units_per_day=1.0)
    except PricingNotFoundError:
        return None
    resolved_ndc11 = _normalize_ndc_digits(priced.get("matched_ndc")) or _normalize_ndc_digits(priced.get("ndc"))
    return priced, resolved_ndc11 or ""


async def _fetch_snapshot_downstream(
    pill: dict[str, Any],
    price_result: dict[str, Any],
    resolved_ndc11: str | None,
) -> tuple[list[dict[str, Any]], str | None, list[dict[str, Any]], list[str]]:
    notes: list[str] = []
    history_source_ndc = _history_ndc_for_price(pill, price_result, resolved_ndc11)
    alternatives_token = _alternatives_lookup_token(pill, resolved_ndc11, price_result)

    async def _load_history() -> list[dict[str, Any]]:
        if not history_source_ndc:
            return []
        try:
            return await pricing_service.get_price_history(history_source_ndc, weeks=52)
        except PricingNotFoundError:
            return []
        except Exception as exc:
            notes.append(f"history fetch failed: {type(exc).__name__}")
            logger.warning("Snapshot history fetch failed for slug=%s: %s", pill.get("slug"), exc)
            return []

    async def _load_alternatives() -> list[dict[str, Any]]:
        if not alternatives_token:
            return []
        try:
            result = await pricing_service.get_alternatives_by_ingredient(alternatives_token)
            return list(result.get("alternatives") or [])
        except PricingNotFoundError:
            return []
        except Exception as exc:
            notes.append(f"alternatives fetch failed: {type(exc).__name__}")
            logger.warning("Snapshot alternatives fetch failed for slug=%s: %s", pill.get("slug"), exc)
            return []

    history, alternatives = await asyncio.gather(_load_history(), _load_alternatives())
    return history, history_source_ndc, alternatives, notes


async def resolve_pill_to_snapshot(pill: dict) -> dict:
    """Resolve a pill row to a complete snapshot dict matching the
    pill_price_snapshot schema. Runs offline; no timeout pressure.
    Returns a dict with keys matching every column in pill_price_snapshot."""
    base = _empty_snapshot(pill)

    try:
        exact = await _try_exact_price(pill)
        if exact:
            price_result, resolved_ndc11 = exact
            history, history_source_ndc, alternatives, notes = await _fetch_snapshot_downstream(
                pill,
                price_result,
                resolved_ndc11,
            )
            return _build_snapshot_from_price(
                pill,
                price_result,
                resolved_via="self",
                resolved_ndc11=resolved_ndc11,
                history=history,
                history_source_ndc=history_source_ndc,
                alternatives=alternatives,
                resolver_notes="; ".join(notes) or "Resolved from exact NDC.",
            )

        sibling = await _try_sibling_family(pill)
        if sibling:
            price_result, resolved_ndc11 = sibling
            history, history_source_ndc, alternatives, notes = await _fetch_snapshot_downstream(
                pill,
                price_result,
                resolved_ndc11,
            )
            return _build_snapshot_from_price(
                pill,
                price_result,
                resolved_via="sibling",
                resolved_ndc11=resolved_ndc11,
                history=history,
                history_source_ndc=history_source_ndc,
                alternatives=alternatives,
                estimate_basis="Sibling family match with the same strength",
                display_disclaimer=_sibling_disclaimer(pill, resolved_ndc11),
                resolver_notes="; ".join(notes) or f"Resolved via sibling family match {resolved_ndc11}.",
            )

        rxcui = await _try_rxcui_price(pill)
        if rxcui:
            price_result, resolved_ndc11 = rxcui
            history, history_source_ndc, alternatives, notes = await _fetch_snapshot_downstream(
                pill,
                price_result,
                resolved_ndc11 or None,
            )
            return _build_snapshot_from_price(
                pill,
                price_result,
                resolved_via="rxcui",
                resolved_ndc11=resolved_ndc11 or None,
                history=history,
                history_source_ndc=history_source_ndc,
                alternatives=alternatives,
                display_disclaimer=(
                    "Pricing resolved from a therapeutically equivalent NDC via RxCUI "
                    "because the exact package lacked a current NADAC row."
                ),
                resolver_notes="; ".join(notes) or "Resolved via RxCUI fallback.",
            )

        by_name = await _try_name_price(pill)
        if by_name:
            price_result, resolved_ndc11 = by_name
            history, history_source_ndc, alternatives, notes = await _fetch_snapshot_downstream(
                pill,
                price_result,
                resolved_ndc11 or None,
            )
            return _build_snapshot_from_price(
                pill,
                price_result,
                resolved_via="name",
                resolved_ndc11=resolved_ndc11 or None,
                history=history,
                history_source_ndc=history_source_ndc,
                alternatives=alternatives,
                is_estimate=True,
                estimate_basis=_name_estimate_basis(pill, price_result),
                display_disclaimer=(
                    "Pricing estimated from an ingredient/name-based match because no exact or sibling-family "
                    "NADAC row was available."
                ),
                resolver_notes="; ".join(notes) or "Resolved via ingredient/name fallback.",
            )
    except PricingServiceError as exc:
        logger.warning("Snapshot resolution failed for slug=%s: %s", pill.get("slug"), exc)
        base["resolver_notes"] = f"pricing service error: {exc}"
        return base
    except Exception as exc:
        logger.exception("Unexpected snapshot resolution failure for slug=%s", pill.get("slug"))
        base["resolver_notes"] = f"unexpected error: {type(exc).__name__}: {exc}"
        return base

    base["resolver_notes"] = "No exact NDC, sibling family, RxCUI, or name fallback produced pricing."
    return base


def fetch_attention_rows(*, limit: int = 200) -> list[dict[str, Any]]:
    _ensure_db()
    with database.db_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT slug, pill_id, match_type, resolved_via, is_estimate, resolver_notes, resolved_at
                FROM public.v_snapshots_needing_attention
                LIMIT :limit
                """
            ),
            {"limit": max(1, min(int(limit), 1000))},
        ).mappings().all()
    return [dict(row) for row in rows]


def snapshot_table_exists() -> bool:
    try:
        _ensure_db()
        with database.db_engine.connect() as conn:
            conn.execute(text("SELECT 1 FROM public.pill_price_snapshot LIMIT 1"))
        return True
    except Exception as exc:
        if _relation_missing(exc):
            return False
        raise
