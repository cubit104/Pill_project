"""CLI script: backfill missing clinical metadata fields from openFDA / DailyMed.

Usage
-----
    python scripts/backfill_clinical_metadata.py --dry-run --limit 10
    python scripts/backfill_clinical_metadata.py --limit 100 --sleep-ms 300
    python scripts/backfill_clinical_metadata.py --only-fields dosage_form,route --limit 500

Flags
-----
--dry-run               Log what would change; write nothing to the database.
--limit N               Process at most N rows (default: 10).
--offset N              Skip first N candidate rows — useful for resuming (default: 0).
--sleep-ms N            Milliseconds to sleep between API calls (default: 250).
--only-fields FIELDS    Comma-separated list of field names to populate.
                        Allowed values: dosage_form, route, rx_otc_status,
                        dea_schedule, fda_pharma_class, brand_names,
                        active_ingredients, inactive_ingredients.
                        Default: all fields.
--match rxcui|ndc|auto  Strategy for locating the drug in openFDA.
                        auto: try RxCUI first, fall back to NDC (default).
"""

import argparse
import json
import logging
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_clinical_metadata")

KNOWN_FIELDS = [
    "dosage_form",
    "route",
    "rx_otc_status",
    "dea_schedule",
    "fda_pharma_class",
    "brand_names",
    "active_ingredients",
    "inactive_ingredients",
]


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill missing clinical metadata fields from openFDA / DailyMed."
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
        help="Milliseconds to sleep between API calls (default: 250).",
    )
    parser.add_argument(
        "--only-fields",
        type=str,
        default=None,
        dest="only_fields",
        metavar="FIELD1,FIELD2,...",
        help=(
            "Comma-separated list of fields to populate. "
            f"Allowed: {', '.join(KNOWN_FIELDS)}. Default: all fields."
        ),
    )
    parser.add_argument(
        "--match",
        choices=["rxcui", "ndc", "auto"],
        default="auto",
        dest="match_mode",
        help="Match strategy: rxcui, ndc, or auto (default: auto).",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)

    only_fields = None
    if args.only_fields:
        only_fields = [f.strip() for f in args.only_fields.split(",") if f.strip()]
        invalid = [f for f in only_fields if f not in KNOWN_FIELDS]
        if invalid:
            logger.error(
                "Unknown field(s) in --only-fields: %s. Allowed: %s",
                ", ".join(invalid),
                ", ".join(KNOWN_FIELDS),
            )
            sys.exit(1)

    logger.info(
        "Starting clinical metadata backfill: dry_run=%s limit=%d offset=%d "
        "match=%s sleep_ms=%d only_fields=%s",
        args.dry_run,
        args.limit,
        args.offset,
        args.match_mode,
        args.sleep_ms,
        only_fields,
    )

    from services.clinical_metadata_backfill import run_backfill

    summary = run_backfill(
        limit=args.limit,
        offset=args.offset,
        dry_run=args.dry_run,
        match_mode=args.match_mode,
        sleep_ms=args.sleep_ms,
        only_fields=only_fields,
    )

    # Print per-row diff in dry-run mode
    if args.dry_run:
        for row in summary.get("rows", []):
            print(json.dumps(row))

    # Always print summary
    counts = {
        "processed": summary["processed"],
        "updated": summary["updated"],
        "skipped_no_match": summary["skipped_no_match"],
        "skipped_already_populated": summary["skipped_already_populated"],
        "errors": summary["errors"],
        "dry_run": summary["dry_run"],
    }
    print(json.dumps(counts))
    logger.info("Done: %s", counts)


if __name__ == "__main__":
    main(sys.argv[1:])
