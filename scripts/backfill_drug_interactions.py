from __future__ import annotations

import argparse
import logging
import os
import sys
import time

import httpx
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_drug_interactions")

OPENFDA_URL = "https://api.fda.gov/drug/label.json"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill drug interactions from OpenFDA labels")
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--sleep-ms", type=int, default=300, dest="sleep_ms")
    return parser.parse_args(argv)


def _fetch_interactions_text(client: httpx.Client, rxcui: str, generic_name: str | None) -> tuple[str, str]:
    generic = (generic_name or "").strip()
    if not generic:
        return "", ""
    escaped_generic = generic.replace('"', '\\"')
    response = client.get(
        OPENFDA_URL,
        params={"search": f'openfda.generic_name:"{escaped_generic}"', "limit": 1},
        timeout=12,
    )
    if response.status_code != 200:
        return "", ""
    payload = response.json() or {}
    result = (payload.get("results") or [{}])[0]
    interaction_list = result.get("drug_interactions") or []
    interaction_text = " ".join([t.strip() for t in interaction_list if t]).strip()
    openfda = result.get("openfda") or {}
    drug_name = (
        ((openfda.get("generic_name") or [None])[0])
        or ((openfda.get("brand_name") or [None])[0])
        or ""
    )
    return str(drug_name).strip(), interaction_text


def _update_pairs_from_text(conn, rxcui: str, interaction_text: str, dry_run: bool) -> int:
    if not interaction_text:
        return 0

    text_lower = interaction_text.lower()
    rows = conn.execute(
        text(
            """
            SELECT id, rxcui_1, rxcui_2, drug_name_1, drug_name_2, source_kaggle
            FROM drug_interactions
            WHERE rxcui_1 = :r OR rxcui_2 = :r
            """
        ),
        {"r": rxcui},
    ).fetchall()

    updated = 0
    for row in rows:
        other_name = row[4] if str(row[1]) == str(rxcui) else row[3]
        if not other_name:
            continue
        if str(other_name).lower() in text_lower:
            updated += 1
            if dry_run:
                continue
            conn.execute(
                text(
                    """
                    UPDATE drug_interactions
                    SET source_openfda = TRUE,
                        confidence = CASE WHEN source_kaggle THEN 'high' ELSE 'medium' END,
                        updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": row[0]},
            )
    return updated


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    logger.info(
        "Starting drug interaction backfill: dry_run=%s limit=%d offset=%d sleep_ms=%d",
        args.dry_run,
        args.limit,
        args.offset,
        args.sleep_ms,
    )

    with database.db_engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT ingredient_rxcui, generic_name
                FROM drug_synonyms
                WHERE ingredient_rxcui IS NOT NULL AND TRIM(ingredient_rxcui) <> ''
                ORDER BY ingredient_rxcui
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": args.limit, "offset": args.offset},
        ).fetchall()

        processed = 0
        text_upserts = 0
        pair_updates = 0
        errors = 0

        with httpx.Client(timeout=12) as client:
            for rxcui, generic_name in rows:
                processed += 1
                try:
                    drug_name, interaction_text = _fetch_interactions_text(client, str(rxcui), str(generic_name or ""))
                    if interaction_text and not args.dry_run:
                        conn.execute(
                            text(
                                """
                                INSERT INTO drug_interactions_text (rxcui, drug_name, interactions_text, source, updated_at)
                                VALUES (:rxcui, :drug_name, :interactions_text, 'openfda', NOW())
                                ON CONFLICT (rxcui) DO UPDATE
                                SET drug_name = EXCLUDED.drug_name,
                                    interactions_text = EXCLUDED.interactions_text,
                                    source = EXCLUDED.source,
                                    updated_at = NOW()
                                """
                            ),
                            {
                                "rxcui": str(rxcui),
                                "drug_name": drug_name or generic_name,
                                "interactions_text": interaction_text,
                            },
                        )
                    if interaction_text:
                        text_upserts += 1
                    pair_updates += _update_pairs_from_text(conn, str(rxcui), interaction_text, args.dry_run)
                except Exception as exc:
                    errors += 1
                    logger.warning("Failed OpenFDA backfill for rxcui=%s: %s", rxcui, exc)
                finally:
                    time.sleep(max(args.sleep_ms, 0) / 1000.0)

    logger.info(
        "Backfill complete: processed=%s text_upserts=%s pair_updates=%s errors=%s dry_run=%s",
        processed,
        text_upserts,
        pair_updates,
        errors,
        args.dry_run,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
