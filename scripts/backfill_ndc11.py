"""CLI script: backfill missing ndc11 values from DailyMed / openFDA.

Usage
-----
    python -m scripts.backfill_ndc11 --dry-run --limit 5
    python -m scripts.backfill_ndc11 --limit 50
    python -m scripts.backfill_ndc11 --limit 200 --offset 100 --sleep-ms 300

Flags
-----
--dry-run          Log what would change, write nothing to the database.
--limit N          Process at most N rows (default: 10).
--offset N         Skip first N candidate rows — useful for resuming (default: 0).
--match rxcui|name|auto
                   Strategy for locating the drug in DailyMed/openFDA.
                   auto: try RxCUI first, fall back to name (default).
--sleep-ms N       Milliseconds to sleep between API calls (default: 250).
"""

import argparse
import json
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_ndc11")


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill missing ndc11 values from DailyMed / openFDA."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Log what would change; write nothing to the database.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        metavar="N",
        help="Maximum number of rows to process (default: 10).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        metavar="N",
        help="Skip first N candidate rows (default: 0).",
    )
    parser.add_argument(
        "--match",
        choices=["rxcui", "name", "auto"],
        default="auto",
        dest="match_mode",
        help="Match strategy: rxcui, name, or auto (default: auto).",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=250,
        metavar="N",
        dest="sleep_ms",
        help="Milliseconds to sleep between API calls (default: 250).",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)

    logger.info(
        "Starting NDC backfill: dry_run=%s limit=%d offset=%d match=%s sleep_ms=%d",
        args.dry_run,
        args.limit,
        args.offset,
        args.match_mode,
        args.sleep_ms,
    )

    # Import here so the module is only loaded when actually needed
    from services.ndc_backfill import run_backfill

    summary = run_backfill(
        limit=args.limit,
        offset=args.offset,
        dry_run=args.dry_run,
        match_mode=args.match_mode,
        sleep_ms=args.sleep_ms,
    )

    # Print per-row diff in dry-run mode
    if args.dry_run:
        for row in summary.get("rows", []):
            print(json.dumps(row))

    # Always print summary
    counts = {
        "processed": summary["processed"],
        "updated": summary["updated"],
        "skipped_multi": summary["skipped_multi"],
        "skipped_none": summary["skipped_none"],
        "errors": summary["errors"],
        "dry_run": summary["dry_run"],
    }
    print(json.dumps(counts))
    logger.info("Done: %s", counts)


if __name__ == "__main__":
    main(sys.argv[1:])
