import os
import logging
from xml.sax.saxutils import escape as xml_escape
from typing import List

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database

logger = logging.getLogger(__name__)

router = APIRouter()


def _fetch_all_slugs(conn) -> List[str]:
    """Query the database and return all non-null pill slugs."""
    result = conn.execute(
        text(
            """
            SELECT slug
            FROM pillfinder
            WHERE deleted_at IS NULL
              AND published = true
              AND slug IS NOT NULL
            ORDER BY slug
            """
        )
    )
    return [row[0] for row in result if row[0]]


class GuidePageSlug(BaseModel):
    slug: str
    has_medguide: bool
    has_professional: bool
    has_medication_summary: bool


def _fetch_guide_page_slugs(conn) -> List[GuidePageSlug]:
    result = conn.execute(
        text(
            """
            SELECT
                p.slug,
                (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide,
                (NULLIF(mg.professional_html, '') IS NOT NULL) AS has_professional,
                (NULLIF(mg.medication_summary_html, '') IS NOT NULL) AS has_medication_summary
            FROM pillfinder p
            LEFT JOIN LATERAL (
                SELECT medguide_html, professional_html, medication_summary_html
                FROM medication_guide m
                WHERE (
                    NULLIF(p.rxcui, '') IS NOT NULL AND m.rxcui = p.rxcui
                ) OR (
                    NULLIF(p.ndc11, '') IS NOT NULL AND (
                        m.ndc = p.ndc11
                        OR REPLACE(COALESCE(m.ndc, ''), '-', '') = REPLACE(p.ndc11, '-', '')
                    )
                ) OR (
                    NULLIF(p.ndc9, '') IS NOT NULL AND (
                        m.ndc = p.ndc9
                        OR REPLACE(COALESCE(m.ndc, ''), '-', '') = REPLACE(p.ndc9, '-', '')
                    )
                )
                ORDER BY
                    CASE WHEN NULLIF(p.rxcui, '') IS NOT NULL AND m.rxcui = p.rxcui THEN 0 ELSE 1 END,
                    CASE WHEN NULLIF(p.ndc11, '') IS NOT NULL AND (
                        m.ndc = p.ndc11
                        OR REPLACE(COALESCE(m.ndc, ''), '-', '') = REPLACE(p.ndc11, '-', '')
                    ) THEN 0 ELSE 1 END,
                    m.updated_at DESC NULLS LAST
                LIMIT 1
            ) mg ON TRUE
            WHERE p.deleted_at IS NULL
              AND p.published = true
              AND p.slug IS NOT NULL
            ORDER BY p.slug
            """
        )
    ).fetchall()
    return [
        GuidePageSlug(
            slug=row[0],
            has_medguide=bool(row[1]),
            has_professional=bool(row[2]),
            has_medication_summary=bool(row[3]),
        )
        for row in result
        if row[0]
    ]


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


@router.get("/api/slugs/guide-pages", response_model=List[GuidePageSlug])
def get_guide_page_slugs():
    """Return slug list with medication guide/professional content availability."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            rows = _fetch_guide_page_slugs(conn)
        return rows
    except SQLAlchemyError as e:
        logger.error(f"Database error in /api/slugs/guide-pages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in /api/slugs/guide-pages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/sitemap.xml")
def sitemap():
    """Generate XML sitemap with all pill URLs"""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            slugs = _fetch_all_slugs(conn)
            guide_slugs = _fetch_guide_page_slugs(conn)

        base_url = os.getenv("SITE_URL", "https://pillseek.com").rstrip("/")
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
        guide_urls = []
        for row in guide_slugs:
            if row.has_medguide:
                guide_urls.append(
                    f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/medication-guide</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
                )
            if row.has_professional:
                guide_urls.append(
                    f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/professional-information</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
                )
            if row.has_medication_summary and not row.has_medguide:
                guide_urls.append(
                    f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/medication-summary</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
                )
        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f'  <url><loc>{base_url}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n'
            f'  <url><loc>{base_url}/search</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>\n'
            + "\n".join(urls)
            + ("\n" if guide_urls else "")
            + "\n".join(guide_urls)
            + "\n</urlset>"
        )
        return Response(content=xml_content, media_type="application/xml")

    except SQLAlchemyError as e:
        logger.error(f"Database error in sitemap: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error generating sitemap: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
