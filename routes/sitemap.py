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
from routes.details import _build_image_urls

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
    has_dosage: bool = False
    has_adverse_reactions: bool = False


class SlugImages(BaseModel):
    slug: str
    images: List[str]


def _fetch_guide_page_slugs(conn) -> List[GuidePageSlug]:
    result = conn.execute(
        text(
            """
            SELECT
                p.slug,
                (NULLIF(mg.medguide_html, '') IS NOT NULL) AS has_medguide,
                (NULLIF(mg.professional_html, '') IS NOT NULL) AS has_professional,
                (NULLIF(mg.medication_summary_html, '') IS NOT NULL) AS has_medication_summary,
                (
                    NULLIF(mg.dosage_administration, '') IS NOT NULL
                    OR NULLIF(mg.dosage, '') IS NOT NULL
                ) AS has_dosage,
                (
                    NULLIF(mg.adverse_reactions, '') IS NOT NULL
                    OR NULLIF(mg.side_effects, '') IS NOT NULL
                ) AS has_adverse_reactions
            FROM pillfinder p
            LEFT JOIN LATERAL (
                SELECT medguide_html, professional_html, medication_summary_html,
                       dosage_administration, dosage, adverse_reactions, side_effects
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
            has_dosage=bool(row[4]),
            has_adverse_reactions=bool(row[5]),
        )
        for row in result
        if row[0]
    ]


def _fetch_slugs_with_images(conn) -> List[SlugImages]:
    result = conn.execute(
        text(
            """
            SELECT slug, image_filename
            FROM pillfinder
            WHERE deleted_at IS NULL
              AND published = true
              AND slug IS NOT NULL
              AND image_filename IS NOT NULL
              AND image_filename != ''
            ORDER BY slug
            """
        )
    )

    entries: List[SlugImages] = []
    for row in result:
        slug = row[0]
        image_filename = row[1]
        if not slug or not image_filename:
            continue
        image_urls = _build_image_urls(str(image_filename))
        if not image_urls:
            continue
        entries.append(SlugImages(slug=slug, images=image_urls))
    return entries


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


@router.get("/api/slugs/images", response_model=List[SlugImages])
def get_slugs_with_images():
    """Return published slugs with resolved absolute image URLs."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            rows = _fetch_slugs_with_images(conn)
        return rows
    except SQLAlchemyError as e:
        logger.error(f"Database error in /api/slugs/images: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in /api/slugs/images: {e}", exc_info=True)
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
            if row.has_dosage:
                guide_urls.append(
                    f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/dosage</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
                )
            if row.has_adverse_reactions:
                guide_urls.append(
                    f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/adverse-reactions</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
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


@router.get("/sitemap-prices.xml")
def sitemap_prices():
    """Generate XML sitemap with all price page URLs."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            slugs = _fetch_all_slugs(conn)

        base_url = os.getenv("SITE_URL", "https://pillseek.com").rstrip("/")
        price_url_template = (
            "  <url>"
            "<loc>{base}/pill/{slug}/price</loc>"
            "<changefreq>weekly</changefreq>"
            "<priority>0.7</priority>"
            "</url>"
        )
        import urllib.parse

        urls = [
            price_url_template.format(
                base=base_url,
                slug=xml_escape(urllib.parse.quote(slug, safe="")),
            )
            for slug in slugs
        ]
        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(urls)
            + "\n</urlset>"
        )
        return Response(content=xml_content, media_type="application/xml")

    except SQLAlchemyError as e:
        logger.error(f"Database error in sitemap-prices: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error generating sitemap-prices: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/sitemap-dosage.xml")
def sitemap_dosage():
    """Generate XML sitemap for all pill dosage pages."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            guide_slugs = _fetch_guide_page_slugs(conn)

        base_url = os.getenv("SITE_URL", "https://pillseek.com").rstrip("/")
        urls = [
            f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/dosage</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
            for row in guide_slugs
            if row.has_dosage
        ]
        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(urls)
            + "\n</urlset>"
        )
        return Response(content=xml_content, media_type="application/xml")

    except SQLAlchemyError as e:
        logger.error(f"Database error in sitemap-dosage: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error generating sitemap-dosage: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/sitemap-adverse-reactions.xml")
def sitemap_adverse_reactions():
    """Generate XML sitemap for all pill adverse reactions pages."""
    if not database.db_engine:
        if not database.connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        with database.db_engine.connect() as conn:
            guide_slugs = _fetch_guide_page_slugs(conn)

        base_url = os.getenv("SITE_URL", "https://pillseek.com").rstrip("/")
        urls = [
            f"  <url><loc>{base_url}/pill/{xml_escape(row.slug)}/adverse-reactions</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
            for row in guide_slugs
            if row.has_adverse_reactions
        ]
        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(urls)
            + "\n</urlset>"
        )
        return Response(content=xml_content, media_type="application/xml")

    except SQLAlchemyError as e:
        logger.error(f"Database error in sitemap-adverse-reactions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error generating sitemap-adverse-reactions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
