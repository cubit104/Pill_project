import re
import logging
from typing import List, Optional

from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import text

import database
from utils import (
    normalize_imprint,
    normalize_name,
    split_image_filenames,
    process_image_filenames,
    MAX_SUGGESTIONS,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/suggestions")
def get_suggestions(
    q: str = Query(..., description="Search query"),
    search_type: str = Query(..., alias="type", description="Search type (imprint, drug, or ndc)"),
) -> List[str]:
    """Get search suggestions based on query and type"""
    logger.info(f"[suggestions] q={q!r}, type={search_type!r}")

    if search_type == "name":
        search_type = "drug"

    norm_q = (q or "").strip()
    if len(norm_q) < 2:
        return []

    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(503, "Database unavailable")

    # NDC suggestions
    if search_type == "ndc":
        logger.info("→ branch: ndc")
        clean_q = re.sub(r"[^0-9]", "", norm_q)
        if database.ndc_handler:
            try:
                return database.ndc_handler.get_ndc_suggestions(clean_q, MAX_SUGGESTIONS)
            except Exception:
                logger.warning("ndc_handler failed, falling back to SQL")

        with database.db_engine.connect() as conn:
            sql = text("""
                SELECT DISTINCT ndc9 AS code
                    FROM pillfinder
                    WHERE ndc9 IS NOT NULL
                    AND REPLACE(ndc9, '-', '') LIKE :like_q
                UNION
                SELECT DISTINCT ndc11 AS code
                    FROM pillfinder
                    WHERE ndc11 IS NOT NULL
                    AND REPLACE(ndc11, '-', '') LIKE :like_q
                LIMIT :lim
            """)
            rows = conn.execute(sql, {"like_q": f"{clean_q}%", "lim": MAX_SUGGESTIONS})
            return [r[0] for r in rows if r[0]]

    # Imprint suggestions
    elif search_type == "imprint":
        logger.info("→ branch: imprint")
        norm_imp = normalize_imprint(norm_q)
        if not norm_imp:
            return []
        with database.db_engine.connect() as conn:
            sql = text("""
                SELECT DISTINCT splimprint
                    FROM pillfinder
                    WHERE splimprint IS NOT NULL
                    AND UPPER(
                        REGEXP_REPLACE(splimprint, '[;,\\s]+',' ','g')
                    ) LIKE UPPER(:like_imp)
                    ORDER BY splimprint
                    LIMIT :lim
            """)
            rows = conn.execute(sql, {"like_imp": f"{norm_imp}%", "lim": MAX_SUGGESTIONS})
            out = []
            seen = set()
            for r in rows:
                imp = r[0]
                norm2 = normalize_imprint(imp)
                if norm2 and norm2 not in seen:
                    seen.add(norm2)
                    out.append(imp)
            return out

    # Drug-name suggestions
    elif search_type == "drug":
        logger.info("→ branch: drug")
        lower_q = norm_q.lower()
        with database.db_engine.connect() as conn:
            sql = text("""
                SELECT DISTINCT medicine_name
                    FROM pillfinder
                    WHERE LOWER(medicine_name) LIKE :like_q
                    ORDER BY medicine_name
                    LIMIT :lim
            """)
            rows = conn.execute(sql, {"like_q": f"{lower_q}%", "lim": MAX_SUGGESTIONS})
            out = []
            seen = set()
            for r in rows:
                name = r[0]
                nl = normalize_name(name)
                if nl and nl not in seen:
                    seen.add(nl)
                    out.append(name)
            return out

    logger.info("→ branch: default (no suggestions)")
    return []


@router.get("/api/search")
def api_search(
    q: Optional[str] = Query(None),
    search_type: Optional[str] = Query("imprint", alias="type"),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
) -> dict:
    """Search endpoint that returns fields aligned with the frontend UI model."""
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(500, "Database connection not available")

    try:
        base_sql = """
            SELECT
                medicine_name,
                splimprint,
                splcolor_text,
                splshape_text,
                ndc11,
                rxcui,
                image_filename,
                slug,
                spl_strength
            FROM pillfinder
            WHERE 1=1
        """

        params: dict = {}
        where_conditions: List[str] = []

        if q:
            query = q.strip()
            if search_type == "imprint":
                norm = normalize_imprint(query)
                where_conditions.append(
                    "UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+', ' ', 'g')) = UPPER(:imprint)"
                )
                params["imprint"] = norm
            elif search_type == "drug":
                where_conditions.append("LOWER(medicine_name) LIKE LOWER(:drug_name)")
                params["drug_name"] = f"{query.lower()}%"
            elif search_type == "ndc":
                clean_ndc = re.sub(r'[^0-9]', '', query)
                where_conditions.append("""
                    (
                        ndc11 = :ndc OR ndc9 = :ndc OR
                        REPLACE(ndc11, '-', '') LIKE :like_ndc OR
                        REPLACE(ndc9, '-', '') LIKE :like_ndc
                    )
                """)
                params["ndc"] = query
                params["like_ndc"] = f"%{clean_ndc}%"

        if color:
            where_conditions.append("LOWER(TRIM(splcolor_text)) = LOWER(:color)")
            params["color"] = color.strip().lower()

        if shape:
            where_conditions.append("LOWER(TRIM(splshape_text)) = LOWER(:shape)")
            params["shape"] = shape.strip().lower()

        for condition in where_conditions:
            base_sql += f" AND {condition}"

        with database.db_engine.connect() as conn:
            count_sql = f"""
                SELECT COUNT(*) FROM (
                    SELECT DISTINCT medicine_name, splimprint
                    FROM pillfinder
                    WHERE 1=1
                    {"".join(f' AND {cond}' for cond in where_conditions)}
                ) AS count_query
            """
            count_result = conn.execute(text(count_sql), params)
            total = count_result.scalar() or 0

            offset = (page - 1) * per_page
            paginated_sql = f"{base_sql}\nLIMIT :limit OFFSET :offset"
            paginated_params = {**params, "limit": per_page, "offset": offset}
            result = conn.execute(text(paginated_sql), paginated_params)
            rows = result.fetchall()

        grouped: dict = {}
        for row in rows:
            medicine_name = row[0] if row[0] else ""
            splimprint = row[1] if row[1] else ""

            norm_name = normalize_name(medicine_name)
            norm_imprint = normalize_imprint(splimprint)
            key = (norm_name, norm_imprint)

            if key not in grouped:
                grouped[key] = {
                    "medicine_name": medicine_name,
                    "splimprint": splimprint,
                    "splcolor_text": row[2] if row[2] else "",
                    "splshape_text": row[3] if row[3] else "",
                    "ndc11": row[4] if row[4] else "",
                    "rxcui": row[5] if row[5] else "",
                    "image_filenames": set(),
                    "slug": row[7] if len(row) > 7 and row[7] else None,
                    "spl_strength": row[8] if len(row) > 8 and row[8] else None,
                }

            if row[6]:
                filenames = split_image_filenames(row[6])
                for fname in filenames:
                    if fname:
                        grouped[key]["image_filenames"].add(fname)

        records = []
        for data in grouped.values():
            merged_images = ",".join(data["image_filenames"])
            image_data = process_image_filenames(merged_images)
            image_urls = image_data.get("image_urls", [])
            item = {
                "drug_name": data["medicine_name"],
                "imprint": data["splimprint"],
                "color": data["splcolor_text"] or None,
                "shape": data["splshape_text"] or None,
                "ndc": data["ndc11"] or None,
                "rxcui": data["rxcui"] or None,
                "slug": data.get("slug"),
                "strength": data.get("spl_strength"),
                "image_url": image_urls[0] if image_urls else None,
            }
            records.append(item)

        return {
            "results": records,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }

    except Exception as e:
        logger.error(f"Search error: {str(e)}", exc_info=True)
        raise HTTPException(500, detail="An internal error occurred while processing the search request.")
