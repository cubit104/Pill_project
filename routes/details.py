import re
import logging
from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from utils import normalize_imprint, normalize_name, normalize_fields, process_image_filenames

logger = logging.getLogger(__name__)

router = APIRouter()


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
            pill_info = normalize_fields(pill_info)

            if used_ndc:
                filenames = pill_info.get("image_filename", "")
            else:
                image_q = text("""
                    SELECT image_filename FROM pillfinder
                    WHERE medicine_name = :medicine_name
                      AND splimprint    = :splimprint
                """)
                img_rows = conn.execute(image_q, {
                    "medicine_name": pill_info.get("medicine_name", ""),
                    "splimprint": pill_info.get("splimprint", ""),
                })
                filenames = ",".join(r[0] for r in img_rows if r[0])

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
            pill_info = normalize_fields(pill_info)

            # Aggregate images from all matching rows (same drug + imprint)
            image_q = text("""
                SELECT image_filename FROM pillfinder
                WHERE medicine_name = :medicine_name
                  AND splimprint = :splimprint
            """)
            img_rows = conn.execute(image_q, {
                "medicine_name": pill_info.get("medicine_name", ""),
                "splimprint": pill_info.get("splimprint", ""),
            })
            filenames = ",".join(r[0] for r in img_rows if r[0])

            # Process all aggregated images
            image_data = process_image_filenames(filenames)
            image_urls = image_data.get("image_urls", [])

            mapped = {
                "drug_name": pill_info.get("medicine_name"),
                "imprint": pill_info.get("splimprint"),
                "color": pill_info.get("splcolor_text"),
                "shape": pill_info.get("splshape_text"),
                "ndc": pill_info.get("ndc11"),
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
