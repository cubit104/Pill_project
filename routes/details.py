import re
import logging
import os
from collections import OrderedDict
from datetime import timezone
from typing import Optional, List, Dict, Any
from threading import Lock
import time

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from services.medication_guide import (
    GuideInternalError,
    GuideNotFoundError,
    GuideValidationError,
    build_guide,
)
from services.openfda_client import OpenFDAUpstreamError
from services.synonym_resolver import get_synonyms_for_rxcui, filter_self_from_brands
from ndc_normalize import normalize_ndc_to_11
from utils import normalize_imprint, normalize_name, normalize_fields, process_image_filenames, slugify_class

logger = logging.getLogger(__name__)
IMAGE_BASE = (os.getenv("IMAGE_BASE") or "").strip().rstrip("/")

# SQL expression to normalize medicine_name to a drug-name slug.
# Mirrors slugifyDrugName() in frontend/app/lib/slug.ts:
# preserve case with [^a-zA-Z0-9]+, then lower(), then trim dashes.
_MEDICINE_SLUG_EXPR = (
    "trim(lower(regexp_replace(medicine_name, '[^a-zA-Z0-9]+', '-', 'g')), '-')"
)
_IMAGE_BASE_WARNING_EMITTED = False
_HISTORY_RESOLUTION_TTL_SECONDS = int(os.getenv("PILL_HISTORY_RESOLUTION_TTL_SECONDS", "3600"))
_HISTORY_RESOLUTION_CACHE_MAX_ITEMS = int(os.getenv("PILL_HISTORY_RESOLUTION_CACHE_MAX_ITEMS", "1000"))
_NORMALIZED_IMPRINT_SQL = "UPPER(REGEXP_REPLACE(COALESCE(splimprint, ''), '[;,\\s]+', ' ', 'g'))"
_SORTED_IMPRINT_SQL = (
    "(SELECT string_agg(tok, ' ' ORDER BY tok) "
    f"FROM regexp_split_to_table({_NORMALIZED_IMPRINT_SQL}, ' ') tok "
    "WHERE tok <> '')"
)
_history_resolution_cache: "OrderedDict[str, tuple[float, dict[str, Any]]]" = OrderedDict()
_history_resolution_cache_lock = Lock()

router = APIRouter()
CACHE_CONTROL_HEADER = "public, max-age=3600, stale-while-revalidate=86400"


def _to_iso(value) -> Optional[str]:
    """Convert a DB timestamp to an ISO 8601 string with a UTC 'Z' suffix.

    Accepts datetime objects, date objects, or strings. Returns None when the
    value is falsy or cannot be parsed, so the frontend never receives an empty
    string that would cause `new Date("")` to fail silently.
    """
    if not value:
        return None
    import datetime
    if isinstance(value, datetime.datetime):
        # Ensure UTC offset; treat naive datetimes as UTC.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, datetime.date):
        return value.strftime("%Y-%m-%dT00:00:00Z")
    # String fallback — try to parse common formats before giving up.
    s = str(value).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.datetime.strptime(s, fmt)
            return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
    return None

def _aggregate_image_filenames(conn, raw_medicine_name: str, raw_splimprint: str, own_image_filename: str) -> str:
    """Collect image filenames for a pill by combining the row's own image_filename
    with any others found for the same drug+imprint (normalized comparison)."""
    collected = []
    seen = set()

    def _add(value):
        if not value:
            return
        for part in re.split(r"[,;]+", str(value)):
            p = part.strip()
            if p and p not in seen:
                seen.add(p)
                collected.append(p)

    # 1) Row's own image_filename first
    _add(own_image_filename)

    # 2) Aggregate from other rows with the same drug+imprint (normalized)
    try:
        image_q = text("""
            SELECT image_filename FROM pillfinder
            WHERE deleted_at IS NULL
              AND published = true
              AND LOWER(TRIM(medicine_name)) = LOWER(TRIM(:medicine_name))
              AND COALESCE(""" + _SORTED_IMPRINT_SQL + """, '') = UPPER(:splimprint)
              AND image_filename IS NOT NULL
              AND image_filename != ''
        """)
        img_rows = conn.execute(image_q, {
            "medicine_name": raw_medicine_name,
            "splimprint": normalize_imprint(raw_splimprint),
        })
        for r in img_rows:
            _add(r[0])
    except Exception as e:
        logger.warning(f"Image aggregation query failed: {e}")

    return ",".join(collected)


def _build_image_urls(image_filenames: str) -> list[str]:
    global _IMAGE_BASE_WARNING_EMITTED
    if not IMAGE_BASE and not _IMAGE_BASE_WARNING_EMITTED:
        logger.warning("IMAGE_BASE is not set; returning raw image filenames in API responses")
        _IMAGE_BASE_WARNING_EMITTED = True
    urls: list[str] = []
    for part in re.split(r"[,;]+", image_filenames or ""):
        value = part.strip()
        if not value:
            continue
        if value.startswith(("http://", "https://")):
            urls.append(value)
        elif IMAGE_BASE:
            urls.append(f"{IMAGE_BASE}/{value.lstrip('/')}")
        else:
            urls.append(value)
    return urls


def _normalize_ndc_digits(value: Any) -> Optional[str]:
    """Return a digits-only 11-character NDC, handling FDA 4-4-2 / 5-3-2 / 5-4-1 / 5-4-2 forms.

    Routes hyphenated inputs through ndc_normalize.normalize_ndc_to_11 so that
    pillfinder values like '0169-4425-31' (4-4-2) are padded to canonical
    '00169-4425-31' before being stripped to 11 digits. Returns None when the
    input cannot be normalized (e.g. product-code-only NDCs like '0169-4425'
    with no package segment).
    """
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    canonical = normalize_ndc_to_11(raw)
    if canonical:
        digits = re.sub(r"[^0-9]", "", canonical)
        if len(digits) == 11:
            return digits
    # Fallback: caller already passed 11 raw digits.
    digits = re.sub(r"[^0-9]", "", raw)
    return digits if len(digits) == 11 else None


