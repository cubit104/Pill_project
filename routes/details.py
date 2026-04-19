import re
import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from utils import normalize_imprint, normalize_name, normalize_fields, process_image_filenames, slugify_class

logger = logging.getLogger(__name__)

router = APIRouter()

def _aggregate_image_filenames(conn, raw_medicine_name: str, raw_splimprint: str, own_image_filename: str) -> str:
    """Collect image filenames for a pill by combining the row's own image_filename
    with any others found for the same drug+imprint (normalized comparison)."""
    collected = []
    seen = set()

    def _add(value):
        if not value:
            return
        for part in re.split(r"[,;]+", str(value)):
            p = part.strip()
            if p and p not in seen:
                seen.add(p)
                collected.append(p)

    # 1) Row's own image_filename first
    _add(own_image_filename)

    # 2) Aggregate from other rows with the same drug+imprint (normalized)
    try:
        image_q = text("""
            SELECT image_filename FROM pillfinder
            WHERE LOWER(TRIM(medicine_name)) = LOWER(TRIM(:medicine_name))
              AND UPPER(REGEXP_REPLACE(COALESCE(splimprint, ''), '[;,\\s]+', ' ', 'g'))
                = UPPER(REGEXP_REPLACE(COALESCE(:splimprint, ''), '[;,\\s]+', ' ', 'g'))
              AND image_filename IS NOT NULL
              AND image_filename != ''
        """)
        img_rows = conn.execute(image_q, {
            "medicine_name": raw_medicine_name,
            "splimprint": raw_splimprint,
        })
        for r in img_rows:
            _add(r[0])
    except Exception as e:
        logger.warning(f"Image aggregation query failed: {e}")

    return ",".join(collected)


