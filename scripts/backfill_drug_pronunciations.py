"""CLI script: backfill drug pronunciations from MedlinePlus + g2p fallback."""

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
logger = logging.getLogger("backfill_drug_pronunciations")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


_DEF_SELECT_DRUGS = """
    SELECT DISTINCT name
    FROM drug_name_suggestions
    ORDER BY lower_name
    LIMIT :limit OFFSET :offset
"""

_DEF_SELECT_DRUGS_NO_LIMIT = """
    SELECT DISTINCT name
    FROM drug_name_suggestions
    ORDER BY lower_name
    OFFSET :offset
"""


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill drug pronunciations from MedlinePlus and g2p into drug_pronunciations table."
    )
    parser.add_argument("--dry-run", action="store_true", default=False, help="Fetch and print results without writing to the DB.")
    parser.add_argument("--limit", type=int, default=None, metavar="N", help="Only process the first N drug names.")
    parser.add_argument("--offset", type=int, default=0, metavar="N", help="Skip the first N rows from drug_name_suggestions.")
    parser.add_argument("--drug", type=str, default=None, metavar="NAME", help="Process a single named drug.")
    parser.add_argument("--force", action="store_true", default=False, help="Re-process even if pronunciation already exists.")
    parser.add_argument("--sleep-ms", type=int, default=300, metavar="MS", help="Sleep between MedlinePlus calls in milliseconds.")
    return parser.parse_args(argv)


def main(argv=None):
    args = _parse_args(argv)
    from sqlalchemy import text

    from services.drug_pronunciation import (
        fetch_pronunciation_from_medlineplus,
        generate_pronunciation_g2p,
        resolve_rxcui_for_drug_name,
        upsert_pronunciation,
    )

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
        if args.drug:
            drugs = [args.drug]
        else:
            sql = _DEF_SELECT_DRUGS if args.limit is not None else _DEF_SELECT_DRUGS_NO_LIMIT
            rows = conn.execute(text(sql), {"limit": args.limit, "offset": args.offset}).fetchall()
            drugs = [(row[0] or "").strip() for row in rows if (row[0] or "").strip()]

    if not drugs:
        print("No drugs to process.")
        sys.exit(0)

    sleep_s = max(0, args.sleep_ms) / 1000.0

    total = 0
    medlineplus_count = 0
    g2p_count = 0
    skipped = 0
    not_found = 0
    errors = 0
    processed_lowers = set()

    for drug_name in drugs:
        total += 1
        lower_name = drug_name.lower()

        if lower_name in processed_lowers:
            skipped += 1
            print(f"↷ {drug_name} — duplicate casing in this run, skipped")
            continue
        processed_lowers.add(lower_name)

        try:
            with database.db_engine.connect() as conn:
                existing = conn.execute(
                    text("SELECT source FROM drug_pronunciations WHERE drug_name_lower = LOWER(:name) LIMIT 1"),
                    {"name": drug_name},
                ).fetchone()

            if existing and existing[0] == "manual":
                skipped += 1
                print(f"↷ {drug_name} — manual override, skipped")
                continue
            if existing and not args.force:
                skipped += 1
                print(f"↷ {drug_name} — already backfilled, skipped (use --force to refresh)")
                continue

            rxcui = None
            with database.db_engine.connect() as conn:
                rxcui = resolve_rxcui_for_drug_name(conn, drug_name)

            medline_payload = None
            if rxcui:
                medline_payload = fetch_pronunciation_from_medlineplus(rxcui)
                time.sleep(sleep_s)

            if medline_payload and medline_payload.get("pronunciation_text"):
                if args.dry_run:
                    print(f"✓ {drug_name} — MedlinePlus: {medline_payload['pronunciation_text']} (dry-run)")
                else:
                    with database.db_engine.begin() as conn:
                        outcome = upsert_pronunciation(
                            conn,
                            drug_name=drug_name,
                            pronunciation_text=medline_payload["pronunciation_text"],
                            source="medlineplus",
                            medlineplus_url=medline_payload.get("medlineplus_url"),
                            needs_review=False,
                        )
                    if outcome == "skipped_manual":
                        skipped += 1
                        print(f"↷ {drug_name} — manual override, skipped")
                        continue
                    print(f"✓ {drug_name} — MedlinePlus ({outcome})")
                medlineplus_count += 1
                continue

            g2p_text = generate_pronunciation_g2p(drug_name)
            if g2p_text:
                if args.dry_run:
                    print(f"✓ {drug_name} — g2p: {g2p_text} (dry-run)")
                else:
                    with database.db_engine.begin() as conn:
                        outcome = upsert_pronunciation(
                            conn,
                            drug_name=drug_name,
                            pronunciation_text=g2p_text,
                            source="g2p",
                            needs_review=True,
                        )
                    if outcome == "skipped_manual":
                        skipped += 1
                        print(f"↷ {drug_name} — manual override, skipped")
                        continue
                    print(f"✓ {drug_name} — g2p ({outcome})")
                g2p_count += 1
                continue

            not_found += 1
            print(f"⚠ {drug_name} — not found")
        except Exception as exc:
            logger.error("Processing failed for %r: %s", drug_name, exc)
            errors += 1
            print(f"✗ {drug_name} — error: {exc}")

    print(
        f"\nProcessed: {total} | "
        f"MedlinePlus: {medlineplus_count} | "
        f"g2p: {g2p_count} | "
        f"Skipped: {skipped} | "
        f"Not found: {not_found} | "
        f"Errors: {errors}"
    )

    if errors > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main(sys.argv[1:])
