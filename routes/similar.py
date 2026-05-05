import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from utils import IMAGE_BASE

logger = logging.getLogger(__name__)

router = APIRouter()


def _pill_image_url(image_filename: Optional[str]) -> Optional[str]:
    """Return the first image URL from a comma-separated filename string."""
    if not image_filename:
        return None
    first = str(image_filename).split(",")[0].strip()
    return f"{IMAGE_BASE}/{first}" if first else None


@router.get("/api/pill/{slug}/similar")
def get_similar_pills(slug: str):
    """Return up to 5 pills that could be visually confused with the given pill.

    The source pill's color, shape, and imprint are resolved first. If any of
    these three fields is missing, an empty list is returned (insufficient data
    for a reliable visual match).

    Candidates are fetched with a single query that matches on all three fields
    (case-insensitive), deduplicates by (medicine_name, spl_strength) using
    DISTINCT ON, and fetches up to 10 rows. Python then re-sorts so pills with
    a different drug name (highest confusion risk) appear first, and the result
    is capped at 5. The current slug is always excluded.
    """
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            # 1) Resolve the source pill's shape, color, imprint, and drug name.
            source_row = conn.execute(
                text("""
                    SELECT medicine_name, splimprint, splcolor_text, splshape_text
                    FROM pillfinder
                    WHERE deleted_at IS NULL AND published = true AND slug = :slug
                    LIMIT 1
                """),
                {"slug": slug},
            ).fetchone()

            if source_row is None:
                raise HTTPException(status_code=404, detail="Pill not found")

            own_name, own_imprint, own_color, own_shape = source_row

            # All three fields are required for a reliable visual match.
            if not own_color or not own_shape or not own_imprint:
                return {"similar": []}

            # 2) Find similar pills: same color + shape + matching imprint.
            # Fetch up to 10 candidates (deduplicated by medicine_name+strength), then
            # sort in Python to surface different drug names first (higher confusion risk).
            rows = conn.execute(
                text("""
                    SELECT DISTINCT ON (medicine_name, spl_strength)
                        slug,
                        medicine_name,
                        spl_strength,
                        splimprint,
                        splcolor_text,
                        splshape_text,
                        author,
                        image_filename
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                      AND published = true
                      AND slug IS NOT NULL AND slug != ''
                      AND slug != :slug
                      AND LOWER(TRIM(COALESCE(splcolor_text, ''))) = LOWER(TRIM(:color))
                      AND LOWER(TRIM(COALESCE(splshape_text, ''))) = LOWER(TRIM(:shape))
                      AND LOWER(TRIM(COALESCE(splimprint, ''))) = LOWER(TRIM(:imprint))
                    ORDER BY medicine_name, spl_strength, slug
                    LIMIT 10
                """),
                {
                    "slug": slug,
                    "color": own_color,
                    "shape": own_shape,
                    "imprint": own_imprint if own_imprint is not None else "",
                },
            ).fetchall()

            # Sort so different drug names (higher confusion risk) appear first.
            own_name_lower = (own_name or "").lower().strip()
            rows = sorted(
                rows,
                key=lambda r: 0 if (r[1] or "").lower().strip() != own_name_lower else 1,
            )

            results = []
            for r in rows[:5]:
                (
                    r_slug, r_name, r_strength, r_imprint,
                    r_color, r_shape, r_manufacturer, r_image_filename,
                ) = r
                results.append({
                    "slug": r_slug,
                    "drug_name": r_name,
                    "strength": r_strength,
                    "imprint": r_imprint,
                    "color": r_color,
                    "shape": r_shape,
                    "manufacturer": r_manufacturer,
                    "image_url": _pill_image_url(r_image_filename),
                })

            return {"similar": results}

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_similar_pills: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_similar_pills: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
