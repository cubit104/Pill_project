"""CLI script: backfill drug_indications.plain_text from MedlinePlus Connect (NIH/NLM).

Usage
-----
    python scripts/backfill_indications_medlineplus.py --dry-run --limit 5
    python scripts/backfill_indications_medlineplus.py
    python scripts/backfill_indications_medlineplus.py --rxcui 29046
    python scripts/backfill_indications_medlineplus.py --force
    python scripts/backfill_indications_medlineplus.py --sleep 300

Flags
-----
--limit N          Only process the first N rxcuis from pillfinder.
--rxcui RXCUI      Process a single rxcui (skips the SELECT from pillfinder).
--force            Re-fetch even if a row already exists with source='medlineplus'
                   (still respects source='manual' skip logic).
--dry-run          Fetch and print results, but do not write to the DB.
--sleep MS         Sleep MS milliseconds between requests (default: 200).
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
logger = logging.getLogger("backfill_indications_medlineplus")

# Allow running from repository root OR from within scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

_DEFAULT_SLEEP_MS = 200

# Read-only query against pillfinder — never writes to it.
_RXCUI_SELECT_SQL = """
    SELECT DISTINCT p.rxcui
    FROM pillfinder p
    LEFT JOIN drug_indications di ON di.rxcui = p.rxcui
    WHERE p.deleted_at IS NULL
      AND p.rxcui IS NOT NULL
      AND p.rxcui != ''
      AND (di.rxcui IS NULL OR (:force AND di.source != 'manual'))
    ORDER BY p.rxcui
"""


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Backfill drug_indications.plain_text from MedlinePlus Connect (NIH/NLM)."
        )
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Only process the first N rxcuis.",
    )
    parser.add_argument(
        "--rxcui",
        type=str,
        default=None,
        metavar="RXCUI",
        help="Process a single rxcui (skips the SELECT from pillfinder).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Re-fetch even if row exists with source='medlineplus' (manual is still skipped).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        dest="dry_run",
        help="Fetch and print results without writing to the DB.",
    )
    parser.add_argument(
        "--sleep",
        type=int,
        default=_DEFAULT_SLEEP_MS,
        metavar="MS",
        help=f"Sleep MS milliseconds between requests (default: {_DEFAULT_SLEEP_MS}).",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------


def main(argv=None):
    args = _parse_args(argv)

    from services.medlineplus import fetch_by_rxcui
    from services.drug_indications import upsert_from_medlineplus

    sleep_s = args.sleep / 1000.0

    # Connect to DB (unless dry-run)
    db_engine = None
    if not args.dry_run:
        try:
            import database

            if not database.db_engine:
                if not database.connect_to_database():
                    logger.error("Cannot connect to database. Aborting.")
                    sys.exit(1)
            db_engine = database.db_engine
        except Exception as exc:
            logger.error("DB setup failed: %s", exc)
            sys.exit(1)

    # Build rxcui list
    if args.rxcui:
        rxcuis = [args.rxcui]
    elif args.dry_run:
        # In dry-run without --rxcui we still need the list, but we need a DB
        # connection to query pillfinder.  Attempt to connect; if that fails, bail.
        try:
            import database

            if not database.db_engine:
                if not database.connect_to_database():
                    logger.error("Cannot connect to database. Aborting.")
                    sys.exit(1)
            db_engine = database.db_engine
        except Exception as exc:
            logger.error("DB setup failed: %s", exc)
            sys.exit(1)

        rxcuis = _fetch_rxcuis(db_engine, force=args.force, limit=args.limit)
    else:
        rxcuis = _fetch_rxcuis(db_engine, force=args.force, limit=args.limit)

    if not rxcuis:
        print("No rxcuis to process.")
        sys.exit(0)

    # Counters
    processed = 0
    inserted = 0
    updated = 0
    skipped_manual = 0
    skipped_collision = 0
    not_found = 0
    errors = 0

    for rxcui in rxcuis:
        processed += 1

        try:
            payload = fetch_by_rxcui(rxcui)
        except Exception as exc:
            logger.error("Unexpected error fetching rxcui=%s: %s", rxcui, exc)
            errors += 1
            print(f"✗ {rxcui} — error: {exc}")
            time.sleep(sleep_s)
            continue

        if payload is None:
            not_found += 1
            print(f"⚠ {rxcui} — no MedlinePlus entry")
            time.sleep(sleep_s)
            continue

        char_count = len(payload.get("plain_text") or "")
        title = payload.get("title", "")

        if args.dry_run:
            print(f"✓ {rxcui} {title} — {char_count} chars (dry-run, not saved)")
        else:
            try:
                from sqlalchemy import text as _text  # noqa: F401 (needed indirectly)

                with db_engine.begin() as conn:
                    outcome = upsert_from_medlineplus(conn, rxcui, payload)

                if outcome == "skipped_manual":
                    skipped_manual += 1
                    print(f"↪ {rxcui} — skipped (manual)")
                elif outcome == "skipped_collision":
                    skipped_collision += 1
                    print(f"↪ {rxcui} — skipped (drug_name_key collision)")
                elif outcome == "updated":
                    updated += 1
                    print(f"✓ {rxcui} {title} — {char_count} chars")
                else:
                    inserted += 1
                    print(f"✓ {rxcui} {title} — {char_count} chars")
            except Exception as exc:
                logger.error("DB write failed for rxcui=%s: %s", rxcui, exc)
                errors += 1
                print(f"✗ {rxcui} — error: {exc}")

        time.sleep(sleep_s)

    print(
        f"\nProcessed: {processed} | "
        f"Inserted: {inserted} | "
        f"Updated: {updated} | "
        f"Skipped manual: {skipped_manual} | "
        f"Skipped collision: {skipped_collision} | "
        f"Not found: {not_found} | "
        f"Errors: {errors}"
    )
    sys.exit(0)


def _fetch_rxcuis(db_engine, *, force: bool, limit=None) -> list:
    """Return list of rxcuis to process from pillfinder (read-only)."""
    from sqlalchemy import text

    try:
        with db_engine.connect() as conn:
            rows = conn.execute(
                text(_RXCUI_SELECT_SQL),
                {"force": force},
            ).fetchall()
        rxcuis = [row[0] for row in rows]
        if limit is not None:
            rxcuis = rxcuis[:limit]
        return rxcuis
    except Exception as exc:
        logger.error("Failed to fetch rxcuis from pillfinder: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
