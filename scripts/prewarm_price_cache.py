"""Pre-warm NADAC price cache for high-traffic pill pages.

Usage:
    python scripts/prewarm_price_cache.py --api-base http://localhost:8000 --limit 200
"""

from __future__ import annotations

import argparse
import logging
from time import perf_counter

import httpx
from sqlalchemy import text

import database

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("prewarm_price_cache")

FALLBACK_SLUGS = [
    "plavix-75-1171", "xarelto", "lisinopril", "atorvastatin", "metformin",
    "amlodipine", "omeprazole", "levothyroxine", "gabapentin", "hydrochlorothiazide",
    "sertraline", "escitalopram", "simvastatin", "montelukast", "losartan",
    "albuterol", "alprazolam", "prednisone", "fluoxetine", "tramadol",
    "rosuvastatin", "furosemide", "pantoprazole", "amoxicillin", "clindamycin",
    "metoprolol", "carvedilol", "warfarin", "clopidogrel", "aspirin",
    "insulin-glargine", "insulin-lispro", "glipizide", "jardiance", "ozempic",
    "valsartan", "benazepril", "lisinopril-hydrochlorothiazide", "cyclobenzaprine", "ibuprofen",
    "naproxen", "cetirizine", "loratadine", "fluticasone", "bupropion",
    "venlafaxine", "doxycycline", "cephalexin", "tamsulosin", "finasteride",
]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pre-warm /api/prices cache for top viewed pills")
    parser.add_argument("--limit", type=int, default=200, help="Maximum number of slugs to prewarm")
    parser.add_argument("--api-base", default="http://localhost:8000", help="Backend API base URL")
    return parser.parse_args()


def _top_slugs(limit: int) -> list[str]:
    if not database.db_engine and not database.connect_to_database():
        logger.warning("Database unavailable; using fallback slug list")
        return FALLBACK_SLUGS[:limit]

    query_candidates = [
        ("SELECT slug FROM pill_views WHERE slug IS NOT NULL GROUP BY slug ORDER BY COUNT(*) DESC LIMIT :limit", "pill_views.slug"),
        (
            "SELECT pill_slug AS slug FROM pill_views WHERE pill_slug IS NOT NULL GROUP BY pill_slug ORDER BY COUNT(*) DESC LIMIT :limit",
            "pill_views.pill_slug",
        ),
    ]
    with database.db_engine.connect() as conn:
        for query, label in query_candidates:
            try:
                rows = conn.execute(text(query), {"limit": limit}).fetchall()
                slugs = [str(row[0]).strip() for row in rows if row and row[0]]
                if slugs:
                    logger.info("Loaded %d slugs from %s", len(slugs), label)
                    return slugs[:limit]
            except Exception as exc:
                logger.info("Skipping %s lookup: %s", label, exc)

    logger.info("No pill_views source available; using fallback slug list")
    return FALLBACK_SLUGS[:limit]


def _fetch_ndc_for_slug(client: httpx.Client, api_base: str, slug: str) -> str | None:
    response = client.get(f"{api_base}/api/pill/{slug}")
    if not response.is_success:
        return None
    payload = response.json()
    ndc = payload.get("ndc") or payload.get("ndc11")
    return str(ndc).strip() if ndc else None


def _prewarm(limit: int, api_base: str) -> dict[str, int]:
    slugs = _top_slugs(limit)
    warmed = 0
    skipped = 0
    failed = 0
    api_base = api_base.rstrip("/")

    with httpx.Client(timeout=30.0) as client:
        for idx, slug in enumerate(slugs, start=1):
            ndc = _fetch_ndc_for_slug(client, api_base, slug)
            if not ndc:
                skipped += 1
                logger.info("[%d/%d] skip slug=%s (missing pill or ndc)", idx, len(slugs), slug)
                continue

            started = perf_counter()
            price_resp = client.get(f"{api_base}/api/prices/{ndc}")
            duration_ms = (perf_counter() - started) * 1000
            if price_resp.is_success:
                cache_header = price_resp.headers.get("X-Price-Cache", "unknown")
                warmed += 1
                logger.info(
                    "[%d/%d] warmed slug=%s ndc=%s cache=%s %.2fms",
                    idx,
                    len(slugs),
                    slug,
                    ndc,
                    cache_header,
                    duration_ms,
                )
            else:
                failed += 1
                logger.warning(
                    "[%d/%d] failed slug=%s ndc=%s status=%s",
                    idx,
                    len(slugs),
                    slug,
                    ndc,
                    price_resp.status_code,
                )

    summary = {
        "requested": len(slugs),
        "warmed": warmed,
        "skipped": skipped,
        "failed": failed,
    }
    logger.info("Prewarm complete: %s", summary)
    return summary


def main() -> None:
    args = _parse_args()
    _prewarm(limit=max(args.limit, 1), api_base=args.api_base)


if __name__ == "__main__":
    main()
