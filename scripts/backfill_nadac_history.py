"""Backfill NADAC weekly history into drug_price_history.

Usage:
    python -m scripts.backfill_nadac_history
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

import database
from services.pricing_service import NADACPricingService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_nadac_history")

_MAX_WEEKS = 52
_NDC_CHUNK_SIZE = 500


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill NADAC weekly price history")
    parser.add_argument("--dry-run", action="store_true", default=False, dest="dry_run")
    parser.add_argument("--weeks", type=int, default=_MAX_WEEKS)
    parser.add_argument("--limit-ndcs", type=int, default=0, dest="limit_ndcs")
    parser.add_argument("--sleep-ms", type=int, default=200, dest="sleep_ms")
    return parser.parse_args()


def _require_db() -> None:
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[idx : idx + size] for idx in range(0, len(items), size)]


def _parse_updated_at(service: NADACPricingService, item: dict[str, Any]) -> datetime:
    raw = item.get("modified") or item.get("updated") or item.get("updated_at") or item.get("release_date")
    if isinstance(raw, str):
        parsed = service._parse_date(raw)
        if parsed:
            return datetime(parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc)
    return datetime(1970, 1, 1, tzinfo=timezone.utc)


async def _sleep_if_needed(sleep_ms: int) -> None:
    if sleep_ms > 0:
        await asyncio.sleep(sleep_ms / 1000.0)


def _insert_history_rows(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    _require_db()
    with database.db_engine.begin() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO drug_price_history (ndc, effective_date, price_per_unit, unit)
                VALUES (:ndc, :effective_date, :price_per_unit, :unit)
                ON CONFLICT (ndc, effective_date) DO NOTHING
                """
            ),
            rows,
        )
    return max(int(result.rowcount or 0), 0)


