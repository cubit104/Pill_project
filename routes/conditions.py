"""Condition SEO landing page endpoint.

GET /api/condition/{slug}
  - Resolves aliases (returns redirect info)
  - Returns condition description + drug list + related conditions
  - 404 with available slugs if condition not found
  - Logs unknown slugs to unknown_condition_requests (fire-and-forget)
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from data.condition_descriptions import CONDITION_DESCRIPTIONS
from data.condition_metadata import CONDITION_ALIASES, RELATED_CONDITIONS
from services.condition_slugs import tag_from_slug

logger = logging.getLogger(__name__)

router = APIRouter()

# Pre-build sorted list of all valid slugs once.
_ALL_VALID_SLUGS: list[str] = sorted(
    entry["slug"] for entry in CONDITION_DESCRIPTIONS.values()
)


def _log_unknown_slug(slug: str, request: Request) -> None:
    """Fire-and-forget insert/upsert into unknown_condition_requests.
    Failures must not propagate to the caller."""
    try:
        if not database.db_engine:
            return
        ua = request.headers.get("user-agent", "")[:512]
        referrer = request.headers.get("referer", "")[:512]
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
def get_condition(slug: str, request: Request):
    """Return condition description and associated drugs for a given slug."""
    slug = slug.lower().strip()

    # Resolve aliases — return canonical redirect info.
    if slug in CONDITION_ALIASES:
        canonical = CONDITION_ALIASES[slug]
        return JSONResponse(
            status_code=200,
            content={
                "redirect": True,
                "canonical_slug": canonical,
                "url": f"/condition/{canonical}",
            },
            headers={"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"},
        )

    # Look up the canonical tag.
    tag = tag_from_slug(slug)
    if tag is None or tag not in CONDITION_DESCRIPTIONS:
        _log_unknown_slug(slug, request)
        raise HTTPException(
            status_code=404,
            detail={
                "error": "condition_not_found",
                "available": _ALL_VALID_SLUGS,
            },
        )

    description = CONDITION_DESCRIPTIONS[tag]

    # Fetch drugs for this condition tag.
    drugs: list[dict] = []
    if database.db_engine:
        try:
            with database.db_engine.connect() as conn:
                rows = conn.execute(
                    text("""
                        SELECT
                            p.medicine_name,
                            p.spl_strength,
                            p.slug,
                            p.image_filename,
                            p.generic_name,
                            p.brand_name
                        FROM drug_condition_tags dct
                        JOIN pillfinder p ON p.rxcui = dct.rxcui
                        WHERE dct.tag = :tag
                          AND p.deleted_at IS NULL
                          AND p.slug IS NOT NULL AND p.slug != ''
                        ORDER BY p.medicine_name ASC
                    """),
                    {"tag": tag},
                ).fetchall()

                for row in rows:
                    drugs.append({
                        "medicine_name": row[0],
                        "spl_strength": row[1],
                        "slug": row[2],
                        "image_filename": row[3],
                        "generic_name": row[4],
                        "brand_name": row[5],
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
