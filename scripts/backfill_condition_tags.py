"""CLI script: backfill drug_condition_tags from drug_indications.plain_text.

Usage
-----
    python scripts/backfill_condition_tags.py
    python scripts/backfill_condition_tags.py --dry-run

Flags
-----
--dry-run    Extract and print tags for each rxcui, but do not write to the DB.
"""

import argparse
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_condition_tags")

# Allow running from repository root OR from within scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill drug_condition_tags from drug_indications.plain_text."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Extract and print tags without writing to the DB.",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)

    from services.condition_tags import extract_tags, backfill_condition_tags

    if args.dry_run:
        # Dry run: connect read-only and just print extracted tags
        try:
            import database
            from sqlalchemy import text

            if not database.db_engine:
                if not database.connect_to_database():
                    logger.error("Cannot connect to database. Aborting.")
                    sys.exit(1)
        except Exception as exc:
            logger.error("DB setup failed: %s", exc)
            sys.exit(1)

        processed = 0
        tagged = 0
        skipped = 0

        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT di.rxcui, p.medicine_name, di.plain_text
                    FROM drug_indications di
                    JOIN pillfinder p ON p.rxcui = di.rxcui
                    WHERE di.plain_text IS NOT NULL AND di.rxcui IS NOT NULL
                      AND p.deleted_at IS NULL
                    """
                )
            ).fetchall()

            seen: set[str] = set()
            for row in rows:
                rxcui = str(row[0]).strip()
                medicine_name = row[1] or ""
                plain_text = row[2] or ""

                if rxcui in seen:
                    skipped += 1
                    continue
                seen.add(rxcui)

                processed += 1
                tags = extract_tags(plain_text)
                if tags:
                    tagged += 1
                    print(f"✓ {rxcui} {medicine_name} — {tags} (dry-run, not saved)")
                else:
                    skipped += 1
                    print(f"⚠ {rxcui} {medicine_name} — no tags matched")

        print(
            f"\nProcessed: {processed} | Tagged: {tagged} | Skipped/no-match: {skipped}"
        )
        return

    # Live run
    try:
        import database

        if not database.db_engine:
            if not database.connect_to_database():
                logger.error("Cannot connect to database. Aborting.")
                sys.exit(1)
    except Exception as exc:
        logger.error("DB setup failed: %s", exc)
        sys.exit(1)

    with database.db_engine.connect() as conn:
        summary = backfill_condition_tags(conn)

    print(
        f"\nProcessed: {summary['processed']} | "
        f"Tagged: {summary['tagged']} | "
        f"Skipped/no-match: {summary['skipped']}"
    )


if __name__ == "__main__":
    main(sys.argv[1:])
