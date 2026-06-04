"""CLI runner for pre-resolved pill price snapshots."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from typing import Any

from sqlalchemy import text

import database
from services.snapshot_resolver import resolve_pill_to_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("refresh_pill_price_snapshots")


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Refresh pre-resolved pill price snapshots.")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Resolve rows without writing to the database.")
    parser.add_argument("--limit", type=int, default=100, metavar="N", help="Maximum number of pills to process (default: 100).")
    parser.add_argument("--all", action="store_true", default=False, help="Process all matching pills (ignores --limit).")
    parser.add_argument("--offset", type=int, default=0, metavar="N", help="Skip first N pills (default: 0).")
    parser.add_argument("--slug", type=str, default=None, help="Resolve a single pill by slug.")
    parser.add_argument("--only-missing", action="store_true", default=False, help="Only resolve pills that do not yet have a snapshot row.")
    parser.add_argument("--force", action="store_true", default=False, help="Re-resolve all selected pills, even when a snapshot already exists.")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=20,
        metavar="N",
        help="Number of pills to process concurrently (default: 20).",
    )
    return parser.parse_args(argv)


def _ensure_db() -> None:
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")


def _select_pills(*, slug: str | None, limit: int | None, offset: int, only_missing: bool, force: bool) -> list[dict[str, Any]]:
    _ensure_db()

    where_clauses = [
        "p.deleted_at IS NULL",
        "p.published = true",
        "COALESCE(TRIM(p.slug), '') <> ''",
    ]
    params: dict[str, Any] = {"offset": max(0, int(offset))}
    limit_clause = ""
    if limit is not None:
        params["limit"] = max(1, int(limit))
        limit_clause = "\n        LIMIT :limit"

    if slug:
        where_clauses.append("p.slug = :slug")
        params["slug"] = slug
    elif only_missing:
        where_clauses.append("s.slug IS NULL")
    elif not force:
        where_clauses.append("(s.slug IS NULL OR s.schema_offers_valid = false OR s.match_type = 'none')")

    query = text(
        f"""
        SELECT
          p.id,
          p.slug,
          p.medicine_name,
          p.ndc11,
          p.ndc9,
          p.rxcui,
          p.spl_strength
        FROM pillfinder p
        LEFT JOIN public.pill_price_snapshot s
          ON s.slug = p.slug
        WHERE {' AND '.join(where_clauses)}
        ORDER BY p.slug
        {limit_clause}
        OFFSET :offset
        """
    )
    with database.db_engine.connect() as conn:
        rows = conn.execute(query, params).mappings().all()
    return [dict(row) for row in rows]


def _snapshot_log_row(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": snapshot.get("slug"),
        "match_type": snapshot.get("match_type"),
        "resolved_via": snapshot.get("resolved_via"),
        "price_per_unit": snapshot.get("price_per_unit"),
    }


def _upsert_snapshot(snapshot: dict[str, Any]) -> None:
    _ensure_db()
    payload = dict(snapshot)
    payload["history_52w"] = json.dumps(payload.get("history_52w") or [])
    payload["alternatives"] = json.dumps(payload.get("alternatives") or [])
    payload.pop("schema_offers_valid", None)

    with database.db_engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO public.pill_price_snapshot (
                  slug,
                  pill_id,
                  resolved_ndc11,
                  match_type,
                  resolved_via,
                  price_per_unit,
                  unit,
                  effective_date,
                  total_acquisition_cost,
                  fair_retail_low,
                  fair_retail_high,
                  history_52w,
                  history_source_ndc,
                  alternatives,
                  is_estimate,
                  estimate_basis,
                  display_disclaimer,
                  resolved_at,
                  resolver_version,
                  resolver_notes,
                  created_at,
                  updated_at
                ) VALUES (
                  :slug,
                  :pill_id,
                  :resolved_ndc11,
                  :match_type,
                  :resolved_via,
                  :price_per_unit,
                  :unit,
                  :effective_date,
                  :total_acquisition_cost,
                  :fair_retail_low,
                  :fair_retail_high,
                  CAST(:history_52w AS jsonb),
                  :history_source_ndc,
                  CAST(:alternatives AS jsonb),
                  :is_estimate,
                  :estimate_basis,
                  :display_disclaimer,
                  :resolved_at,
                  :resolver_version,
                  :resolver_notes,
                  :created_at,
                  :updated_at
                )
                ON CONFLICT (slug) DO UPDATE SET
                  pill_id = EXCLUDED.pill_id,
                  resolved_ndc11 = EXCLUDED.resolved_ndc11,
                  match_type = EXCLUDED.match_type,
                  resolved_via = EXCLUDED.resolved_via,
                  price_per_unit = EXCLUDED.price_per_unit,
                  unit = EXCLUDED.unit,
                  effective_date = EXCLUDED.effective_date,
                  total_acquisition_cost = EXCLUDED.total_acquisition_cost,
                  fair_retail_low = EXCLUDED.fair_retail_low,
                  fair_retail_high = EXCLUDED.fair_retail_high,
                  history_52w = EXCLUDED.history_52w,
                  history_source_ndc = EXCLUDED.history_source_ndc,
                  alternatives = EXCLUDED.alternatives,
                  is_estimate = EXCLUDED.is_estimate,
                  estimate_basis = EXCLUDED.estimate_basis,
                  display_disclaimer = EXCLUDED.display_disclaimer,
                  resolved_at = EXCLUDED.resolved_at,
                  resolver_version = EXCLUDED.resolver_version,
                  resolver_notes = EXCLUDED.resolver_notes,
                  updated_at = EXCLUDED.updated_at
                """
            ),
            payload,
        )