def _get_cached_history_resolution(slug: str) -> Optional[dict[str, Any]]:
    now = time.time()
    with _history_resolution_cache_lock:
        cached = _history_resolution_cache.get(slug)
        if not cached:
            return None
        expires_at, payload = cached
        if expires_at <= now:
            _history_resolution_cache.pop(slug, None)
            return None
        _history_resolution_cache.move_to_end(slug)
        return dict(payload)


def _set_cached_history_resolution(slug: str, payload: dict[str, Any]) -> None:
    now = time.time()
    expires_at = now + _HISTORY_RESOLUTION_TTL_SECONDS
    stored = {
        "history_ndc": payload.get("history_ndc"),
        "history_source": payload.get("history_source"),
    }
    with _history_resolution_cache_lock:
        _history_resolution_cache[slug] = (expires_at, stored)
        _history_resolution_cache.move_to_end(slug)
        while len(_history_resolution_cache) > _HISTORY_RESOLUTION_CACHE_MAX_ITEMS:
            _history_resolution_cache.popitem(last=False)


def _history_count_for_ndc(conn, ndc_digits: str) -> int:
    try:
        count = conn.execute(
            text("SELECT count(*) FROM drug_price_history WHERE ndc = :ndc"),
            {"ndc": ndc_digits},
        ).scalar()
        return int(count or 0)
    except SQLAlchemyError as e:
        err_msg = str(e).lower()
        if "drug_price_history" in err_msg and (
            "does not exist" in err_msg or "no such table" in err_msg
        ):
            logger.debug("drug_price_history table not yet created: %s", e)
            return 0
        logger.warning("history count query failed for ndc=%s: %s", ndc_digits, e)
        return 0


def _resolve_history_identifier(
    conn,
    *,
    slug: str,
    canonical_ndc: Optional[str],
    rxcui: Optional[str],  # reserved for future use
    medicine_name: Optional[str],  # reserved for future use
) -> dict[str, Any]:
    """Resolve the best NDC to use for the price-history graph.

    Strategy (in priority order):
      1. If the canonical pillfinder NDC normalizes successfully, return it
         immediately. The frontend will call /api/prices/{ndc}/history which
         hits NADAC live on cache miss and seeds drug_price_history. This
         path is FAST and makes NO live HTTP calls from inside this function.
      2. Otherwise (canonical NDC unparseable), fall back to checking
         drug_price_history for any rows under the canonical digits — purely
         a local DB query, still no live HTTP.
      3. Otherwise return None. The frontend will not render a graph; the
         drug almost certainly has a malformed pillfinder.ndc11 (no package
         segment), which is a data-quality issue handled outside this code.

    The previous implementation spawned a ThreadPoolExecutor with workers
    that each called asyncio.run() — this leaked event loops and httpx
    clients, exhausting the shared connection pool under concurrent load
    and producing httpx.PoolTimeout exceptions that bubbled up as SSR 5xx
    errors on the Next.js side.
    """
    cached = _get_cached_history_resolution(slug)
    if cached is not None:
        return cached

    canonical_digits = _normalize_ndc_digits(canonical_ndc)
    if canonical_digits:
        # Fast path: trust the canonical NDC. /history will hit NADAC live
        # on cache miss and seed drug_price_history.
        payload = {"history_ndc": canonical_digits, "history_source": "ndc"}
        _set_cached_history_resolution(slug, payload)
        return payload

    # Canonical NDC was unparseable (e.g. truncated product-only NDC).
    # Last-ditch: see if drug_price_history happens to have rows for the
    # raw digits we extracted — purely local DB, still no live HTTP.
    raw_digits = re.sub(r"[^0-9]", "", str(canonical_ndc or ""))
    if len(raw_digits) == 11 and _history_count_for_ndc(conn, raw_digits) > 0:
        payload = {"history_ndc": raw_digits, "history_source": "ndc"}
        _set_cached_history_resolution(slug, payload)
        return payload

    payload = {"history_ndc": None, "history_source": None}
    _set_cached_history_resolution(slug, payload)
    return payload


