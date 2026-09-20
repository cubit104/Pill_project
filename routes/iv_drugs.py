"""Public IV drug endpoints (one row per drug, table public.iv_drugs).

GET /api/iv
    Published IV drugs, optionally by first letter, for the /iv hub.

GET /api/iv/{slug}
    One IV drug: names, chosen FDA label, every strength, which label pages exist, the pill
    drugs with the same ingredient, and the administration card.

GET /api/slugs/iv
    Slugs for the sitemap.

The label text itself is served by the existing /api/drugs/by-setid/{spl_set_id}/guide.
The administration card is returned ONLY when a reviewer approved it; a draft never leaves the admin.
"""

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Query, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()

CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"
LIVE = "deleted_at IS NULL AND published"
LIVE_I = "i.deleted_at IS NULL AND i.published"  # same rule, for queries that alias the table as i
if os.getenv("IV_DRUGS_PREVIEW", "").lower() in {"1", "true", "yes"}:
    # Local preview before launch: unpublished drugs are visible too. Never set this on Render.
    # Administration cards are unaffected: only an approved card is ever returned.
    LIVE, LIVE_I = "deleted_at IS NULL", "i.deleted_at IS NULL"
    logger.warning("IV_DRUGS_PREVIEW is on: unpublished IV drugs are visible through the API")
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
DAILYMED_LABEL_URL = "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}"


def _engine():
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=503, detail="Database unavailable")
    return database.db_engine


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def letter_filter(column: str, prefix: str) -> str:
    """SQL condition for a first-letter page; '0-9' collects every name that does not start with a letter."""
    return f"{column} !~ '^[a-z]'" if prefix == "0-9" else f"{column} LIKE :prefix"


