"""Refresh latest NADAC weekly prices into Supabase tables.

Usage:
    python scripts/refresh_nadac.py --page-size 5000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from typing import Any

from sqlalchemy import text

import database
from services.pricing_service import NADACPricingService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("refresh_nadac")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh latest NADAC weekly prices")
    parser.add_argument("--page-size", type=int, default=5000, dest="page_size")
    parser.add_argument("--max-pages", type=int, default=200, dest="max_pages")
    return parser.parse_args()


def _normalize_row(row: dict[str, Any], service: NADACPricingService, as_of_week: str | None):
    raw_ndc = row.get("ndc") or row.get("ndc11") or row.get("ndc_11") or row.get("ndc_code")
    if not raw_ndc:
        return None
    ndc_digits = service._normalize_ndc_digits(str(raw_ndc))
    if not ndc_digits:
        return None

    parsed = service._parse_nadac_row(row, ndc_digits=ndc_digits, as_of_week=as_of_week)
    return parsed


async def _run(page_size: int, max_pages: int) -> dict[str, int]:
    service = NADACPricingService()
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    total_rows = 0
    prices_upserted = 0
    history_upserted = 0

    for page in range(max_pages):
        offset = page * page_size
        as_of_week, rows = await service.fetch_latest_week_rows(limit=page_size, offset=offset)
        if not rows:
            break

        parsed_rows = []
        for row in rows:
            normalized = _normalize_row(row, service, as_of_week)
            if normalized:
                parsed_rows.append(normalized)
        if not parsed_rows:
            if len(rows) < page_size:
                break
            continue

        with database.db_engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO drug_prices (ndc, price_per_unit, unit, effective_date, source, raw_payload, fetched_at)
                    VALUES (:ndc, :price_per_unit, :unit, :effective_date, 'NADAC', CAST(:raw_payload AS JSONB), NOW())
                    ON CONFLICT (ndc) DO UPDATE
                    SET price_per_unit = EXCLUDED.price_per_unit,
                        unit = EXCLUDED.unit,
                        effective_date = EXCLUDED.effective_date,
                        source = EXCLUDED.source,
                        raw_payload = EXCLUDED.raw_payload,
                        fetched_at = NOW()
                    """
                ),
                [
                    {
                        "ndc": item["ndc"],
                        "price_per_unit": item["price_per_unit"],
                        "unit": item["unit"],
                        "effective_date": item["effective_date"],
                        "raw_payload": json.dumps(item.get("raw_payload") or {}),
                    }
                    for item in parsed_rows
                ],
            )
            conn.execute(
                text(
                    """
                    INSERT INTO drug_price_history (ndc, effective_date, price_per_unit, unit)
                    VALUES (:ndc, :effective_date, :price_per_unit, :unit)
                    ON CONFLICT (ndc, effective_date) DO UPDATE
                    SET price_per_unit = EXCLUDED.price_per_unit,
                        unit = EXCLUDED.unit
                    """
                ),
                [
                    {
                        "ndc": item["ndc"],
                        "effective_date": item["effective_date"],
                        "price_per_unit": item["price_per_unit"],
                        "unit": item["unit"],
                    }
                    for item in parsed_rows
                ],
            )

        batch_count = len(parsed_rows)
        total_rows += batch_count
        prices_upserted += batch_count
        history_upserted += batch_count

        logger.info("Processed page=%d offset=%d rows=%d", page + 1, offset, batch_count)
        if len(rows) < page_size:
            break

    summary = {
        "rows_processed": total_rows,
        "drug_prices_upserted": prices_upserted,
        "drug_price_history_upserted": history_upserted,
    }
    logger.info("NADAC refresh complete: %s", summary)
    return summary


def main() -> None:
    args = _parse_args()
    asyncio.run(_run(page_size=args.page_size, max_pages=args.max_pages))


if __name__ == "__main__":
    main()
