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

    Matching heuristic (in priority order):
    1. Same splshape_text AND splcolor_text AND LOWER(splimprint) = LOWER(:imprint)
       but with a different medicine_name  (exact imprint, different drug — highest risk).
    2. Same splshape_text AND splcolor_text AND LOWER(splimprint) = LOWER(:imprint)
       regardless of drug name (catches same drug, different manufacturer / NDC).

    Both groups are merged, deduplicated by (medicine_name, spl_strength), and capped
    at 5 results. The current slug is always excluded.
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
                    WHERE slug = :slug
                    LIMIT 1
                """),
                {"slug": slug},
            ).fetchone()

            if source_row is None:
                raise HTTPException(status_code=404, detail="Pill not found")

            own_name, own_imprint, own_color, own_shape = source_row

            # If we don't have both color and shape, we can't reliably find visually similar pills.
            if not own_color or not own_shape:
                return {"similar": []}

            # 2) Find similar pills: same color + shape + matching imprint.
            # Priority: different drug name first (confusion risk), then same drug/different NDC.
            # We use LOWER() normalisation for case-insensitive imprint matching.
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
                    WHERE slug IS NOT NULL AND slug != ''
                      AND slug != :slug
                      AND LOWER(TRIM(COALESCE(splcolor_text, ''))) = LOWER(TRIM(:color))
                      AND LOWER(TRIM(COALESCE(splshape_text, ''))) = LOWER(TRIM(:shape))
                      AND LOWER(TRIM(COALESCE(splimprint, ''))) = LOWER(TRIM(:imprint))
                    ORDER BY
                        medicine_name,
                        spl_strength,
                        slug,
                        -- Prefer different drug names (higher confusion risk) first
                        CASE WHEN LOWER(TRIM(COALESCE(medicine_name, ''))) != LOWER(TRIM(:own_name)) THEN 0 ELSE 1 END
                    LIMIT 5
                """),
                {
                    "slug": slug,
                    "color": own_color or "",
                    "shape": own_shape or "",
                    "imprint": own_imprint or "",
                    "own_name": own_name or "",
                },
            ).fetchall()

            results = []
            for r in rows:
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