@router.get("/details")
def get_pill_details(
    imprint: Optional[str] = Query(None),
    drug_name: Optional[str] = Query(None),
    rxcui: Optional[str] = Query(None),
    ndc: Optional[str] = Query(None),
):
    """Get details about a pill, trusting the database for image filenames."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    used_ndc = False

    try:
        with database.db_engine.connect() as conn:
            if ndc:
                used_ndc = True
                clean_ndc = re.sub(r'[^0-9]', '', ndc)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE ndc11 = :ndc
                       OR ndc9  = :ndc
                       OR REPLACE(ndc11, '-', '') = :clean_ndc
                       OR REPLACE(ndc9,  '-', '') = :clean_ndc
                    LIMIT 1
                """)
                result = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})

            elif rxcui:
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE rxcui = :rxcui
                    LIMIT 1
                """)
                result = conn.execute(query, {"rxcui": rxcui})

            elif imprint and drug_name:
                norm_imp = normalize_imprint(imprint)
                norm_name_val = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+',' ','g')) = UPPER(:imprint)
                      AND LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp, "drug_name": norm_name_val})

            elif imprint:
                norm_imp = normalize_imprint(imprint)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+',' ','g')) = UPPER(:imprint)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp})

            elif drug_name:
                norm_name_val = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"drug_name": norm_name_val})

            else:
                raise HTTPException(status_code=400, detail="At least one search parameter is required")

            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No pills found matching your criteria")

            columns = result.keys()
            pill_info = dict(zip(columns, row))

            # Capture RAW values BEFORE normalization (DB stores raw lowercase)
            raw_medicine_name = pill_info.get("medicine_name", "") or ""
            raw_splimprint = pill_info.get("splimprint", "") or ""
            raw_image_filename = pill_info.get("image_filename", "") or ""

            pill_info = normalize_fields(pill_info)

            if used_ndc:
                filenames = raw_image_filename
            else:
                filenames = _aggregate_image_filenames(conn, raw_medicine_name, raw_splimprint, raw_image_filename)

        image_data = process_image_filenames(filenames)
        pill_info.update(image_data)

        logger.info(f"Details for {pill_info.get('medicine_name')}: {len(pill_info['image_urls'])} images")
        return pill_info

    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/pill/{slug}")
def get_pill_by_slug(slug: str):
    """Get pill details by URL slug for SEO pages"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            query = text("SELECT * FROM pillfinder WHERE slug = :slug LIMIT 1")
            result = conn.execute(query, {"slug": slug})
            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pill not found")

            columns = result.keys()
            pill_info = dict(zip(columns, row))

            # Capture RAW values BEFORE normalization (DB stores raw lowercase)
            raw_medicine_name = pill_info.get("medicine_name", "") or ""
            raw_splimprint = pill_info.get("splimprint", "") or ""
            raw_image_filename = pill_info.get("image_filename", "") or ""

            pill_info = normalize_fields(pill_info)

            # Aggregate images: own row first, then other rows with same drug+imprint (normalized)
            filenames = _aggregate_image_filenames(conn, raw_medicine_name, raw_splimprint, raw_image_filename)

            image_data = process_image_filenames(filenames)
            image_urls = image_data.get("image_urls", [])

            logger.info(f"Slug {slug}: medicine_name={raw_medicine_name!r}, splimprint={raw_splimprint!r}, found {len(image_urls)} images, own_filename={raw_image_filename!r}")

            mapped = {
                "drug_name": pill_info.get("medicine_name"),
                "imprint": pill_info.get("splimprint"),
                "color": pill_info.get("splcolor_text"),
                "shape": pill_info.get("splshape_text"),
                "ndc": pill_info.get("ndc11"),
                "ndc9": pill_info.get("ndc9"),
                "rxcui": str(pill_info.get("rxcui", "") or ""),
                "slug": pill_info.get("slug"),
                "strength": pill_info.get("spl_strength"),
                "manufacturer": pill_info.get("author"),
                "ingredients": pill_info.get("spl_ingredients"),
                "inactive_ingredients": pill_info.get("spl_inactive_ing"),
                "dea_schedule": pill_info.get("dea_schedule_name"),
                "pharma_class": pill_info.get("dailymed_pharma_class_epc") or pill_info.get("pharmclass_fda_epc"),
                "size": str(pill_info.get("splsize", "") or ""),
                "dosage_form": pill_info.get("dosage_form"),
                "brand_names": pill_info.get("brand_names"),
                "status_rx_otc": pill_info.get("status_rx_otc"),
                "route": pill_info.get("route"),
                "image_url": image_urls[0] if image_urls else None,
                "images": image_urls,
                "has_multiple_images": len(image_urls) > 1,
                "carousel_images": [{"id": i, "url": url} for i, url in enumerate(image_urls)],
                # Source-citation / freshness fields — present only when the DB has them
                "spl_set_id": pill_info.get("spl_set_id") or pill_info.get("setid") or pill_info.get("spl_set_id_value"),
                "updated_at": str(pill_info.get("updated_at") or pill_info.get("last_updated") or pill_info.get("ingested_at") or "") or None,
            }

        return mapped

    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_by_slug: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _row_to_drug_dict(r: Any) -> Dict[str, Any]:
    """Convert a DB row (medicine_name, spl_strength, slug, splcolor_text, splshape_text, image_filename)
    to a drug dict suitable for API responses."""
    image_url = None
    if r[5]:
        # Use the lightweight helper — just take the first filename, no extra processing
        first_filename = str(r[5]).split(',')[0].strip()
        if first_filename:
            from utils import IMAGE_BASE
            image_url = f"{IMAGE_BASE}/{first_filename}"
    return {
        "drug_name": r[0],
        "strength": r[1],
        "slug": r[2],
        "color": r[3],
        "shape": r[4],
        "image_url": image_url,
    }


