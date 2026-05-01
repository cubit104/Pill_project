"""CLI script: backfill drug indications from openFDA.

Usage
-----
    python scripts/backfill_drug_indications.py
    python scripts/backfill_drug_indications.py --dry-run
    python scripts/backfill_drug_indications.py --drug ibuprofen
    python scripts/backfill_drug_indications.py --limit 5
    python scripts/backfill_drug_indications.py --force

Flags
-----
--limit N          Only process the first N drugs from the seed list.
--drug NAME        Process a single named drug (ignores seed file).
--seed-file PATH   Path to seed list (default: scripts/test_drugs.txt).
--dry-run          Fetch and print results, but do not write to the DB.
--force            Re-fetch even if a row already exists (still respects
                   source='manual' skip logic).
"""

import argparse
import logging
import os
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_drug_indications")

# Allow running from repository root OR from within scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_SLEEP_BETWEEN_REQUESTS_S = 0.25
_DEFAULT_SEED_FILE = os.path.join(os.path.dirname(__file__), "test_drugs.txt")


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill drug indications from openFDA into drug_indications table."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Only process the first N drugs from the seed list.",
    )
    parser.add_argument(
        "--drug",
        type=str,
        default=None,
        metavar="NAME",
        help="Process a single named drug (ignores seed file).",
    )
    parser.add_argument(
        "--seed-file",
        type=str,
        default=_DEFAULT_SEED_FILE,
        dest="seed_file",
        metavar="PATH",
        help=f"Path to seed list (default: {_DEFAULT_SEED_FILE}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Fetch and print results without writing to the DB.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Re-fetch even if a row already exists (still respects manual override).",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Seed-list reader
# ---------------------------------------------------------------------------


def _read_seed_file(path: str) -> list:
    """Read drug names from *path* (one per line, skip blanks and # comments)."""
    drugs = []
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                name = line.strip()
                if name and not name.startswith("#"):
                    drugs.append(name.lower())
    except FileNotFoundError:
        logger.error("Seed file not found: %s", path)
        sys.exit(1)
    return drugs


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------


def main(argv=None):
    args = _parse_args(argv)

    from services.drug_indications import fetch_indications_from_openfda, upsert_indication

    # Build drug list
    if args.drug:
        drugs = [args.drug.lower()]
    else:
        drugs = _read_seed_file(args.seed_file)
        if args.limit is not None:
            drugs = drugs[: args.limit]

    if not drugs:
        print("No drugs to process.")
        sys.exit(0)

    # Connect to DB (unless dry-run)
    if not args.dry_run:
        try:
            import database

            if not database.db_engine:
                if not database.connect_to_database():
                    logger.error("Cannot connect to database. Aborting.")
                    sys.exit(1)
        except Exception as exc:
            logger.error("DB setup failed: %s", exc)
            sys.exit(1)

    # Counters
    total = 0
    inserted = 0
    updated = 0
    skipped_manual = 0
    not_found = 0
    db_errors = 0

    for drug_name in drugs:
        total += 1

        # When --force is not set, skip drugs that already have a row in the DB
        if not args.dry_run and not args.force:
            try:
                import database
                from sqlalchemy import text as _text

                with database.db_engine.connect() as chk:
                    existing = chk.execute(
                        _text("SELECT source FROM drug_indications WHERE drug_name_key = :k"),
                        {"k": drug_name},
                    ).fetchone()
                    if existing:
                        if existing[0] == "manual":
                            skipped_manual += 1
                            print(f"↷ {drug_name} — manual override, skipped")
                        else:
                            skipped_manual += 1
                            print(f"↷ {drug_name} — already backfilled, skipped (use --force to refresh)")
                        continue
            except Exception as exc:
                logger.error("DB check failed for %r: %s", drug_name, exc)
                db_errors += 1
                print(f"✗ {drug_name} — DB error: {exc}")
                continue

        try:
            payload = fetch_indications_from_openfda(drug_name)
        except Exception as exc:
            logger.error("Unexpected error fetching %r: %s", drug_name, exc)
            not_found += 1
            print(f"⚠ {drug_name} — fetch error: {exc}")
            time.sleep(_SLEEP_BETWEEN_REQUESTS_S)
            continue

        if payload is None:
            not_found += 1
            print(f"⚠ {drug_name} — not found on openFDA")
            time.sleep(_SLEEP_BETWEEN_REQUESTS_S)
            continue

        ind_text = payload.get("indications_text") or ""
        char_count = len(ind_text)

        if args.dry_run:
            print(f"✓ {drug_name} — {char_count} chars (dry-run, not saved)")
        else:
            try:
                import database

                with database.db_engine.begin() as conn:
                    outcome = upsert_indication(conn, drug_name, payload)

                if outcome == "skipped_manual":
                    skipped_manual += 1
                    print(f"↷ {drug_name} — manual override, skipped")
                elif outcome == "updated":
                    updated += 1
                    print(f"✓ {drug_name} — updated ({char_count} chars)")
                else:
                    inserted += 1
                    print(f"✓ {drug_name} — inserted ({char_count} chars)")
            except Exception as exc:
                logger.error("DB write failed for %r: %s", drug_name, exc)
                db_errors += 1
                print(f"✗ {drug_name} — DB error: {exc}")

        time.sleep(_SLEEP_BETWEEN_REQUESTS_S)

    # Summary
    print(
        f"\nProcessed: {total} | "
        f"Inserted: {inserted} | "
        f"Updated: {updated} | "
        f"Skipped: {skipped_manual} | "
        f"Not found: {not_found} | "
        f"Errors: {db_errors}"
    )

    if db_errors > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main(sys.argv[1:])
