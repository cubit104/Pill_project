import re
import logging

from fastapi import APIRouter, Query
from sqlalchemy import text

import database
from utils import get_image_urls

logger = logging.getLogger(__name__)

router = APIRouter()


def find_images_for_ndc(ndc: str, conn) -> list:
    """Find images for a given NDC code"""
    try:
        clean_ndc = re.sub(r'[^0-9]', '', ndc)
        query = text("""
            SELECT DISTINCT image_filename FROM pillfinder
            WHERE ndc11 = :ndc OR ndc9 = :ndc
            OR REPLACE(ndc11, '-', '') = :clean_ndc
            OR REPLACE(ndc9, '-', '') = :clean_ndc
        """)
        rows = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})
        all_filenames = [row[0] for row in rows if row[0]]

        if not all_filenames:
            return ["https://via.placeholder.com/400x300?text=No+Image+Available"]

        all_urls: list = []
        for filename_str in all_filenames:
            all_urls.extend(get_image_urls(filename_str))

        unique_urls = list(dict.fromkeys(all_urls))
        return unique_urls or ["https://via.placeholder.com/400x300?text=No+Image+Available"]
    except Exception as e:
        logger.error(f"Error finding images for NDC {ndc}: {e}")
        return ["https://via.placeholder.com/400x300?text=No+Image+Available"]


@router.get("/ndc_lookup")
def ndc_lookup(
    ndc: str = Query(..., description="NDC code to look up"),
):
    """Dedicated endpoint for NDC lookups"""
    if not ndc:
        return {"found": False, "error": "No NDC code provided"}

    if not database.db_engine:
        if not database.connect_to_database():
            return {"found": False, "error": "Database connection not available"}

    try:
        drug_info: dict = {}
        if database.ndc_handler:
            drug_info = database.ndc_handler.find_drug_by_ndc(ndc) or {}

        if not drug_info:
            drug_info = {}
            with database.db_engine.connect() as conn:
                clean_ndc = re.sub(r'[^0-9]', '', ndc)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE ndc11 = :ndc OR ndc9 = :ndc
                    OR REPLACE(ndc11, '-', '') = :clean_ndc
                    OR REPLACE(ndc9, '-', '') = :clean_ndc
                    LIMIT 1
                """)
                result = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})
                row = result.fetchone()

                if row:
                    columns = result.keys()
                    drug_info = dict(zip(columns, row))
                    drug_info["found"] = True
                else:
                    return {"found": False}
        else:
            drug_info["found"] = True

        with database.db_engine.connect() as conn:
            image_urls = find_images_for_ndc(ndc, conn)
            drug_info["image_urls"] = image_urls
            drug_info["has_multiple_images"] = len(image_urls) > 1
            drug_info["carousel_images"] = [
                {"id": i, "url": url} for i, url in enumerate(image_urls)
            ]

        return drug_info

    except Exception as e:
        logger.exception(f"Error in NDC lookup: {e}")
        return {"found": False, "error": str(e)}
