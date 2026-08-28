"""Public reviewer profile endpoints (no auth required)."""
import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["public-reviewers"])


@router.get("/reviewers/{slug}")
def get_reviewer_profile(slug: str):
    """Return a public reviewer profile by slug. Only active reviewers are returned."""
    if not database.db_engine:
        database.connect_to_database()
    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT name, slug, credentials, role, bio, avatar_url, "
                    "specialty, linkedin_url, education, registrations, same_as, license_info "
                    "FROM reviewers WHERE slug = :slug AND is_public = true AND is_active = true LIMIT 1"
                ),
                {"slug": slug},
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Reviewer not found")
        return dict(row._mapping)
    except SQLAlchemyError as exc:
        logger.error("get_reviewer_profile error: %s", exc)
        raise HTTPException(status_code=500, detail="Database error")
