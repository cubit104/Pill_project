import os
import time
import logging
from xml.sax.saxutils import escape as xml_escape
from typing import List, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from utils import slugify

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory cache for hub slugs — avoids repeated full table scans on every request
_HUB_CACHE_TTL = 3600  # 1 hour
_hub_cache: Optional[Dict[str, List[str]]] = None
_hub_cache_ts: float = 0.0


def _fetch_all_slugs(conn) -> List[str]:
    """Query the database and return all non-null pill slugs."""
    result = conn.execute(
        text("SELECT slug FROM pillfinder WHERE slug IS NOT NULL ORDER BY slug")
    )
    return [row[0] for row in result if row[0]]


def _fetch_hub_values(conn) -> Dict[str, List[str]]:
    """Return distinct slugified hub values for drugs, colors, shapes, and imprints.

    Results are cached for _HUB_CACHE_TTL seconds to avoid repeated full table scans.
    The conn argument is used only when the cache is stale.
    """
    global _hub_cache, _hub_cache_ts
    now = time.time()
    if _hub_cache is not None and now - _hub_cache_ts < _HUB_CACHE_TTL:
        return _hub_cache

    hub: Dict[str, List[str]] = {"drugs": [], "colors": [], "shapes": [], "imprints": []}

    queries = {
        "drugs": "SELECT DISTINCT medicine_name FROM pillfinder WHERE medicine_name IS NOT NULL AND medicine_name <> ''",
        "colors": "SELECT DISTINCT splcolor_text FROM pillfinder WHERE splcolor_text IS NOT NULL AND splcolor_text <> ''",
        "shapes": "SELECT DISTINCT splshape_text FROM pillfinder WHERE splshape_text IS NOT NULL AND splshape_text <> ''",
        "imprints": "SELECT DISTINCT splimprint FROM pillfinder WHERE splimprint IS NOT NULL AND splimprint <> ''",
    }

    seen: Dict[str, set] = {k: set() for k in hub}
    for key, sql in queries.items():
        result = conn.execute(text(sql))
        for (value,) in result:
            s = slugify(value)
            if s and s not in seen[key]:
                seen[key].add(s)
                hub[key].append(s)

    _hub_cache = hub
    _hub_cache_ts = now
    return hub


@router.get("/api/hub-slugs", response_model=Dict[str, List[str]])
def get_hub_slugs():
    """Return distinct slugified hub values for drug/color/shape/imprint pages."""
    # Serve from cache if still fresh — avoids a DB connection on every sitemap build
    now = time.time()
    if _hub_cache is not None and now - _hub_cache_ts < _HUB_CACHE_TTL:
        return _hub_cache

    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            return _fetch_hub_values(conn)
    except SQLAlchemyError as e:
        logger.error(f"Database error in /api/hub-slugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in /api/hub-slugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/api/slugs", response_model=List[str])
def get_slugs():
    """Return a JSON array of all pill slugs (used by Next.js sitemap)"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            slugs = _fetch_all_slugs(conn)
        return slugs
    except SQLAlchemyError as e:
        logger.error(f"Database error in /api/slugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in /api/slugs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/sitemap.xml")
def sitemap():
    """Generate XML sitemap with all pill and hub URLs"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            slugs = _fetch_all_slugs(conn)
            hub = _fetch_hub_values(conn)

        base_url = os.getenv("SITE_URL", "https://pillseek.com").rstrip("/")

        pill_url_template = (
            "  <url>"
            "<loc>{base}/pill/{slug}</loc>"
            "<changefreq>monthly</changefreq>"
            "<priority>0.8</priority>"
            "</url>"
        )
        hub_url_template = (
            "  <url>"
            "<loc>{base}/{section}/{slug}</loc>"
            "<changefreq>weekly</changefreq>"
            "<priority>0.7</priority>"
            "</url>"
        )

        urls = [
            pill_url_template.format(base=base_url, slug=xml_escape(slug))
            for slug in slugs
        ]

        section_map = {
            "drug": hub["drugs"],
            "color": hub["colors"],
            "shape": hub["shapes"],
            "imprint": hub["imprints"],
        }
        for section, values in section_map.items():
            for val in values:
                urls.append(
                    hub_url_template.format(
                        base=base_url, section=section, slug=xml_escape(val)
                    )
                )

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
