"""Public editorial-team API endpoints.

GET /api/editorial-team
    Returns all active public reviewers ordered by role priority then name.

GET /api/editorial-team/{slug}
    Returns a single active public reviewer by slug, or 404.
"""

import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# Role priority for ordering (lower number = higher priority in results)
_ROLE_ORDER = {
    "medical_reviewer": 1,
    "editor": 2,
    "author": 3,
    "fact_checker": 4,
}

_PUBLIC_FIELDS = [
    "id",
    "slug",
    "name",
    "credentials",
    "role",
    "specialty",
    "bio",
    "avatar_url",
    "linkedin_url",
    "education",
    "same_as",
    "license_info",
    "is_active",
    "created_at",
    "updated_at",
]

_SELECT = ", ".join(_PUBLIC_FIELDS)


def _row_to_dict(row) -> dict:
    return dict(zip(_PUBLIC_FIELDS, row))


@router.get("/editorial-team")
def get_editorial_team():
    """Return all active, public reviewers ordered by role priority then name."""
    if not database.db_engine:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT {_SELECT}
                    FROM public.reviewers
                    WHERE is_public = TRUE AND is_active = TRUE
                    """
                )
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.error("Failed to fetch editorial team: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch editorial team") from exc

    reviewers = [_row_to_dict(row) for row in rows]

    # Sort by role priority in Python so missing roles sort last
    reviewers.sort(key=lambda r: (_ROLE_ORDER.get(r.get("role", ""), 99), r.get("name", "")))

    return reviewers


@router.get("/editorial-team/{slug}")
def get_editorial_team_member(slug: str):
    """Return a single active, public reviewer by slug."""
    if not database.db_engine:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        with database.db_engine.connect() as conn:
            row = conn.execute(
                text(
                    f"""
                    SELECT {_SELECT}
                    FROM public.reviewers
                    WHERE slug = :slug AND is_public = TRUE AND is_active = TRUE
                    LIMIT 1
                    """
                ),
                {"slug": slug},
            ).fetchone()
    except SQLAlchemyError as exc:
        logger.error("Failed to fetch reviewer %s: %s", slug, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch reviewer") from exc

    if row is None:
        raise HTTPException(status_code=404, detail="Reviewer not found")

    return _row_to_dict(row)