async def _run(args) -> dict[str, Any]:
    rows = _select_pills(
        slug=args.slug,
        limit=args.limit,
        offset=args.offset,
        only_missing=args.only_missing,
        force=args.force,
    )
    summary = {"processed": 0, "updated": 0, "errors": 0, "dry_run": args.dry_run}
    concurrency = max(1, int(getattr(args, "concurrency", 20)))

    async def process_one(pill: dict[str, Any]) -> str:
        try:
            snapshot = await resolve_pill_to_snapshot(pill)
            print(json.dumps(_snapshot_log_row(snapshot)))
            if args.dry_run:
                return "dry_run"
            await asyncio.to_thread(_upsert_snapshot, snapshot)
            return "updated"
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            print(
                json.dumps(
                    {
                        "slug": pill.get("slug"),
                        "match_type": "none",
                        "resolved_via": None,
                        "price_per_unit": None,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
            )
            return "error"

    results: list[str] = []
    for start in range(0, len(rows), concurrency):
        chunk = rows[start : start + concurrency]
        raw = await asyncio.gather(
            *(process_one(pill) for pill in chunk), return_exceptions=True
        )
        for item in raw:
            if isinstance(item, (KeyboardInterrupt, SystemExit)):
                raise item
            if isinstance(item, BaseException):
                logger.error(
                    "Unhandled exception in process_one",
                    exc_info=(type(item), item, item.__traceback__),
                )
                results.append("error")
            else:
                results.append(item)
    summary["processed"] = len(results)
    summary["updated"] = results.count("updated")
    summary["errors"] = results.count("error")
    return summary


def main(argv=None):
    args = _parse_args(argv)
    limit = None if args.all else args.limit
    logger.info(
        "Starting pill price snapshot refresh: dry_run=%s limit=%s offset=%d slug=%s only_missing=%s force=%s",
        args.dry_run,
        "all" if limit is None else limit,
        args.offset,
        args.slug,
        args.only_missing,
        args.force,
    )
    args.limit = limit
    summary = asyncio.run(_run(args))
    print(json.dumps(summary))
    logger.info("Done: %s", summary)


if __name__ == "__main__":
    main(sys.argv[1:])
