import os
import logging
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/sitemap.xml")
def sitemap():
    """Generate XML sitemap with all pill URLs"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            result = conn.execute(
                text("SELECT slug FROM pillfinder WHERE slug IS NOT NULL ORDER BY slug")
            )
            slugs = [row[0] for row in result if row[0]]

        base_url = os.getenv("SITE_URL", "https://idmypills.com").rstrip("/")
        pill_url_template = (
            "  <url>"
            "<loc>{base}/pill/{slug}</loc>"
            "<changefreq>monthly</changefreq>"
            "<priority>0.8</priority>"
            "</url>"
        )
        urls = [
            pill_url_template.format(base=base_url, slug=xml_escape(slug))
            for slug in slugs
        ]
        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f'  <url><loc>{base_url}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n'
            f'  <url><loc>{base_url}/search</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>\n'
            + "\n".join(urls)
            + "\n</urlset>"
        )
        return Response(content=xml_content, media_type="application/xml")

    except SQLAlchemyError as e:
        logger.error(f"Database error in sitemap: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error generating sitemap: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