@router.get("/details")
def get_pill_details(
    imprint: Optional[str] = Query(None),
    drug_name: Optional[str] = Query(None),
    rxcui: Optional[str] = Query(None),
    ndc: Optional[str] = Query(None),
):
    """Get details about a pill, trusting the database for image filenames."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    used_ndc = False

    try:
        with database.db_engine.connect() as conn:
            if ndc:
                used_ndc = True
                clean_ndc = re.sub(r'[^0-9]', '', ndc)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND (
                        ndc11 = :ndc
                        OR ndc9  = :ndc
                        OR REPLACE(ndc11, '-', '') = :clean_ndc
                        OR REPLACE(ndc9,  '-', '') = :clean_ndc
                      )
                    LIMIT 1
                """)
                result = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})

            elif rxcui:
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND rxcui = :rxcui
                    LIMIT 1
                """)
                result = conn.execute(query, {"rxcui": rxcui})

            elif imprint and drug_name:
                norm_imp = normalize_imprint(imprint)
                norm_name_val = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND """ + _SORTED_IMPRINT_SQL + """ = UPPER(:imprint)
                      AND LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp, "drug_name": norm_name_val})

            elif imprint:
                norm_imp = normalize_imprint(imprint)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND """ + _SORTED_IMPRINT_SQL + """ = UPPER(:imprint)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp})

            elif drug_name:
                norm_name_val = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"drug_name": norm_name_val})

            else:
                raise HTTPException(status_code=400, detail="At least one search parameter is required")

            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No pills found matching your criteria")

            columns = result.keys()
            pill_info = dict(zip(columns, row))

            # Capture RAW values BEFORE normalization (DB stores raw lowercase)
            raw_medicine_name = pill_info.get("medicine_name", "") or ""
            raw_splimprint = pill_info.get("splimprint", "") or ""
            raw_image_filename = pill_info.get("image_filename", "") or ""

            pill_info = normalize_fields(pill_info)

            if used_ndc:
                filenames = raw_image_filename
            else:
                filenames = _aggregate_image_filenames(conn, raw_medicine_name, raw_splimprint, raw_image_filename)

            # Fetch additional NDCs from pill_ndcs sibling table
            pill_ndcs_rows = []
            try:
                ndcs_result = conn.execute(
                    text(
                        """
                        SELECT ndc11, package_description, is_primary
                        FROM pill_ndcs
                        WHERE pill_id = :pill_id
                        ORDER BY is_primary DESC, ndc11
                        """
                    ),
                    {"pill_id": str(pill_info.get("id"))},
                )
                pill_ndcs_rows = ndcs_result.fetchall()
            except SQLAlchemyError as _e:
                err_msg = str(_e).lower()
                if "pill_ndcs" in err_msg and (
                    "does not exist" in err_msg or "no such table" in err_msg
                ):
                    logger.debug("pill_ndcs table not yet created: %s", _e)
                else:
                    logger.warning(
                        "pill_ndcs lookup failed for pill %s: %s", pill_info.get("id"), _e
                    )

        image_data = process_image_filenames(filenames)
        pill_info.update(image_data)
        pill_info["additional_ndcs"] = [
            {"ndc11": r[0], "package_description": r[1]}
            for r in pill_ndcs_rows
            if not r[2]  # is_primary == False
        ]

        logger.info(f"Details for {pill_info.get('medicine_name')}: {len(pill_info['image_urls'])} images")
        return pill_info

    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/pill/{slug}")
def get_pill_by_slug(slug: str):
    """Get pill details by URL slug for SEO pages"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            query = text("SELECT * FROM pillfinder WHERE deleted_at IS NULL AND published = true AND slug = :slug LIMIT 1")
            result = conn.execute(query, {"slug": slug})
            row = result.fetchone()
            if not row:
                # Fallback: match by normalized drug-name slug against medicine_name
                # using the shared _MEDICINE_SLUG_EXPR constant defined at module level.
                result = conn.execute(
                    text(
                        f"""
                        SELECT * FROM pillfinder
                        WHERE deleted_at IS NULL AND published = true
                          AND {_MEDICINE_SLUG_EXPR} = :slug
                        ORDER BY updated_at DESC NULLS LAST
                        LIMIT 1
                        """
                    ),
                    {"slug": slug},
                )
                row = result.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Pill not found")

            columns = result.keys()
            pill_info = dict(zip(columns, row))

            # Capture RAW values BEFORE normalization (DB stores raw lowercase)
            raw_medicine_name = pill_info.get("medicine_name", "") or ""
            raw_splimprint = pill_info.get("splimprint", "") or ""
            raw_image_filename = pill_info.get("image_filename", "") or ""

            pill_info = normalize_fields(pill_info)

            # Aggregate images: own row first, then other rows with same drug+imprint (normalized)
            filenames = _aggregate_image_filenames(conn, raw_medicine_name, raw_splimprint, raw_image_filename)

            image_urls = _build_image_urls(filenames)

            logger.info(f"Slug {slug}: medicine_name={raw_medicine_name!r}, splimprint={raw_splimprint!r}, found {len(image_urls)} images, own_filename={raw_image_filename!r}")

            # Fetch additional NDCs from pill_ndcs sibling table
            additional_ndcs = []
            try:
                ndcs_result = conn.execute(
                    text(
                        """
                        SELECT ndc11, package_description, is_primary
                        FROM pill_ndcs
                        WHERE pill_id = :pill_id
                        ORDER BY is_primary DESC, ndc11
                        """
                    ),
                    {"pill_id": str(pill_info.get("id"))},
                )
                additional_ndcs = [
                    {"ndc11": r[0], "package_description": r[1]}
                    for r in ndcs_result.fetchall()
                    if not r[2]  # is_primary == False
                ]
            except SQLAlchemyError as _e:
                err_msg = str(_e).lower()
                if "pill_ndcs" in err_msg and (
                    "does not exist" in err_msg or "no such table" in err_msg
                ):
                    logger.debug("pill_ndcs table not yet created: %s", _e)
                else:
                    logger.warning("pill_ndcs lookup failed for %s: %s", slug, _e)

            guide_params = {
                "spl_set_id": str(pill_info.get("spl_set_id") or ""),
                "rxcui": str(pill_info.get("rxcui") or ""),
                "ndc11": str(pill_info.get("ndc11") or ""),
                "ndc9": str(pill_info.get("ndc9") or ""),
                "ndc11_clean": str(pill_info.get("ndc11") or "").replace("-", ""),
                "ndc9_clean": str(pill_info.get("ndc9") or "").replace("-", ""),
            }
            # Static WHERE / ORDER clause reused by both the primary and compat queries.
            # All filter values are passed as named bind parameters — no user input is
            # interpolated into the SQL text.
            guide_filter_clause = """
                        WHERE (
                                :spl_set_id <> ''
                                AND mg.spl_set_id = :spl_set_id
                            ) OR (
                                :rxcui <> ''
                                AND mg.rxcui = :rxcui
                            ) OR (
                                :ndc11 <> ''
                                AND (
                                    mg.ndc = :ndc11
                                    OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc11_clean
                                )
                            ) OR (
                                :ndc9 <> ''
                                AND (
                                    mg.ndc = :ndc9
                                    OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc9_clean
                                )
                            )
                        ORDER BY
                            CASE WHEN :spl_set_id <> '' AND mg.spl_set_id = :spl_set_id THEN 0 ELSE 1 END,
                            CASE WHEN :rxcui <> '' AND mg.rxcui = :rxcui THEN 0 ELSE 1 END,
                            mg.updated_at DESC NULLS LAST
                        LIMIT 1
            """
            guide_flags = {
                "has_medguide": False,
                "has_medication_summary": False,
                "has_dosage": False,
                "has_adverse_reactions": False,
            }
            try:
                guide_row = conn.execute(
                    text(
                        """
                        SELECT
                            (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide,
                            (NULLIF(mg.medication_summary_html, '') IS NOT NULL) AS has_medication_summary,
                            (
                                NULLIF(mg.dosage_administration, '') IS NOT NULL
                                OR NULLIF(mg.dosage, '') IS NOT NULL
                            ) AS has_dosage,
                            (NULLIF(mg.side_effects, '') IS NOT NULL) AS has_adverse_reactions
                        FROM public.medication_guide mg
                        """
                        + guide_filter_clause
                    ),
                    guide_params,
                ).fetchone()
                if guide_row:
                    guide_flags = {
                        "has_medguide": bool(guide_row[0]),
                        "has_medication_summary": bool(guide_row[1]),
                        "has_dosage": bool(guide_row[2]),
                        "has_adverse_reactions": bool(guide_row[3]),
                    }
            except SQLAlchemyError as _e:
                err_msg = str(_e).lower()
                # Detect missing-column errors for not-yet-applied guide schema migrations.
                pg_code = getattr(getattr(_e, "orig", None), "pgcode", None)
                _is_missing_col = pg_code == "42703" or (
                    "does not exist" in err_msg
                    or "undefined" in err_msg
                    or "no such column" in err_msg
                )
                if _is_missing_col:
                    logger.debug(
                        "Medication guide columns missing, using compat query for %s: %s",
                        slug,
                        _e,
                    )
                    summary_column_missing = "medication_summary_html" in err_msg
                    try:
                        if summary_column_missing:
                            legacy_row = conn.execute(
                                text(
                                    """
                                    SELECT
                                        (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide
                                    FROM public.medication_guide mg
                                    """
                                    + guide_filter_clause
                                ),
                                guide_params,
                            ).fetchone()
                            if legacy_row:
                                guide_flags = {
                                    "has_medguide": bool(legacy_row[0]),
                                    "has_medication_summary": False,
                                    "has_dosage": False,
                                    "has_adverse_reactions": False,
                                }
                        else:
                            compat_row = conn.execute(
                                text(
                                    """
                                    SELECT
                                        (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide,
                                        (NULLIF(mg.medication_summary_html, '') IS NOT NULL) AS has_medication_summary
                                    FROM public.medication_guide mg
                                    """
                                    + guide_filter_clause
                                ),
                                guide_params,
                            ).fetchone()
                            if compat_row:
                                guide_flags = {
                                    "has_medguide": bool(compat_row[0]),
                                    "has_medication_summary": bool(compat_row[1]),
                                    "has_dosage": False,
                                    "has_adverse_reactions": False,
                                }
                    except SQLAlchemyError as _compat_e:
                        compat_msg = str(_compat_e).lower()
                        compat_pg_code = getattr(getattr(_compat_e, "orig", None), "pgcode", None)
                        compat_missing_col = compat_pg_code == "42703" or (
                            "does not exist" in compat_msg
                            or "undefined" in compat_msg
                            or "no such column" in compat_msg
                        )
                        if compat_missing_col:
                            try:
                                legacy_row = conn.execute(
                                    text(
                                        """
                                        SELECT
                                            (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide
                                        FROM public.medication_guide mg
                                        """
                                        + guide_filter_clause
                                    ),
                                    guide_params,
                                ).fetchone()
                                if legacy_row:
                                    guide_flags = {
                                        "has_medguide": bool(legacy_row[0]),
                                        "has_medication_summary": False,
                                        "has_dosage": False,
                                        "has_adverse_reactions": False,
                                    }
                            except SQLAlchemyError as _legacy_e:
                                logger.warning(
                                    "Medication guide legacy flag lookup failed for %s: %s",
                                    slug,
                                    _legacy_e,
                                )
                        else:
                            logger.warning(
                                "Medication guide compat flag lookup failed for %s: %s",
                                slug,
                                _compat_e,
                            )
                else:
                    logger.warning("Medication guide flag lookup failed for %s: %s", slug, _e)

            mapped = {
                "drug_name": pill_info.get("medicine_name"),
                "imprint": pill_info.get("splimprint"),
                "color": pill_info.get("splcolor_text"),
                "shape": pill_info.get("splshape_text"),
                "ndc": pill_info.get("ndc11"),
                "ndc9": pill_info.get("ndc9"),
                "rxcui": str(pill_info.get("rxcui", "") or ""),
                "slug": pill_info.get("slug"),
                "strength": pill_info.get("spl_strength"),
                "manufacturer": pill_info.get("author"),
                "ingredients": pill_info.get("spl_ingredients"),
                "inactive_ingredients": pill_info.get("spl_inactive_ing"),
                "dea_schedule": pill_info.get("dea_schedule_name"),
                "pharma_class": pill_info.get("dailymed_pharma_class_epc") or pill_info.get("pharmclass_fda_epc"),
                "size": str(pill_info.get("splsize", "") or ""),
                "dosage_form": pill_info.get("dosage_form"),
                "brand_names": pill_info.get("brand_names"),
                "status_rx_otc": pill_info.get("status_rx_otc"),
                "route": pill_info.get("route"),
                "meta_title": pill_info.get("meta_title") or None,
                "image_url": image_urls[0] if image_urls else None,
                "image_urls": image_urls,
                "images": image_urls,
                "has_multiple_images": len(image_urls) > 1,
                "carousel_images": [{"id": i, "url": url} for i, url in enumerate(image_urls)],
                # Source-citation / freshness fields — present only when the DB has them.
                # updated_at is serialised as ISO 8601 with a trailing 'Z' so the frontend
                # can reliably parse it with new Date() on all JS engines.
                "spl_set_id": pill_info.get("spl_set_id") or pill_info.get("setid") or pill_info.get("spl_set_id_value"),
                "updated_at": _to_iso(
                    pill_info.get("updated_at")
                    or pill_info.get("last_updated")
                    or pill_info.get("ingested_at")
                ),
                "has_medguide": guide_flags["has_medguide"],
                "has_medication_summary": guide_flags["has_medication_summary"],
                "has_dosage": guide_flags["has_dosage"],
                "has_adverse_reactions": guide_flags["has_adverse_reactions"],
                "additional_ndcs": additional_ndcs,
                "meta_description": pill_info.get("meta_description") or None,
                "indication": None,
                "generic_name": None,
                "brand_names_all": [],
                "is_brand_row": False,
            }

            synonyms = get_synonyms_for_rxcui(conn, mapped["rxcui"]) if mapped.get("rxcui") else {}
            if synonyms:
                mapped["generic_name"] = synonyms.get("generic_name")
                mapped["brand_names_all"] = filter_self_from_brands(
                    synonyms.get("brand_names") or [],
                    pill_info.get("medicine_name") or "",
                )
                mapped["is_brand_row"] = (synonyms.get("product_tty") in ("SBD", "BPCK"))

            history_resolution = _resolve_history_identifier(
                conn,
                slug=str(pill_info.get("slug") or slug),
                canonical_ndc=pill_info.get("ndc11"),
                rxcui=pill_info.get("rxcui"),
                medicine_name=pill_info.get("medicine_name"),
            )
            mapped["history_ndc"] = history_resolution.get("history_ndc")
            mapped["history_source"] = history_resolution.get("history_source")

            # Fetch patient-friendly indication text from drug_indications (keyed by rxcui).
            rxcui_val = pill_info.get("rxcui")
            if rxcui_val:
                try:
                    ind_result = conn.execute(
                        text(
                            """
                            SELECT plain_text, source_url, source, fetched_at
                            FROM drug_indications
                            WHERE rxcui = :rxcui
                              AND plain_text IS NOT NULL
                            LIMIT 1
                            """
                        ),
                        {"rxcui": str(rxcui_val)},
                    )
                    ind_row = ind_result.fetchone()
                    if ind_row:
                        row_map = ind_row._mapping
                        mapped["indication"] = {
                            "plain_text": row_map["plain_text"],
                            "source_url": row_map["source_url"],
                            "source": row_map["source"],
                            "fetched_at": _to_iso(row_map["fetched_at"]),
                        }
                except SQLAlchemyError as _e:
                    err_msg = str(_e).lower()
                    if "drug_indications" in err_msg and (
                        "does not exist" in err_msg or "no such table" in err_msg
                    ):
                        logger.debug("drug_indications table not yet created: %s", _e)
                    else:
                        logger.warning("drug_indications lookup failed for rxcui=%s: %s", rxcui_val, _e)

        return mapped

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _fetch_dosage_guide_row(conn, *, spl_set_id: Optional[str], ndc: Optional[str], rxcui: Optional[str]):
    """Load one medication_guide row for dosage fields using prioritized identifiers."""
    params = {
        "spl_set_id": str(spl_set_id or ""),
        "ndc": str(ndc or ""),
        "ndc_clean": str(ndc or "").replace("-", ""),
        "rxcui": str(rxcui or ""),
    }
    return conn.execute(
        text(
            """
            SELECT
                mg.generic_name,
                mg.brand_name,
                mg.rxcui,
                mg.ndc,
                mg.spl_set_id,
                mg.dosage_administration,
                mg.dosage,
                mg.side_effects,
                mg.has_boxed_warning,
                mg.boxed_warning_html,
                mg.source_url,
                mg.fetched_at
            FROM public.medication_guide mg
            WHERE (
                    :spl_set_id <> ''
                    AND mg.spl_set_id = :spl_set_id
                ) OR (
                    :ndc <> ''
                    AND (
                        mg.ndc = :ndc
                        OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc_clean
                    )
                ) OR (
                    :rxcui <> ''
                    AND mg.rxcui = :rxcui
                )
            ORDER BY
                CASE
                    WHEN :spl_set_id <> '' AND mg.spl_set_id = :spl_set_id THEN 0
                    WHEN :ndc <> '' AND (
                        mg.ndc = :ndc
                        OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = :ndc_clean
                    ) THEN 1
                    WHEN :rxcui <> '' AND mg.rxcui = :rxcui THEN 2
                    ELSE 3
                END,
                mg.updated_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        params,
    ).fetchone()


async def _resolve_dosage_guide_data(pill_info: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve dosage guide data via build_guide using setid → ndc11 → rxcui → ndc9."""
    attempts: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for key, value in (
        ("spl_set_id", pill_info.get("spl_set_id")),
        ("ndc", pill_info.get("ndc11")),
        ("rxcui", pill_info.get("rxcui")),
        ("ndc", pill_info.get("ndc9")),
    ):
        normalized = str(value or "").strip()
        if not normalized:
            continue
        attempt = (key, normalized)
        if attempt in seen:
            continue
        seen.add(attempt)
        attempts.append(attempt)

    for key, value in attempts:
        try:
            if key == "spl_set_id":
                payload = await build_guide(spl_set_id=value)
            elif key == "ndc":
                payload = await build_guide(ndc=value)
            elif key == "rxcui":
                payload = await build_guide(rxcui=value)
            else:
                logger.warning("Unsupported dosage guide resolver key=%s", key)
                continue
        except (GuideNotFoundError, GuideValidationError):
            continue
        except OpenFDAUpstreamError:
            raise
        except GuideInternalError:
            raise
        except Exception:
            logger.warning("Dosage guide resolution failed for %s=%s", key, value, exc_info=True)
            continue

        spl_set_id = payload.get("spl_set_id") if isinstance(payload, dict) else None
        ndc = payload.get("ndc") if isinstance(payload, dict) else None
        rxcui = payload.get("rxcui") if isinstance(payload, dict) else None

        if key == "spl_set_id":
            spl_set_id = spl_set_id or value
        elif key == "ndc":
            ndc = ndc or value
        elif key == "rxcui":
            rxcui = rxcui or value

        with database.db_engine.connect() as conn:
            guide_row = _fetch_dosage_guide_row(
                conn,
                spl_set_id=spl_set_id,
                ndc=ndc,
                rxcui=rxcui,
            )
        if guide_row:
            return dict(guide_row._mapping)

    return {}


@router.get("/api/pill/{slug}/dosage")
async def get_pill_dosage_by_slug(slug: str):
    """Get dosage content for a pill slug using medication_guide resolver parity."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            pill_result = conn.execute(
                text(
                    """
                    SELECT
                        medicine_name,
                        rxcui,
                        ndc11,
                        ndc9,
                        spl_set_id,
                        dosage_form,
                        dailymed_pharma_class_epc,
                        pharmclass_fda_epc
                    FROM pillfinder
                    WHERE deleted_at IS NULL AND published = true AND slug = :slug
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            )
            pill_row = pill_result.fetchone()
            if not pill_row:
                # Fallback: match by normalized drug-name slug against medicine_name
                # using the shared _MEDICINE_SLUG_EXPR constant defined at module level.
                pill_result = conn.execute(
                    text(
                        f"""
                        SELECT
                            medicine_name,
                            rxcui,
                            ndc11,
                            ndc9,
                            spl_set_id,
                            dosage_form,
                            dailymed_pharma_class_epc,
                            pharmclass_fda_epc
                        FROM pillfinder
                        WHERE deleted_at IS NULL AND published = true
                          AND {_MEDICINE_SLUG_EXPR} = :slug
                        ORDER BY updated_at DESC NULLS LAST
                        LIMIT 1
                        """
                    ),
                    {"slug": slug},
                )
                pill_row = pill_result.fetchone()
                if not pill_row:
                    raise HTTPException(status_code=404, detail="Pill not found")

            pill_columns = pill_result.keys()
            pill_info = dict(zip(pill_columns, pill_row))

        guide_data = await _resolve_dosage_guide_data(pill_info)
        dosage_value = guide_data.get("dosage_administration")
        dosage_administration = dosage_value.strip() if isinstance(dosage_value, str) else dosage_value
        if isinstance(dosage_administration, str) and not dosage_administration:
            dosage_administration = None

        return JSONResponse(content={
            "drug_name": pill_info.get("medicine_name"),
            "generic_name": guide_data.get("generic_name"),
            "brand_name": guide_data.get("brand_name"),
            "rxcui": guide_data.get("rxcui") or pill_info.get("rxcui"),
            "ndc": guide_data.get("ndc") or pill_info.get("ndc11") or pill_info.get("ndc9"),
            "spl_set_id": guide_data.get("spl_set_id") or pill_info.get("spl_set_id"),
            "dosage_administration": dosage_administration,
            "dosage_forms_and_strengths": guide_data.get("dosage") or None,
            "has_boxed_warning": bool(guide_data.get("has_boxed_warning")),
            "boxed_warning_html": guide_data.get("boxed_warning_html"),
            "drug_class": (
                pill_info.get("dailymed_pharma_class_epc")
                or pill_info.get("pharmclass_fda_epc")
            ),
            "dosage_form": pill_info.get("dosage_form"),
            "source_url": guide_data.get("source_url"),
            "fetched_at": _to_iso(guide_data.get("fetched_at")),
        }, headers={"Cache-Control": CACHE_CONTROL_HEADER})
    except GuideNotFoundError:
        return JSONResponse(status_code=404, content={"error": "No FDA label found for this drug"})
    except OpenFDAUpstreamError:
        return JSONResponse(status_code=502, content={"error": "Failed to fetch FDA label"})
    except GuideInternalError as exc:
        logger.error("Medication guide internal error (slug=%s): %s", slug, exc)
        return JSONResponse(status_code=500, content={"error": "Internal server error"})
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_dosage_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_dosage_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/pill/{slug}/adverse-reactions")
async def get_pill_adverse_reactions_by_slug(slug: str):
    """Get adverse reactions content for a pill slug using medication_guide resolver parity."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            pill_result = conn.execute(
                text(
                    """
                    SELECT
                        medicine_name,
                        rxcui,
                        ndc11,
                        ndc9,
                        spl_set_id,
                        dosage_form
                    FROM pillfinder
                    WHERE deleted_at IS NULL AND published = true AND slug = :slug
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            )
            pill_row = pill_result.fetchone()
            if not pill_row:
                pill_result = conn.execute(
                    text(
                        """
                        SELECT
                            medicine_name,
                            rxcui,
                            ndc11,
                            ndc9,
                            spl_set_id,
                            dosage_form
                        FROM pillfinder
                        WHERE deleted_at IS NULL AND published = true
                          AND trim(lower(regexp_replace(medicine_name, '[^a-zA-Z0-9]+', '-', 'g')), '-') = :slug
                        ORDER BY updated_at DESC NULLS LAST
                        LIMIT 1
                        """
                    ),
                    {"slug": slug},
                )
                pill_row = pill_result.fetchone()
                if not pill_row:
                    raise HTTPException(status_code=404, detail="Pill not found")

            pill_columns = pill_result.keys()
            pill_info = dict(zip(pill_columns, pill_row))

        guide_data = await _resolve_dosage_guide_data(pill_info)
        adverse_html = guide_data.get("side_effects")
        adverse_reactions = adverse_html.strip() if isinstance(adverse_html, str) else adverse_html
        if isinstance(adverse_reactions, str) and not adverse_reactions:
            adverse_reactions = None

        return JSONResponse(content={
            "drug_name": pill_info.get("medicine_name"),
            "generic_name": guide_data.get("generic_name"),
            "brand_name": guide_data.get("brand_name"),
            "rxcui": guide_data.get("rxcui") or pill_info.get("rxcui"),
            "ndc": guide_data.get("ndc") or pill_info.get("ndc11") or pill_info.get("ndc9"),
            "spl_set_id": guide_data.get("spl_set_id") or pill_info.get("spl_set_id"),
            "adverse_reactions": adverse_reactions,
            "side_effects": adverse_reactions,
            "dosage_form": pill_info.get("dosage_form"),
            "source_url": guide_data.get("source_url"),
            "fetched_at": _to_iso(guide_data.get("fetched_at")),
        }, headers={"Cache-Control": CACHE_CONTROL_HEADER})
    except GuideNotFoundError:
        return JSONResponse(status_code=404, content={"error": "No FDA label found for this drug"})
    except OpenFDAUpstreamError:
        return JSONResponse(status_code=502, content={"error": "Failed to fetch FDA label"})
    except GuideInternalError as exc:
        logger.error("Medication guide internal error (slug=%s): %s", slug, exc)
        return JSONResponse(status_code=500, content={"error": "Internal server error"})
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_adverse_reactions_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_adverse_reactions_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _row_to_drug_dict(r: Any) -> Dict[str, Any]:
    """Convert a DB row (medicine_name, spl_strength, slug, splcolor_text, splshape_text, image_filename)
    to a drug dict suitable for API responses."""
    image_url = None
    if r[5]:
        # Use the lightweight helper — just take the first filename, no extra processing
        first_filename = str(r[5]).split(',')[0].strip()
        if first_filename:
            from utils import IMAGE_BASE
            image_url = f"{IMAGE_BASE}/{first_filename}"
    return {
        "drug_name": r[0],
        "strength": r[1],
        "slug": r[2],
        "color": r[3],
        "shape": r[4],
        "image_url": image_url,
    }