def _load_target_ndcs(limit_ndcs: int = 0) -> list[str]:
    _require_db()
    with database.db_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT DISTINCT ndc FROM drug_prices
                UNION
                SELECT DISTINCT REGEXP_REPLACE(TRIM(ndc11), '[^0-9]', '', 'g')
                FROM pillfinder
                WHERE ndc11 IS NOT NULL
                  AND TRIM(ndc11) != ''
                ORDER BY 1
                """
            )
        ).fetchall()
    ndcs = [str(row[0]).replace("-", "") for row in rows if row and row[0]]
    deduped = list(dict.fromkeys(ndcs))
    if limit_ndcs and limit_ndcs > 0:
        return deduped[:limit_ndcs]
    return deduped

async def _fetch_recent_weekly_datasets(
    service: NADACPricingService,
    *,
    weeks: int,
    sleep_ms: int,
) -> list[dict[str, Any]]:
    payload = await service._request_json(service.nadac_catalog_url, params={"limit": 2000})
    await _sleep_if_needed(sleep_ms)

    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = (
            payload.get("results")
            or payload.get("items")
            or payload.get("result")
            or payload.get("dataset")
            or []
        )
        if not isinstance(items, list):
            items = []
    else:
        items = []

    candidates: list[tuple[datetime, dict[str, Any]]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name") or "")
        title_l = title.lower()
        if "nadac" not in title_l or "national average drug acquisition cost" not in title_l:
            continue
        dataset_id = service._extract_dataset_id(item)
        if not dataset_id:
            continue
        candidates.append((_parse_updated_at(service, item), {"dataset_id": dataset_id, "item": item}))

    candidates.sort(key=lambda row: row[0], reverse=True)
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _, row in candidates:
        dataset_id = row["dataset_id"]
        if dataset_id in seen:
            continue
        seen.add(dataset_id)
        deduped.append(row)
        if len(deduped) >= weeks:
            break
    return deduped


async def preview_nadac_history_backfill(
    weeks: int = _MAX_WEEKS,
    limit_ndcs: int = 100,
    sleep_ms: int = 200,
) -> dict[str, Any]:
    requested_weeks = max(1, min(int(weeks), _MAX_WEEKS))
    ndcs = _load_target_ndcs(limit_ndcs)
    service = NADACPricingService()
    datasets = await _fetch_recent_weekly_datasets(service, weeks=requested_weeks, sleep_ms=sleep_ms)
    latest_week = None
    if datasets:
        latest_week_date = await service._fetch_latest_effective_date(datasets[0]["dataset_id"])
        await _sleep_if_needed(sleep_ms)
        latest_week = latest_week_date.isoformat() if latest_week_date else None
    return {
        "weeks": requested_weeks,
        "estimated_ndcs": len(ndcs),
        "estimated_rows_to_insert": len(ndcs) * len(datasets),
        "latest_nadac_week_available": latest_week,
    }


async def run_nadac_history_backfill(
    weeks: int = _MAX_WEEKS,
    limit_ndcs: int = 0,
    dry_run: bool = False,
    sleep_ms: int = 200,
) -> dict[str, Any]:
    requested_weeks = max(1, int(weeks))
    target_ndcs = _load_target_ndcs(limit_ndcs)
    service = NADACPricingService()
    # Always fetch all available catalog datasets; we'll take the last N weekly dates from them
    datasets = await _fetch_recent_weekly_datasets(service, weeks=_MAX_WEEKS, sleep_ms=sleep_ms)

    # Collect (effective_date, dataset_id, column_map) for every weekly date in every dataset
    all_date_dataset_pairs: list[tuple[Any, str, dict[str, Any]]] = []
    for dataset in datasets:
        dataset_id = dataset["dataset_id"]
        column_map = await service._resolve_column_map(dataset_id)
        await _sleep_if_needed(sleep_ms)
        dates = await service._fetch_all_effective_dates(dataset_id)
        await _sleep_if_needed(sleep_ms)
        for d in dates:
            all_date_dataset_pairs.append((d, dataset_id, column_map))

    # Sort newest first, dedupe by date, take up to requested_weeks
    all_date_dataset_pairs.sort(key=lambda x: x[0], reverse=True)
    seen_dates: set[str] = set()
    filtered_pairs: list[tuple[Any, str, dict[str, Any]]] = []
    for d, did, cm in all_date_dataset_pairs:
        d_str = d.isoformat()
        if d_str not in seen_dates:
            seen_dates.add(d_str)
            filtered_pairs.append((d, did, cm))
        if len(filtered_pairs) >= requested_weeks:
            break

    # Process oldest first for consistent log ordering
    filtered_pairs.reverse()
    total_weekly_dates = len(filtered_pairs)

    total_rows_inserted = 0
    total_rows_skipped = 0
    weekly_dates_processed = 0

    for date_idx, (effective_date_obj, dataset_id, column_map) in enumerate(filtered_pairs, start=1):
        effective_date = effective_date_obj.isoformat()

        parsed_rows: list[dict[str, Any]] = []
        for chunk in _chunked(target_ndcs, _NDC_CHUNK_SIZE):
            rows_by_ndc = await service._bulk_query_nadac_for_ndcs(
                dataset_id, chunk, column_map, effective_date=effective_date
            )
            await _sleep_if_needed(sleep_ms)
            for ndc, row in rows_by_ndc.items():
                parsed = service._parse_nadac_row(
                    row,
                    ndc_digits=ndc,
                    as_of_week=effective_date,
                    column_map=column_map,
                )
                if parsed and parsed["effective_date"] == effective_date:
                    parsed_rows.append(
                        {
                            "ndc": parsed["ndc"],
                            "effective_date": parsed["effective_date"],
                            "price_per_unit": parsed["price_per_unit"],
                            "unit": parsed["unit"],
                        }
                    )

        rows_found = len(parsed_rows)
        rows_inserted = 0 if dry_run else _insert_history_rows(parsed_rows)
        rows_skipped = rows_found if dry_run else max(rows_found - rows_inserted, 0)

        total_rows_inserted += rows_inserted
        total_rows_skipped += rows_skipped
        weekly_dates_processed += 1

        logger.info(
            "week %d/%d dataset_id=%s effective_date=%s rows_found=%d rows_inserted=%d",
            date_idx,
            total_weekly_dates,
            dataset_id,
            effective_date,
            rows_found,
            rows_inserted,
        )

    return {
        "weekly_dates_processed": weekly_dates_processed,
        "ndcs_queried": len(target_ndcs),
        "rows_inserted": total_rows_inserted,
        "rows_skipped": total_rows_skipped,
        "dry_run": dry_run,
    }


def main() -> None:
    args = _parse_args()
    summary = asyncio.run(
        run_nadac_history_backfill(
            weeks=args.weeks,
            limit_ndcs=args.limit_ndcs,
            dry_run=args.dry_run,
            sleep_ms=args.sleep_ms,
        )
    )
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
