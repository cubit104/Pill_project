"""Condition SEO landing page endpoint.

GET /api/condition/{slug}
  - Resolves aliases (returns redirect info)
  - Returns condition description + drug list + related conditions
  - 404 with available slugs if condition not found
  - Logs unknown slugs to unknown_condition_requests (background task)
"""

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from data.condition_descriptions import CONDITION_DESCRIPTIONS
from data.condition_metadata import CONDITION_ALIASES, RELATED_CONDITIONS
from services.condition_slugs import tag_from_slug
from utils import IMAGE_BASE

logger = logging.getLogger(__name__)

router = APIRouter()

# Pre-build sorted list of all valid slugs once.
_ALL_VALID_SLUGS: list[str] = sorted(
    entry["slug"] for entry in CONDITION_DESCRIPTIONS.values()
)


def _log_unknown_slug(slug: str, ua: str, referrer: str) -> None:
    """Background task: upsert into unknown_condition_requests.
    Failures must not propagate to the caller."""
    try:
        if not database.db_engine:
            return
        with database.db_engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO public.unknown_condition_requests
                        (slug, user_agent, referrer)
                    VALUES (:slug, :ua, :ref)
                    ON CONFLICT (slug) DO UPDATE
                        SET count = unknown_condition_requests.count + 1,
                            last_seen = NOW()
                """),
                {"slug": slug, "ua": ua, "ref": referrer},
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to log unknown condition slug %r: %s", slug, exc)


@router.get("/api/condition/{slug}")
def get_condition(
    slug: str,
    request: Request,
    background_tasks: BackgroundTasks,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Return condition description and associated drugs for a given slug.

    Supports pagination via ?limit=N&offset=M (default limit=20, max limit=100).
    Response includes total_count (distinct medicine names), limit, offset, has_more.
    Each drug includes a server-built image_url (or null) so clients don't need to
    construct image URLs client-side.
    """
    slug = slug.lower().strip()

    # Resolve aliases — return canonical redirect info.
    if slug in CONDITION_ALIASES:
        canonical = CONDITION_ALIASES[slug]
        # Preserve pagination state so API consumers / the frontend can forward it.
        canonical_url = f"/condition/{canonical}"
        if offset > 0 or limit != 20:
            canonical_url = f"{canonical_url}?limit={limit}&offset={offset}"
        return JSONResponse(
            status_code=200,
            content={
                "redirect": True,
                "canonical_slug": canonical,
                "url": canonical_url,
            },
            headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"},
        )

    # Look up the canonical tag.
    tag = tag_from_slug(slug)
    if tag is None or tag not in CONDITION_DESCRIPTIONS:
        ua = request.headers.get("user-agent", "")[:512]
        referrer = request.headers.get("referer", "")[:512]
        background_tasks.add_task(_log_unknown_slug, slug, ua, referrer)
        raise HTTPException(
            status_code=404,
            detail={
                "error": "condition_not_found",
                "available": _ALL_VALID_SLUGS,
            },
        )

    description = CONDITION_DESCRIPTIONS[tag]

    # Fetch drugs for this condition tag.
    # Deduplicates by medicine_name (one card per drug, regardless of strength) using
    # a window function — picks the "best" representative row per medicine_name:
    # prefer rows that have a slug, then an image, then by spl_strength ASC (lowest
    # strength first as a stable tiebreaker), then by id ASC.
    # JOIN uses TRIM/cast to handle rxcui type or whitespace mismatches.
    drugs: list[dict] = []
    total_count: int = 0
    if database.db_engine:
        try:
            with database.db_engine.connect() as conn:
                # Count distinct medicine names for pagination metadata.
                count_result = conn.execute(
                    text("""
                        SELECT COUNT(DISTINCT LOWER(TRIM(p.medicine_name)))
                        FROM drug_condition_tags dct
                        JOIN pillfinder p
                            ON TRIM(p.rxcui::text) = TRIM(dct.rxcui::text)
                        WHERE dct.tag = :tag
                          AND p.deleted_at IS NULL
                    """),
                    {"tag": tag},
                ).scalar()
                total_count = int(count_result) if isinstance(count_result, (int, float)) else 0

                rows = conn.execute(
                    text("""
                        WITH ranked AS (
                            SELECT
                                p.medicine_name,
                                p.spl_strength,
                                p.slug,
                                p.image_filename,
                                p.brand_names,
                                p.rxcui,
                                ROW_NUMBER() OVER (
                                    PARTITION BY LOWER(TRIM(p.medicine_name))
                                    ORDER BY
                                        (p.slug IS NOT NULL AND p.slug != '') DESC,
                                        (p.image_filename IS NOT NULL AND p.image_filename != '') DESC,
                                        p.spl_strength ASC NULLS LAST,
                                        p.id ASC
                                ) AS rn
                            FROM drug_condition_tags dct
                            JOIN pillfinder p
                                ON TRIM(p.rxcui::text) = TRIM(dct.rxcui::text)
                            WHERE dct.tag = :tag
                              AND p.deleted_at IS NULL
                        )
                        SELECT medicine_name, spl_strength, slug, image_filename,
                               brand_names, rxcui
                        FROM ranked
                        WHERE rn = 1
                        ORDER BY medicine_name ASC
                        LIMIT :limit OFFSET :offset
                    """),
                    {"tag": tag, "limit": limit, "offset": offset},
                ).fetchall()

                for row in rows:
                    image_filename = row[3]
                    image_url = None
                    if image_filename:
                        first = str(image_filename).split(",")[0].strip()
                        if first:
                            image_url = f"{IMAGE_BASE}/{first}"
                    drugs.append({
                        "medicine_name": row[0],
                        "spl_strength": row[1],
                        "slug": row[2],
                        "image_filename": image_filename,
                        "image_url": image_url,
                        "brand_names": row[4],
                        "rxcui": row[5],
                    })
        except SQLAlchemyError as exc:
            logger.error("DB error fetching condition drugs for %r: %s", tag, exc, exc_info=True)
            # Degrade gracefully — return empty drug list rather than 500.

    # Build related conditions list.
    related: list[dict] = []
    for related_slug in RELATED_CONDITIONS.get(slug, []):
        related_tag = tag_from_slug(related_slug)
        if related_tag and related_tag in CONDITION_DESCRIPTIONS:
            related.append({
                "slug": related_slug,
                "title": CONDITION_DESCRIPTIONS[related_tag]["title"],
            })

    return JSONResponse(
        content={
            "tag": tag,
            "slug": slug,
            "title": description["title"],
            "paragraphs": description["paragraphs"],
            "last_reviewed": description["last_reviewed"],
            "drugs": drugs,
            "drug_count": len(drugs),
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(drugs)) < total_count,
            "related": related,
        },
        headers={
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
    )


@router.get("/api/conditions")
def list_conditions():
    """Return all valid condition slugs with their titles (for sitemap + frontend)."""
    return JSONResponse(
        content={
            "conditions": [
                {"slug": entry["slug"], "title": entry["title"], "tag": entry["tag"]}
                for entry in CONDITION_DESCRIPTIONS.values()
            ]
        },
        headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"},
    )
