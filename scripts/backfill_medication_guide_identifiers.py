"""CLI script: backfill missing medication_guide ndc/rxcui values from pillfinder.

Usage
-----
    python scripts/backfill_medication_guide_identifiers.py --dry-run --limit 10
    python scripts/backfill_medication_guide_identifiers.py --limit 200
    python scripts/backfill_medication_guide_identifiers.py --limit 200 --offset 200
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_medication_guide_identifiers")


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill missing medication_guide ndc/rxcui values from pillfinder."
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
        "--sleep-ms",
        type=int,
        default=250,
        metavar="N",
        dest="sleep_ms",
        help="Milliseconds to sleep between rows (default: 250).",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)

    logger.info(
        "Starting medication guide identifier backfill: dry_run=%s limit=%d offset=%d sleep_ms=%d",
        args.dry_run,
        args.limit,
        args.offset,
        args.sleep_ms,
    )

    from services.medication_guide_identifier_backfill import run_backfill

    summary = run_backfill(
        limit=args.limit,
        offset=args.offset,
        dry_run=args.dry_run,
        sleep_ms=args.sleep_ms,
    )

    if args.dry_run:
        for row in summary.get("rows", []):
            print(json.dumps(row))

    counts = {
        "processed": summary["processed"],
        "updated": summary["updated"],
        "already_populated": summary["already_populated"],
        "no_pillfinder_match": summary["no_pillfinder_match"],
        "errors": summary["errors"],
        "dry_run": summary["dry_run"],
    }
    print(json.dumps(counts))
    logger.info("Done: %s", counts)


if __name__ == "__main__":
    main(sys.argv[1:])
