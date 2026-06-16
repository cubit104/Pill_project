"""Drug pronunciation lookup helpers."""

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)


def get_pronunciation(conn, drug_name: str) -> Optional[str]:
    """Return pronunciation text for a drug name, or None if unavailable."""
    lookup_name = (drug_name or "").strip().lower()
    if not lookup_name:
        return None

    try:
        row = conn.execute(
            text(
                """
                SELECT pronunciation_text
                FROM drug_pronunciations
                WHERE drug_name_lower = :drug_name_lower
                  AND pronunciation_text IS NOT NULL
                LIMIT 1
                """
            ),
            {"drug_name_lower": lookup_name},
        ).fetchone()
    except SQLAlchemyError as exc:
        err_msg = str(exc).lower()
        if "drug_pronunciations" in err_msg and ("does not exist" in err_msg or "no such table" in err_msg):
            logger.debug("drug_pronunciations table not yet created: %s", exc)
        else:
            logger.warning("drug_pronunciations lookup failed for %r: %s", drug_name, exc)
        return None

    if not row:
        return None

    pronunciation = row[0]
    if not pronunciation:
        return None
    return str(pronunciation).strip() or None