@router.get("/api/related/{slug}")
def get_related_by_class(slug: str, limit: int = Query(default=10, ge=1, le=50)):
    """Return up to `limit` other medications in the same pharmacologic class.
    Excludes the input pill itself and dedupes by drug_name+strength."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            # 1) Resolve the input pill's pharma class
            row = conn.execute(text("""
                SELECT medicine_name, dailymed_pharma_class_epc, pharmclass_fda_epc
                FROM pillfinder WHERE deleted_at IS NULL AND published = true AND slug = :slug LIMIT 1
            """), {"slug": slug}).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pill not found")

            own_name, cls_epc, cls_fda = row
            cls = cls_epc or cls_fda
            if not cls:
                return {"pharma_class": None, "related": []}

            # 2) Find other drugs in the same class. Dedup by medicine_name+spl_strength.
            # Exclude by slug (exact row) so same-name different-strength rows are included.
            q = text("""
                SELECT DISTINCT ON (medicine_name, spl_strength)
                    medicine_name, spl_strength, slug, splcolor_text, splshape_text,
                    image_filename
                FROM pillfinder
                WHERE deleted_at IS NULL
                  AND published = true
                  AND (dailymed_pharma_class_epc = :cls OR pharmclass_fda_epc = :cls)
                  AND slug IS NOT NULL AND slug != ''
                  AND slug != :slug
                ORDER BY medicine_name, spl_strength, slug
                LIMIT :limit
            """)
            rows = conn.execute(q, {"cls": cls, "slug": slug, "limit": limit}).fetchall()

            related = [_row_to_drug_dict(r) for r in rows]

            return {"pharma_class": cls, "related": related}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_related_by_class: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/api/classes")
def list_pharma_classes():
    """Return all pharma classes with counts, for sitemap + hub page discovery."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            q = text("""
                SELECT class_name, COUNT(*) AS count
                FROM (
                  SELECT DISTINCT
                    medicine_name,
                    spl_strength,
                    COALESCE(dailymed_pharma_class_epc, pharmclass_fda_epc) AS class_name
                  FROM pillfinder
                  WHERE deleted_at IS NULL
                    AND published = true
                    AND (dailymed_pharma_class_epc IS NOT NULL OR pharmclass_fda_epc IS NOT NULL)
                    AND slug IS NOT NULL AND slug != ''
                ) sub
                WHERE class_name IS NOT NULL
                GROUP BY class_name
                HAVING COUNT(*) >= 2
                ORDER BY COUNT(*) DESC
            """)
            rows = conn.execute(q).fetchall()
            return [{"class_name": r[0], "slug": slugify_class(r[0]), "count": r[1]} for r in rows]
    except SQLAlchemyError as e:
        logger.error(f"Database error in list_pharma_classes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/api/class/{class_slug}")
def get_class_drugs(class_slug: str, limit: int = Query(default=100, ge=1, le=500)):
    """Return drugs in a pharmacologic class by slug."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            # Resolve class name in SQL using the same slug transform (lower + non-alnum → hyphen)
            q = text("""
                SELECT DISTINCT class_name
                FROM (
                    SELECT COALESCE(dailymed_pharma_class_epc, pharmclass_fda_epc) AS class_name
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND (dailymed_pharma_class_epc IS NOT NULL OR pharmclass_fda_epc IS NOT NULL)
                      AND slug IS NOT NULL AND slug != ''
                ) sub
                WHERE class_name IS NOT NULL
                  AND LOWER(
                      TRIM(BOTH '-' FROM REGEXP_REPLACE(
                          LOWER(class_name),
                          '[^a-z0-9]+',
                          '-',
                          'g'
                      ))
                  ) = :class_slug
                LIMIT 1
            """)
            matched_class = conn.execute(q, {"class_slug": class_slug}).scalar()

            if not matched_class:
                raise HTTPException(status_code=404, detail="Pharma class not found")

            drug_q = text("""
                SELECT DISTINCT ON (medicine_name, spl_strength)
                    medicine_name, spl_strength, slug, splcolor_text, splshape_text,
                    image_filename
                FROM pillfinder
                WHERE deleted_at IS NULL
                  AND published = true
                  AND (dailymed_pharma_class_epc = :cls OR pharmclass_fda_epc = :cls)
                  AND slug IS NOT NULL AND slug != ''
                ORDER BY medicine_name, spl_strength, slug
                LIMIT :limit
            """)
            drug_rows = conn.execute(drug_q, {"cls": matched_class, "limit": limit}).fetchall()

            drugs = [_row_to_drug_dict(r) for r in drug_rows]

            return {
                "class_name": matched_class,
                "slug": class_slug,
                "count": len(drugs),
                "drugs": drugs,
            }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_class_drugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/api/pill/{slug}/condition-drugs")
