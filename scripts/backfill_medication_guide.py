"""CLI entrypoint for medication guide backfill."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from services.medication_guide_backfill import run_backfill

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill medication guide rows for published pills.")
    parser.add_argument("--limit", type=int, default=None, metavar="N", help="Process only N published pills.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Log what would be fetched without calling openFDA/upserting.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Ignore cache freshness and force refresh all selected rows.",
    )
    parser.add_argument(
        "--report-dir",
        default="./backfill_reports",
        help="Directory for CSV reports (default: ./backfill_reports).",
    )
    parser.add_argument(
        "--rate-limit-seconds",
        type=float,
        default=0.25,
        help="Delay between openFDA calls when OPENFDA_API_KEY is not set (default: 0.25).",
    )
    return parser.parse_args(argv)


def _pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return (numerator / denominator) * 100.0


def _print_summary(summary, report_dir: Path) -> None:
    total = summary.total_pills
    print("========================================")
    print("Medication Guide Backfill Summary")
    print("========================================")
    print(f"Total pills:         {summary.total_pills}")
    print(f"Processed:           {summary.processed}")
    print(f"Complete:            {summary.complete:>4}  ({_pct(summary.complete, total):.1f}%)")
    print(f"Partial:             {summary.partial:>4}  ({_pct(summary.partial, total):.1f}%)")
    print(f"Not found in FDA:    {summary.not_found:>4}  ({_pct(summary.not_found, total):.1f}%)")
    print(f"Skipped (no IDs):    {summary.skipped:>4}  ({_pct(summary.skipped, total):.1f}%)")
    print(f"Errors:              {summary.errors:>4}  ({_pct(summary.errors, total):.1f}%)")
    print(f"Duration:           {summary.duration_seconds:.1f}s")
    print(f"Reports written to: {report_dir}/")
    for key in ("complete", "partial", "not_found", "errors"):
        path = summary.report_paths.get(key)
        if path:
            print(f"  - {Path(path).name}")
    print("========================================")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    report_dir = Path(args.report_dir)

    summary = asyncio.run(
        run_backfill(
            limit=args.limit,
            dry_run=args.dry_run,
            force_refresh=args.force,
            rate_limit_seconds=args.rate_limit_seconds,
            report_dir=report_dir,
        )
    )
    _print_summary(summary, report_dir)
    return 1 if summary.errors > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
