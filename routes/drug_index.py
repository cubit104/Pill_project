"""All-drugs A to Z index: pills and IV drugs in one list.

GET /api/drug-index?prefix=a        every drug name starting with "a"
GET /api/drug-index?prefix=ab       ... starting with "ab"
GET /api/drug-index?prefix=0-9      names that do not start with a letter

Each entry says where the name leads: pills (the /drug/<name> page), the IV page, or both.
Pill names come from the drug_summary view (brand and generic names are separate entries there);
IV names are each drug's generic name plus every brand name. Only published rows are listed.
"""

import logging

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from routes.drug_search import ensure_fresh
from routes.iv_drugs import CACHE_CONTROL, LIVE, _engine, letter_filter

logger = logging.getLogger(__name__)

router = APIRouter()

_IV_NAMES = f"""
    SELECT lower(n) AS key, n AS name, slug
    FROM (
        SELECT generic_name AS n, slug FROM public.iv_drugs WHERE {LIVE}
        UNION ALL
        SELECT unnest(brand_names), slug FROM public.iv_drugs WHERE {LIVE}
    ) names
"""


@router.get("/api/drug-index")
def drug_index(
    response: Response,
    prefix: str = Query(..., pattern=r"^([a-z]{1,2}|0-9)$", description="one or two letters, or 0-9"),
):
    """Drug names under one letter, plus how many names each letter (and second letter) holds."""
    letter = prefix if prefix == "0-9" else prefix[0]
    params = {"prefix": f"{prefix}%", "letter": f"{letter}%"}
    try:
        with _engine().begin() as conn:
            ensure_fresh(conn)
            rows = conn.execute(
                text(
                    f"""
                    WITH pills AS (
                        SELECT key, name, pill_count FROM public.drug_summary WHERE {letter_filter('key', prefix)}
                    ), iv AS (
                        SELECT DISTINCT ON (key) key, name, slug FROM ({_IV_NAMES}) x
                        WHERE {letter_filter('key', prefix)} ORDER BY key, slug
                    )
                    SELECT COALESCE(p.key, i.key), COALESCE(p.name, i.name), p.pill_count, i.slug
                    FROM pills p FULL OUTER JOIN iv i ON i.key = p.key
                    ORDER BY 1
                    """
                ),
                params,
            ).fetchall()
            counts = conn.execute(
                text(
                    f"""
                    WITH names AS (
                        SELECT key FROM public.drug_summary
                        UNION
                        SELECT key FROM ({_IV_NAMES}) x
                    )
                    SELECT CASE WHEN key ~ '^[a-z]' THEN left(key, 1) ELSE '0-9' END AS letter,
                           CASE WHEN key LIKE :letter AND key ~ '^[a-z][a-z]' THEN left(key, 2) END AS pair,
                           COUNT(*)
                    FROM names
                    GROUP BY 1, 2
                    """
                ),
                params,
            ).fetchall()
    except SQLAlchemyError as exc:
        logger.error("Failed to build drug index for %s: %s", prefix, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to build drug index") from exc

    letters: dict = {}
    pairs: dict = {}
    for first, pair, count in counts:
        letters[first] = letters.get(first, 0) + int(count)
        if pair:
            pairs[pair] = int(count)

    response.headers["Cache-Control"] = CACHE_CONTROL
    return {
        "prefix": prefix,
        "entries": [
            {"name": name, "pill_count": int(pill_count or 0), "iv_slug": iv_slug}
            for _key, name, pill_count, iv_slug in rows
        ],
        "letters": dict(sorted(letters.items())),
        "pairs": dict(sorted(pairs.items())),  # second-letter counts inside the requested letter
    }
