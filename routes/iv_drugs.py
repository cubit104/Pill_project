"""Public IV drug endpoints (one row per drug, table public.iv_drugs).

GET /api/iv
    Published IV drugs, optionally by first letter, for the /iv hub.

GET /api/iv/{slug}
    One IV drug: names, chosen FDA label, every strength, which label pages exist, the pill
    drugs with the same name, and the administration card.

GET /api/iv/for-pill-drug?name=<pill drug slug>
    The published IV drug with the same name as a pill drug (the box on /drug/<name>).

GET /api/iv/suggest?q=<typed text>
    Published IV drugs whose generic or brand name starts with the text, for the search dropdown.

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
from services import iv_seo

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

# A pill drug page (drug_summary row `ds`) and an IV drug (`i`) are tied by NAME, the way the A to Z index does it:
# the same generic name, the generic name plus salt words ("diltiazem hydrochloride"), or one of the IV drug's brand
# names. Not by rxcui: rxcui_to_ingredient keeps one ingredient per product, so a combination pill (Percocet) looks
# like plain acetaminophen there, and some pill rows carry a wrong rxcui altogether.
SALT_WORDS_RE = (
    "( (hydrochloride|hcl|sodium|potassium|calcium|magnesium|sulfate|phosphate|acetate|tartrate|succinate|mesylate|maleate"
    "|fumarate|citrate|bromide|hydrobromide|chloride|nitrate|besylate|tromethamine|hyclate|monohydrate|dihydrate|trihydrate"
    "|anhydrous|axetil|stearate|ethylsuccinate|lactate|gluconate|disodium))+$"
)
SAME_DRUG_NAME = """(
    lower(i.generic_name) = ds.key
    OR lower(i.generic_name) = regexp_replace(ds.key, :salt_words, '')
    OR ds.key = ANY(SELECT lower(b) FROM unnest(i.brand_names) b)
)"""


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


IV_SUGGESTIONS = 4


@router.get("/api/iv/suggest")
def suggest_iv_drugs(response: Response, q: str = Query(..., max_length=80)):
    """Published IV drugs whose generic name or a brand name starts with what was typed.

    The search box asks this next to the pill /suggestions call and lists the answers under the pills with an
    "IV" tag; a brand match says which drug it is ("Levophed (Norepinephrine)"). Declared before /api/iv/{slug}.
    """
    typed = q.strip().lower().replace("%", "").replace("_", "")
    if len(typed) < 2:
        return []
    try:
        with _engine().connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT generic_name, slug,
                           (lower(generic_name) LIKE :like) AS by_generic,
                           (SELECT b FROM unnest(brand_names) b WHERE lower(b) LIKE :like ORDER BY b LIMIT 1) AS brand
                    FROM public.iv_drugs
                    WHERE {LIVE}
                      AND (lower(generic_name) LIKE :like
                           OR EXISTS (SELECT 1 FROM unnest(brand_names) b WHERE lower(b) LIKE :like))
                    ORDER BY 3 DESC, lower(generic_name)
                    LIMIT :limit
                    """
                ),
                {"like": f"{typed}%", "limit": IV_SUGGESTIONS},
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.error("Failed to suggest IV drugs for %r: %s", q, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to suggest IV drugs") from exc

    response.headers["Cache-Control"] = "public, max-age=300"
    return [
        {"label": name if by_generic or not brand else f"{brand} ({name})", "slug": slug}
        for name, slug, by_generic, brand in rows
    ]


@router.get("/api/iv/for-pill-drug")
def iv_for_pill_drug(response: Response, name: str = Query(..., pattern=SLUG_PATTERN, max_length=200)):
    """The published IV drug with the same name as a pill drug, for the box on /drug/<name>.

    `name` is the pill drug page's slug. Declared before /api/iv/{slug} so that route does not swallow it.
    """
    try:
        with _engine().connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT DISTINCT i.generic_name, i.slug
                    FROM public.drug_summary ds
                    JOIN public.iv_drugs i ON {SAME_DRUG_NAME}
                    WHERE btrim(regexp_replace(ds.key, '[^a-z0-9]+', '-', 'g'), '-') = :name AND {LIVE_I}
                    ORDER BY i.generic_name
                    LIMIT 3
                    """
                ),
                {"name": name, "salt_words": SALT_WORDS_RE},
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.error("Failed to match IV drugs for pill drug %s: %s", name, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to match IV drugs") from exc

    response.headers["Cache-Control"] = CACHE_CONTROL
    return {"results": [{"name": r[0], "slug": r[1]} for r in rows]}


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


def _pill_drugs(conn, slug: str) -> list:
    """Pill drug names on the site that are this IV drug (generic, salt forms, brands), most pills first."""
    rows = conn.execute(
        text(
            f"""
            SELECT ds.name, ds.pill_count
            FROM public.iv_drugs i
            JOIN public.drug_summary ds ON {SAME_DRUG_NAME}
            WHERE i.slug = :slug
            ORDER BY ds.pill_count DESC, ds.name
            LIMIT 12
            """
        ),
        {"slug": slug, "salt_words": SALT_WORDS_RE},
    ).fetchall()
    return [{"name": r[0], "pill_count": int(r[1])} for r in rows]


DRUG_PAGE_COLUMNS = (
    "slug, generic_name, brand_names, drug_class, routes, dea_schedule, rxcuis, "
    "spl_set_id, label_type, label_brand, label_maker, label_presentation, label_version, label_date, "
    "strengths, product_count, maker_count, "
    "card, card_status, card_label_version, card_reviewed_at, "
    "meta_title, meta_description, updated_at"
)


def drug_page_payload(conn, m, *, any_card: bool = False) -> dict:
    """Everything the IV drug page shows, from one iv_drugs row (`m`, selected with DRUG_PAGE_COLUMNS).

    The public endpoint leaves `any_card` off: a card leaves the API only once a reviewer approved it.
    Only the staff preview in the admin turns it on, to show a draft the way it would look on the page.
    """
    card = None
    if m["card"] and (any_card or m["card_status"] == "approved"):
        # who approved it stays in the admin: card_reviewed_by is a staff email, and the page credits
        # reviewers through the public editorial-team list instead
        card = {
            "fields": m["card"].get("fields") or {},
            "reviewed_at": _iso(m["card_reviewed_at"]),
            "label_version": m["card_label_version"],
            # the label moved on since the card was approved: the page says so until it is reviewed again
            "label_updated_since": bool(
                m["card_label_version"] and m["label_version"] and m["label_version"] > m["card_label_version"]
            ),
        }
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
        "label_pages": _label_pages(conn, m["spl_set_id"]),
        "strengths": m["strengths"] or [],
        "product_count": m["product_count"],
        "maker_count": m["maker_count"],
        "card": card,
        "pill_drugs": _pill_drugs(conn, m["slug"]),
        # what the page should use: the editor's own text, otherwise the same automatic text the admin shows
        "meta_title": m["meta_title"] or iv_seo.build_meta_title(m),
        "meta_description": m["meta_description"] or iv_seo.build_meta_description(m),
        "updated_at": _iso(m["updated_at"]),
    }


@router.get("/api/iv/{slug}")
def get_iv_drug(response: Response, slug: str = Path(..., pattern=SLUG_PATTERN, max_length=200)):
    """One published IV drug."""
    try:
        with _engine().connect() as conn:
            row = conn.execute(
                text(f"SELECT {DRUG_PAGE_COLUMNS} FROM public.iv_drugs WHERE slug = :slug AND {LIVE} LIMIT 1"),
                {"slug": slug},
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="IV drug not found")
            payload = drug_page_payload(conn, row._mapping)
    except SQLAlchemyError as exc:
        logger.error("Failed to fetch IV drug %s: %s", slug, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch IV drug") from exc

    response.headers["Cache-Control"] = CACHE_CONTROL
    return payload


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
                    SELECT i.slug, i.updated_at, (i.card_status = 'approved') AS has_card,
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
            "has_card": bool(r[2]),
            "has_professional": bool(r[3]),
            "has_dosage": bool(r[4]),
            "has_adverse_reactions": bool(r[5]),
        }
        for r in rows
    ]
