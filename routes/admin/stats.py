"""Admin dashboard stats endpoint."""
import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from routes.admin.auth import get_admin_user
from routes.admin.field_schema import compute_seo_score

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-stats"])

# Cache score bucket counts for 5 minutes (expensive to compute across all pills)
_score_cache: dict = {"data": None, "expires": 0.0}

def _compute_seo_score(pill_data: dict) -> int:
    """Wrapper delegating to the shared compute_seo_score in field_schema."""
    return compute_seo_score(pill_data)


def _get_score_buckets() -> dict:
    """Fetch all pills and compute SEO score bucket counts. Cached for 5 minutes."""
    now = time.time()
    if _score_cache["data"] is not None and now < _score_cache["expires"]:
        return _score_cache["data"]

    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                           has_image, slug, author, ndc9, ndc11, dosage_form, route,
                           spl_ingredients, spl_inactive_ing, dea_schedule_name,
                           status_rx_otc, brand_names, splsize, meta_description,
                           pharmclass_fda_epc, rxcui, rxcui_1, imprint_status,
                           image_alt_text, tags, spl_strength
                    FROM pillfinder
                    WHERE deleted_at IS NULL
                """)
            ).fetchall()

        score_80_90 = 0
        score_90_100 = 0

        for r in rows:
            # Use _mapping (SQLAlchemy 2.x) for reliable key→value extraction;
            # fall back to _fields / keys() for older versions.
            try:
                pill_data = {
                    k: (str(v) if v is not None else None)
                    for k, v in r._mapping.items()
                }
            except AttributeError:
                cols = r._fields if hasattr(r, "_fields") else list(r.keys())
                pill_data = {k: (str(v) if v is not None else None) for k, v in zip(cols, r)}

            s = _compute_seo_score(pill_data)
            if 90 <= s <= 100:
                score_90_100 += 1
            elif 80 <= s < 90:
                score_80_90 += 1

        data = {"score_80_90": score_80_90, "score_90_100": score_90_100}
        _score_cache["data"] = data
        _score_cache["expires"] = now + 300.0  # cache 5 minutes
        return data
    except (SQLAlchemyError, KeyError, TypeError, AttributeError) as e:
        logger.error(f"_get_score_buckets error: {e}", exc_info=True)
        return {"score_80_90": 0, "score_90_100": 0}


@router.get("/stats")
def get_stats(admin: dict = Depends(get_admin_user)):
    if not database.db_engine:
        database.connect_to_database()

    try:
        with database.db_engine.connect() as conn:
            total_pills = conn.execute(
                text("SELECT COUNT(*) FROM pillfinder WHERE deleted_at IS NULL")
            ).scalar() or 0

            unique_drugs = conn.execute(
                text("SELECT COUNT(DISTINCT medicine_name) FROM pillfinder WHERE deleted_at IS NULL")
            ).scalar() or 0

            missing_images = conn.execute(
                text(
                    "SELECT COUNT(*) FROM pillfinder"
                    " WHERE deleted_at IS NULL AND (has_image IS NULL OR has_image != 'TRUE')"
                )
            ).scalar() or 0

            pending_drafts = conn.execute(
                text("SELECT COUNT(*) FROM pillfinder WHERE published = false AND deleted_at IS NULL")
            ).scalar() or 0

            recent_activity = conn.execute(
                text("""
                    SELECT id, occurred_at, actor_email, action, entity_type, entity_id
                    FROM audit_log ORDER BY occurred_at DESC LIMIT 10
                """)
            ).fetchall()

        # Score buckets — cached separately (expensive)
        buckets = _get_score_buckets()

        return {
            "total_pills": int(total_pills),
            "unique_drugs": int(unique_drugs),
            "missing_images": int(missing_images),
            "pending_drafts": int(pending_drafts),
            "score_80_90": buckets["score_80_90"],
            "score_90_100": buckets["score_90_100"],
            "recent_activity": [
                {
                    "id": r[0],
                    "occurred_at": r[1].isoformat() if r[1] else None,
                    "actor_email": r[2],
                    "action": r[3],
                    "entity_type": r[4],
                    "entity_id": r[5],
                }
                for r in recent_activity
            ],
        }
    except SQLAlchemyError as e:
        logger.error(f"get_stats DB error: {e}")
        raise HTTPException(status_code=500, detail="Database error")
