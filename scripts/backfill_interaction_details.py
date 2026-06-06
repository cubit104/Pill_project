from __future__ import annotations

import argparse
import logging
import os
import sys
import time

from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402
from services.spl_professional import extract_pro_section_html  # noqa: E402


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_interaction_details")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill drug interaction details from stored SPL professional HTML")
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--sleep-ms", type=int, default=0, dest="sleep_ms")
    return parser.parse_args(argv)


def _lookup_generic_name(conn, rxcui: str) -> str:
    row = conn.execute(
        text(
            """
            SELECT generic_name
            FROM drug_synonyms
            WHERE ingredient_rxcui::text = :rxcui
            LIMIT 1
            """
        ),
        {"rxcui": str(rxcui)},
    ).fetchone()
    return str(row[0]).strip() if row and row[0] else str(rxcui)


def _is_manual_source(conn, rxcui: str) -> bool:
    row = conn.execute(
        text("SELECT source FROM drug_interactions_text WHERE rxcui = :rxcui LIMIT 1"),
        {"rxcui": str(rxcui)},
    ).fetchone()
    return bool(row and str(row[0] or "").strip().lower() == "manual")


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    query = """
        SELECT rxcui::text, professional_html
        FROM medication_guide
        WHERE professional_html ILIKE '%drug-interactions%'
          AND rxcui IS NOT NULL
        ORDER BY rxcui
        OFFSET :offset
    """
    params: dict[str, int] = {"offset": max(args.offset, 0)}
    if args.limit is not None:
        query += "\nLIMIT :limit"
        params["limit"] = max(args.limit, 0)

    processed = 0
    upserted = 0
    skipped = 0
    errors = 0

    # Fetch all rows in one read connection
    with database.db_engine.connect() as read_conn:
        rows = read_conn.execute(text(query), params).fetchall()

    # Process each row in its own transaction so one failure doesn't abort the rest
    for rxcui, professional_html in rows:
        processed += 1
        try:
            section_html = extract_pro_section_html(professional_html, "drug-interactions")
            if not section_html:
                skipped += 1
                continue

            with database.db_engine.begin() as conn:
                if _is_manual_source(conn, str(rxcui)):
                    skipped += 1
                    continue

                drug_name = _lookup_generic_name(conn, str(rxcui))

                if args.dry_run:
                    upserted += 1
                    continue

                conn.execute(
                    text(
                        """
                        INSERT INTO drug_interactions_text (rxcui, drug_name, interactions_text, source, updated_at)
                        VALUES (:rxcui, :drug_name, :interactions_text, 'spl_professional', NOW())
                        ON CONFLICT (rxcui) DO UPDATE
                        SET drug_name = EXCLUDED.drug_name,
                            interactions_text = EXCLUDED.interactions_text,
                            source = EXCLUDED.source,
                            updated_at = NOW()
                        WHERE COALESCE(drug_interactions_text.source, '') <> 'manual'
                        """
                    ),
                    {
                        "rxcui": str(rxcui),
                        "drug_name": drug_name,
                        "interactions_text": section_html,
                    },
                )
                upserted += 1

        except Exception as exc:
            errors += 1
            logger.warning("Failed interaction detail backfill for rxcui=%s: %s", rxcui, exc)
        finally:
            time.sleep(max(args.sleep_ms, 0) / 1000.0)

    logger.info(
        "Backfill complete: processed=%s upserted=%s skipped=%s errors=%s dry_run=%s",
        processed,
        upserted,
        skipped,
        errors,
        args.dry_run,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