@router.get("/api/related/{slug}")
def get_related_by_class(slug: str, limit: int = Query(default=10, ge=1, le=50)):
    """Return up to `limit` other medications in the same pharmacologic class.
    Excludes the input pill itself and dedupes by drug_name+strength."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            # 1) Resolve the input pill's pharma class
            row = conn.execute(text("""
                SELECT medicine_name, dailymed_pharma_class_epc, pharmclass_fda_epc
                FROM pillfinder WHERE slug = :slug LIMIT 1
            """), {"slug": slug}).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pill not found")

            own_name, cls_epc, cls_fda = row
            cls = cls_epc or cls_fda
            if not cls:
                return {"pharma_class": None, "related": []}

            # 2) Find other drugs in the same class. Dedup by medicine_name+spl_strength.
            # Exclude by slug (exact row) so same-name different-strength rows are included.
            q = text("""
                SELECT DISTINCT ON (medicine_name, spl_strength)
                    medicine_name, spl_strength, slug, splcolor_text, splshape_text,
                    image_filename
                FROM pillfinder
                WHERE (dailymed_pharma_class_epc = :cls OR pharmclass_fda_epc = :cls)
                  AND slug IS NOT NULL AND slug != ''
                  AND slug != :slug
                ORDER BY medicine_name, spl_strength, slug
                LIMIT :limit
            """)
            rows = conn.execute(q, {"cls": cls, "slug": slug, "limit": limit}).fetchall()

            related = [_row_to_drug_dict(r) for r in rows]

            return {"pharma_class": cls, "related": related}
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_related_by_class: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/api/classes")
def list_pharma_classes():
    """Return all pharma classes with counts, for sitemap + hub page discovery."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            q = text("""
                SELECT class_name, COUNT(*) AS count
                FROM (
                  SELECT DISTINCT
                    medicine_name,
                    spl_strength,
                    COALESCE(dailymed_pharma_class_epc, pharmclass_fda_epc) AS class_name
                  FROM pillfinder
                  WHERE (dailymed_pharma_class_epc IS NOT NULL OR pharmclass_fda_epc IS NOT NULL)
                    AND slug IS NOT NULL AND slug != ''
                ) sub
                WHERE class_name IS NOT NULL
                GROUP BY class_name
                HAVING COUNT(*) >= 2
                ORDER BY COUNT(*) DESC
            """)
            rows = conn.execute(q).fetchall()
            return [{"class_name": r[0], "slug": slugify_class(r[0]), "count": r[1]} for r in rows]
    except SQLAlchemyError as e:
        logger.error(f"Database error in list_pharma_classes: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/api/class/{class_slug}")
def get_class_drugs(class_slug: str, limit: int = Query(default=100, ge=1, le=500)):
    """Return drugs in a pharmacologic class by slug."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            # Resolve class name in SQL using the same slug transform (lower + non-alnum → hyphen)
            q = text("""
                SELECT DISTINCT class_name
                FROM (
                    SELECT COALESCE(dailymed_pharma_class_epc, pharmclass_fda_epc) AS class_name
                    FROM pillfinder
                    WHERE (dailymed_pharma_class_epc IS NOT NULL OR pharmclass_fda_epc IS NOT NULL)
                      AND slug IS NOT NULL AND slug != ''
                ) sub
                WHERE class_name IS NOT NULL
                  AND LOWER(
                      TRIM(BOTH '-' FROM REGEXP_REPLACE(
                          LOWER(class_name),
                          '[^a-z0-9]+',
                          '-',
                          'g'
                      ))
                  ) = :class_slug
                LIMIT 1
            """)
            matched_class = conn.execute(q, {"class_slug": class_slug}).scalar()

            if not matched_class:
                raise HTTPException(status_code=404, detail="Pharma class not found")

            drug_q = text("""
                SELECT DISTINCT ON (medicine_name, spl_strength)
                    medicine_name, spl_strength, slug, splcolor_text, splshape_text,
                    image_filename
                FROM pillfinder
                WHERE (dailymed_pharma_class_epc = :cls OR pharmclass_fda_epc = :cls)
                  AND slug IS NOT NULL AND slug != ''
                ORDER BY medicine_name, spl_strength, slug
                LIMIT :limit
            """)
            drug_rows = conn.execute(drug_q, {"cls": matched_class, "limit": limit}).fetchall()

            drugs = [_row_to_drug_dict(r) for r in drug_rows]

            return {
                "class_name": matched_class,
                "slug": class_slug,
                "count": len(drugs),
                "drugs": drugs,
            }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"Database error in get_class_drugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")