@router.get("/api/iv")
def list_iv_drugs(
    response: Response,
    letter: Optional[str] = Query(None, pattern=r"^([a-z]|0-9)$", description="first letter, or 0-9"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=600),
):
    """Published IV drugs in name order."""
    where = LIVE + (f" AND {letter_filter('lower(generic_name)', letter)}" if letter else "")
    params = {"prefix": f"{letter}%", "limit": per_page, "offset": (page - 1) * per_page}
    try:
        with _engine().connect() as conn:
            total = conn.execute(text(f"SELECT COUNT(*) FROM public.iv_drugs WHERE {where}"), params).scalar() or 0
            rows = conn.execute(
                text(
                    f"""
                    SELECT slug, generic_name, brand_names, drug_class, (card_status = 'approved') AS has_card
                    FROM public.iv_drugs
                    WHERE {where}
                    ORDER BY lower(generic_name)
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.error("Failed to list IV drugs: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to list IV drugs") from exc

    response.headers["Cache-Control"] = CACHE_CONTROL
    return {
        "results": [
            {"slug": r[0], "name": r[1], "brand_names": r[2] or [], "drug_class": r[3] or [], "has_card": bool(r[4])}
            for r in rows
        ],
        "total": int(total),
        "page": page,
        "per_page": per_page,
    }


def _label_pages(conn, spl_set_id: str) -> dict:
    """Which label pages have content, read from the same cache the pill pages use."""
    flags = {
        "has_professional": False,
        "has_dosage": False,
        "has_adverse_reactions": False,
        "has_medguide": False,
        "has_boxed_warning": False,
    }
    row = conn.execute(
        text(
            """
            SELECT
                (NULLIF(mg.professional_html, '') IS NOT NULL),
                (NULLIF(mg.dosage_administration, '') IS NOT NULL OR NULLIF(mg.dosage, '') IS NOT NULL),
                (NULLIF(mg.adverse_reactions, '') IS NOT NULL OR NULLIF(mg.side_effects, '') IS NOT NULL),
                (NULLIF(mg.medguide_html, '') IS NOT NULL),
                (COALESCE(mg.has_boxed_warning, false) OR NULLIF(mg.boxed_warning_html, '') IS NOT NULL)
            FROM public.medication_guide mg
            WHERE mg.spl_set_id = :setid
            ORDER BY mg.updated_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        {"setid": spl_set_id},
    ).fetchone()
    if row:
        flags = dict(zip(flags, (bool(v) for v in row)))
    return flags


def _pill_drugs(conn, rxcuis: list) -> list:
    """Pill drug names on the site with the same ingredient (brand and generic), most pills first."""
    if not rxcuis:
        return []
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT ds.name, ds.pill_count
            FROM public.rxcui_to_ingredient r
            JOIN public.pillfinder p ON p.rxcui = r.product_rxcui AND p.deleted_at IS NULL AND p.published = true
            JOIN public.drug_summary ds ON ds.key = lower(btrim(p.medicine_name))
            WHERE r.ingredient_rxcui = ANY(:rxcuis)
            ORDER BY ds.pill_count DESC, ds.name
            LIMIT 12
            """
        ),
        {"rxcuis": rxcuis},
    ).fetchall()
    return [{"name": r[0], "pill_count": int(r[1])} for r in rows]


@router.get("/api/iv/{slug}")
def get_iv_drug(response: Response, slug: str = Path(..., pattern=SLUG_PATTERN, max_length=200)):
    """One published IV drug."""
    try:
        with _engine().connect() as conn:
            row = conn.execute(
                text(
                    f"""
                    SELECT slug, generic_name, brand_names, drug_class, routes, dea_schedule, rxcuis,
                           spl_set_id, label_type, label_brand, label_maker, label_presentation, label_version, label_date,
                           strengths, product_count, maker_count,
                           card, card_status, card_label_version, card_reviewed_by, card_reviewed_at,
                           meta_title, meta_description, updated_at
                    FROM public.iv_drugs
                    WHERE slug = :slug AND {LIVE}
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="IV drug not found")
            m = row._mapping
            label_pages = _label_pages(conn, m["spl_set_id"])
            pill_drugs = _pill_drugs(conn, list(m["rxcuis"] or []))
    except SQLAlchemyError as exc:
        logger.error("Failed to fetch IV drug %s: %s", slug, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch IV drug") from exc

    card = None
    if m["card_status"] == "approved" and m["card"]:
        card = {
            "fields": m["card"].get("fields") or {},
            "reviewed_by": m["card_reviewed_by"],
            "reviewed_at": _iso(m["card_reviewed_at"]),
            "label_version": m["card_label_version"],
            # the label moved on since the card was approved: the page says so until it is reviewed again
            "label_updated_since": bool(
                m["card_label_version"] and m["label_version"] and m["label_version"] > m["card_label_version"]
            ),
        }

    response.headers["Cache-Control"] = CACHE_CONTROL
    return {
        "slug": m["slug"],
        "name": m["generic_name"],
        "brand_names": m["brand_names"] or [],
        "drug_class": m["drug_class"] or [],
        "routes": m["routes"] or [],
        "dea_schedule": m["dea_schedule"],
        "spl_set_id": m["spl_set_id"],
        "label": {
            "type": m["label_type"],
            "brand": m["label_brand"],
            "maker": m["label_maker"],
            "presentation": m["label_presentation"],
            "version": m["label_version"],
            "date": _iso(m["label_date"]),
            "source_url": DAILYMED_LABEL_URL.format(setid=m["spl_set_id"]),
        },
        "label_pages": label_pages,
        "strengths": m["strengths"] or [],
        "product_count": m["product_count"],
        "maker_count": m["maker_count"],
        "card": card,
        "pill_drugs": pill_drugs,
        "meta_title": m["meta_title"],
        "meta_description": m["meta_description"],
        "updated_at": _iso(m["updated_at"]),
    }


@router.get("/api/iv/{slug}/label-sections")
def get_iv_label_sections(response: Response, slug: str = Path(..., pattern=SLUG_PATTERN, max_length=200)):
    """Dosage and side-effects text of a published IV drug's label, for its Dosage and Side effects pages.

    Read from the medication_guide cache only (scripts/warm_iv_labels.py fills it); the professional
    label page goes through /api/drugs/by-setid/{spl_set_id}/guide, which fetches on demand.
    """
    try:
        with _engine().connect() as conn:
            row = conn.execute(
                text(
                    f"""
                    SELECT i.generic_name, i.spl_set_id,
                           COALESCE(NULLIF(mg.dosage_administration, ''), NULLIF(mg.dosage, '')) AS dosage_administration,
                           NULLIF(mg.dosage, '') AS dosage_forms_and_strengths,
                           COALESCE(NULLIF(mg.adverse_reactions, ''), NULLIF(mg.side_effects, '')) AS adverse_reactions,
                           mg.boxed_warning_html, mg.source_url, mg.fetched_at
                    FROM public.iv_drugs i
                    LEFT JOIN LATERAL (
                        SELECT * FROM public.medication_guide g
                        WHERE g.spl_set_id = i.spl_set_id
                        ORDER BY g.updated_at DESC NULLS LAST
                        LIMIT 1
                    ) mg ON true
                    WHERE i.slug = :slug AND {LIVE_I}
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            ).fetchone()
    except SQLAlchemyError as exc:
        logger.error("Failed to fetch IV label sections for %s: %s", slug, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch label sections") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="IV drug not found")

    m = row._mapping
    response.headers["Cache-Control"] = CACHE_CONTROL
    return {
        "name": m["generic_name"],
        "spl_set_id": m["spl_set_id"],
        "dosage_administration": m["dosage_administration"],
        "dosage_forms_and_strengths": m["dosage_forms_and_strengths"],
        "adverse_reactions": m["adverse_reactions"],
        "boxed_warning_html": m["boxed_warning_html"],
        "source_url": m["source_url"] or DAILYMED_LABEL_URL.format(setid=m["spl_set_id"]),
        "fetched_at": _iso(m["fetched_at"]),
    }


@router.get("/api/slugs/iv")
def get_iv_slugs(response: Response):
    """Published IV drug slugs for the sitemap, with which label pages exist."""
    try:
        with _engine().connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT i.slug, i.updated_at,
                           (NULLIF(mg.professional_html, '') IS NOT NULL) AS has_professional,
                           (NULLIF(mg.dosage_administration, '') IS NOT NULL OR NULLIF(mg.dosage, '') IS NOT NULL) AS has_dosage,
                           (NULLIF(mg.adverse_reactions, '') IS NOT NULL OR NULLIF(mg.side_effects, '') IS NOT NULL) AS has_adverse
                    FROM public.iv_drugs i
                    LEFT JOIN LATERAL (
                        SELECT * FROM public.medication_guide g
                        WHERE g.spl_set_id = i.spl_set_id
                        ORDER BY g.updated_at DESC NULLS LAST
                        LIMIT 1
                    ) mg ON true
                    WHERE {LIVE_I}
                    ORDER BY i.slug
                    """
                )
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.error("Failed to fetch IV slugs: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Database error") from exc

    response.headers["Cache-Control"] = "public, max-age=86400, s-maxage=86400"
    return [
        {
            "slug": r[0],
            "updated_at": _iso(r[1]),
            "has_professional": bool(r[2]),
            "has_dosage": bool(r[3]),
            "has_adverse_reactions": bool(r[4]),
        }
        for r in rows
    ]