def get_condition_drugs(slug: str):
    """Return other pills that share condition tags with the given pill.

    Looks up the pill's rxcui, fetches its condition tags from
    drug_condition_tags, then finds up to 8 other pills (deduped by
    medicine_name) that share at least one tag.  Each returned drug
    includes which tags it shares.

    Returns 404 if the slug is not found.
    If drug_condition_tags does not exist yet, or no tags are found,
    returns {"tags": [], "drugs": []}.
    """
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    _EMPTY = {"tags": [], "drugs": []}

    try:
        with database.db_engine.connect() as conn:
            # 1. Resolve rxcui and medicine_name for the given slug
            row = conn.execute(
                text("SELECT rxcui, medicine_name FROM pillfinder WHERE deleted_at IS NULL AND published = true AND slug = :slug LIMIT 1"),
                {"slug": slug},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pill not found")

            rxcui_val = str(row[0]).strip() if row[0] else ""
            own_medicine_name = (row[1] or "").strip().lower()

            if not rxcui_val:
                return _EMPTY

            # 2. Get all condition tags for this rxcui
            try:
                tag_rows = conn.execute(
                    text("SELECT tag FROM drug_condition_tags WHERE rxcui = :rxcui"),
                    {"rxcui": rxcui_val},
                ).fetchall()
            except SQLAlchemyError as _e:
                err_msg = str(_e).lower()
                if "drug_condition_tags" in err_msg and (
                    "does not exist" in err_msg or "no such table" in err_msg
                ):
                    logger.debug("drug_condition_tags table not yet created: %s", _e)
                    return _EMPTY
                raise

            tags = [r[0] for r in tag_rows]
            if not tags:
                return _EMPTY

            # 3. For each tag, find up to 4 OTHER pills sharing that tag.
            # Exclude both the current rxcui AND any pill with the same medicine_name
            # (different strengths of the same drug should not appear as recommendations).
            drug_map: dict[str, dict] = {}  # keyed by lower(medicine_name)

            try:
                for tag in tags:
                    cross_rows = conn.execute(
                        text("""
                            SELECT DISTINCT ON (p.medicine_name)
                                p.medicine_name,
                                p.spl_strength,
                                p.slug,
                                p.image_filename
                            FROM drug_condition_tags dct
                            JOIN pillfinder p
                              ON p.rxcui = dct.rxcui
                             AND p.deleted_at IS NULL
                             AND p.published = true
                             AND p.slug IS NOT NULL AND p.slug != ''
                            WHERE dct.tag = :tag
                              AND dct.rxcui != :rxcui
                              AND LOWER(p.medicine_name) != :own_medicine_name
                            ORDER BY p.medicine_name, p.slug
                            LIMIT 4
                        """),
                        {"tag": tag, "rxcui": rxcui_val, "own_medicine_name": own_medicine_name},
                    ).fetchall()

                    for r in cross_rows:
                        med_name = (r[0] or "").strip()
                        key = med_name.lower()
                        if key not in drug_map:
                            image_url = None
                            if r[3]:
                                first_filename = str(r[3]).split(",")[0].strip()
                                if first_filename:
                                    from utils import IMAGE_BASE
                                    image_url = f"{IMAGE_BASE}/{first_filename}"
                            drug_map[key] = {
                                "drug_name": med_name,
                                "strength": r[1] or None,
                                "slug": r[2],
                                "image_url": image_url,
                                "shared_tags": [tag],
                            }
                        else:
                            if tag not in drug_map[key]["shared_tags"]:
                                drug_map[key]["shared_tags"].append(tag)
            except SQLAlchemyError as _e:
                err_msg = str(_e).lower()
                if "drug_condition_tags" in err_msg and (
                    "does not exist" in err_msg or "no such table" in err_msg
                ):
                    logger.debug("drug_condition_tags table not yet created: %s", _e)
                    return _EMPTY
                raise

            # 4. Cap at 8 drugs total
            drugs = list(drug_map.values())[:8]

            # 5. Only surface the tags actually represented by the returned drug cards
            represented_tags = list(
                dict.fromkeys(t for d in drugs for t in d["shared_tags"])
            )

            return {"tags": represented_tags, "drugs": drugs}

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_condition_drugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_condition_drugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
