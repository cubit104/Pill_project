"""Backfill rxcui_1 / rxcui_2 for DDInter rows in drug_interactions.

DDInter rows were imported with NULL rxcui columns even though valid
ingredient-level rxcuis exist in drug_synonyms.  This script resolves each
drug name via drug_synonyms (and optionally the free RxNorm API) and writes
the resolved pair back — making the rows visible to the both-order pair lookup
in routes/interactions.py.

Usage examples (Render Web Shell)
----------------------------------
# Step 1 — always dry-run first
python scripts/backfill_ddinter_rxcuis.py --dry-run

# Step 2 — live run (batches of 1,000)
python scripts/backfill_ddinter_rxcuis.py

# Step 3 — optional RxNorm pass for names not in drug_synonyms
python scripts/backfill_ddinter_rxcuis.py --use-rxnorm --sleep-ms 300

# Resumable batches / testing
python scripts/backfill_ddinter_rxcuis.py --limit 5000 --offset 0
python scripts/backfill_ddinter_rxcuis.py --limit 5000 --offset 5000

Flags
-----
--dry-run          Resolve and compute everything; print summary; write nothing.
--limit N          Process at most N target rows (default: unlimited).
--offset N         Skip first N target rows (default: 0).
--use-rxnorm       For names not found in drug_synonyms, fall back to RxNorm API.
--sleep-ms N       Milliseconds between RxNorm API calls (default: 250, only with --use-rxnorm).
"""

from __future__ import annotations

import argparse
import collections
import logging
import os
import sys
import time
from typing import Dict, Optional, Set, Tuple

import httpx
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_ddinter_rxcuis")

BATCH_SIZE = 1_000

_RXNORM_NAME_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
_RXNORM_INGREDIENT_URL = "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json"


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill rxcui_1/rxcui_2 for DDInter rows in drug_interactions "
            "by resolving drug names via drug_synonyms (and optionally RxNorm)."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        dest="dry_run",
        help="Resolve and compute everything, print summary, write nothing.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        metavar="N",
        help="Process at most N target rows (default: 0 = unlimited).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        metavar="N",
        help="Skip first N target rows (default: 0).",
    )
    parser.add_argument(
        "--use-rxnorm",
        action="store_true",
        default=False,
        dest="use_rxnorm",
        help="For names not in drug_synonyms, fall back to RxNorm API.",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=250,
        metavar="N",
        dest="sleep_ms",
        help="Milliseconds between RxNorm API calls (default: 250).",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# RxNorm helpers (same approach as routes/interactions.py)
# ---------------------------------------------------------------------------


def _resolve_to_ingredient_rxcui(client: httpx.Client, rxcui: str) -> str:
    """Given any rxcui, return its ingredient-level rxcui (IN tty), or the original."""
    try:
        url = _RXNORM_INGREDIENT_URL.format(rxcui=rxcui)
        response = client.get(url, params={"tty": "IN"}, timeout=10)
        if response.status_code != 200:
            return rxcui
        data = response.json() or {}
        related_group = data.get("relatedGroup") or {}
        concept_groups = related_group.get("conceptGroup") or []
        for group in concept_groups:
            for prop in (group.get("conceptProperties") or []):
                ingredient_rxcui = (prop.get("rxcui") or "").strip()
                if ingredient_rxcui:
                    return ingredient_rxcui
    except Exception as exc:
        logger.warning("Ingredient RXCUI resolution failed for %s: %s", rxcui, exc)
    return rxcui


def _resolve_rxcui_from_rxnorm(client: httpx.Client, name: str, sleep_s: float) -> Optional[str]:
    """Resolve a drug name to ingredient rxcui via RxNorm API."""
    cleaned = (name or "").strip()
    if not cleaned:
        return None
    try:
        time.sleep(sleep_s)
        response = client.get(_RXNORM_NAME_URL, params={"name": cleaned, "allsrc": 0}, timeout=10)
        if response.status_code != 200:
            return None
        rxnorm_ids = (((response.json() or {}).get("idGroup") or {}).get("rxnormId") or [])
        if rxnorm_ids:
            raw_rxcui = str(rxnorm_ids[0]).strip()
            return _resolve_to_ingredient_rxcui(client, raw_rxcui)
    except Exception as exc:
        logger.warning("RxNorm lookup failed for %s: %s", cleaned, exc)
    return None


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _resolve_via_synonyms(conn, name: str) -> Optional[str]:
    """Resolve a drug name to ingredient rxcui via drug_synonyms table."""
    cleaned = (name or "").strip()
    if not cleaned:
        return None
    row = conn.execute(
        text(
            """
            SELECT ingredient_rxcui
            FROM drug_synonyms
            WHERE LOWER(generic_name) = LOWER(:name)
               OR EXISTS (
                    SELECT 1
                    FROM unnest(brand_names) AS bn
                    WHERE LOWER(bn) = LOWER(:name)
                )
            LIMIT 1
            """
        ),
        {"name": cleaned},
    ).fetchone()
    if row and row[0]:
        return str(row[0]).strip()
    return None


def _load_existing_pairs(conn) -> Set[Tuple[str, str]]:
    """Preload all non-empty (rxcui_1, rxcui_2) tuples from drug_interactions."""
    rows = conn.execute(
        text(
            """
            SELECT rxcui_1, rxcui_2
            FROM drug_interactions
            WHERE TRIM(COALESCE(rxcui_1, '')) <> ''
              AND TRIM(COALESCE(rxcui_2, '')) <> ''
            """
        )
    ).fetchall()
    return {(str(r[0]).strip(), str(r[1]).strip()) for r in rows}


def _fetch_target_rows(conn, limit: int, offset: int) -> list:
    """Fetch DDInter rows with missing rxcuis."""
    query = """
        SELECT id, drug_name_1, drug_name_2
        FROM drug_interactions
        WHERE source_ddinter = TRUE
          AND (
              rxcui_1 IS NULL OR TRIM(COALESCE(rxcui_1, '')) = ''
           OR rxcui_2 IS NULL OR TRIM(COALESCE(rxcui_2, '')) = ''
          )
        ORDER BY id
    """
    params: dict = {}
    if limit and limit > 0:
        query += " LIMIT :limit"
        params["limit"] = limit
    if offset and offset > 0:
        query += " OFFSET :offset"
        params["offset"] = offset
    return conn.execute(text(query), params).fetchall()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv=None) -> None:
    args = _parse_args(argv)

    if not args.dry_run:
        logger.warning(
            "⚠️  LIVE MODE — rows will be written to drug_interactions. "
            "Always run with --dry-run first."
        )
    else:
        logger.info("DRY-RUN mode — no changes will be written to the database.")

    logger.info(
        "Starting DDInter rxcui backfill: dry_run=%s limit=%s offset=%d "
        "use_rxnorm=%s sleep_ms=%d",
        args.dry_run,
        args.limit or "unlimited",
        args.offset,
        args.use_rxnorm,
        args.sleep_ms,
    )

    if not database.db_engine:
        if not database.connect_to_database():
            logger.error("Cannot connect to database. Aborting.")
            sys.exit(1)

    sleep_s = args.sleep_ms / 1000.0

    # --- Load target rows ---
    with database.db_engine.connect() as conn:
        target_rows = _fetch_target_rows(conn, args.limit, args.offset)
        logger.info("Target rows (missing rxcuis): %d", len(target_rows))

        if not target_rows:
            logger.info("Nothing to backfill. Exiting.")
            return

        # --- Collect distinct drug names ---
        distinct_names: Set[str] = set()
        for row in target_rows:
            if row.drug_name_1:
                distinct_names.add(row.drug_name_1.strip())
            if row.drug_name_2:
                distinct_names.add(row.drug_name_2.strip())

        logger.info("Distinct drug names to resolve: %d", len(distinct_names))

        # --- Resolve names → rxcui cache ---
        rxcui_cache: Dict[str, Optional[str]] = {}
        resolved_via_synonyms = 0
        resolved_via_rxnorm = 0

        # Count rows per unresolved name for the summary
        name_row_count: Dict[str, int] = collections.Counter()
        for row in target_rows:
            if row.drug_name_1:
                name_row_count[row.drug_name_1.strip()] += 1
            if row.drug_name_2:
                name_row_count[row.drug_name_2.strip()] += 1

        http_client: Optional[httpx.Client] = None
        if args.use_rxnorm:
            http_client = httpx.Client(timeout=10)

        try:
            for name in sorted(distinct_names):
                cache_key = name.lower()
                # Try drug_synonyms first
                rxcui = _resolve_via_synonyms(conn, name)
                if rxcui:
                    rxcui_cache[cache_key] = rxcui
                    resolved_via_synonyms += 1
                    continue

                # Optionally fall back to RxNorm
                if args.use_rxnorm and http_client is not None:
                    rxcui = _resolve_rxcui_from_rxnorm(http_client, name, sleep_s)
                    if rxcui:
                        rxcui_cache[cache_key] = rxcui
                        resolved_via_rxnorm += 1
                        continue

                rxcui_cache[cache_key] = None
        finally:
            if http_client is not None:
                http_client.close()

        unresolved_names = {n for n in distinct_names if not rxcui_cache.get(n.lower())}
        logger.info(
            "Resolution complete: via_synonyms=%d via_rxnorm=%d unresolved=%d",
            resolved_via_synonyms,
            resolved_via_rxnorm,
            len(unresolved_names),
        )

        # --- Preload existing pairs for collision detection ---
        existing_pairs: Set[Tuple[str, str]] = _load_existing_pairs(conn)

    # --- Process rows and write in batches ---
    rows_updated = 0
    skipped_unresolved = 0
    skipped_collision = 0
    skipped_self_pair = 0

    batch: list[dict] = []

    def _flush_batch(batch_rows: list[dict]) -> int:
        if not batch_rows or args.dry_run:
            return 0
        count = 0
        with database.db_engine.begin() as txn:
            for params in batch_rows:
                txn.execute(
                    text(
                        """
                        UPDATE drug_interactions
                        SET rxcui_1 = :rxcui_1,
                            rxcui_2 = :rxcui_2,
                            updated_at = NOW()
                        WHERE id = :id
                        """
                    ),
                    params,
                )
                count += 1
        return count

    for row in target_rows:
        name1 = (row.drug_name_1 or "").strip()
        name2 = (row.drug_name_2 or "").strip()

        rxcui_a = rxcui_cache.get(name1.lower()) if name1 else None
        rxcui_b = rxcui_cache.get(name2.lower()) if name2 else None

        # Skip if either name is unresolved
        if not rxcui_a or not rxcui_b:
            skipped_unresolved += 1
            continue

        # Skip self-pair (same drug)
        if rxcui_a == rxcui_b:
            skipped_self_pair += 1
            continue

        # Collision-safe pair selection: use name order (a, b) first
        if (rxcui_a, rxcui_b) not in existing_pairs:
            chosen_1, chosen_2 = rxcui_a, rxcui_b
        elif (rxcui_b, rxcui_a) not in existing_pairs:
            chosen_1, chosen_2 = rxcui_b, rxcui_a
        else:
            skipped_collision += 1
            continue

        # Mark both orderings as taken so intra-run duplicates are caught
        existing_pairs.add((chosen_1, chosen_2))
        existing_pairs.add((chosen_2, chosen_1))
        batch.append({"id": row.id, "rxcui_1": chosen_1, "rxcui_2": chosen_2})

        if len(batch) >= BATCH_SIZE:
            rows_updated += _flush_batch(batch)
            logger.info("Batch committed: %d rows updated so far", rows_updated)
            batch.clear()

    # Flush remaining
    if batch:
        rows_updated += _flush_batch(batch)
        batch.clear()

    # --- Summary ---
    top_unresolved = sorted(
        unresolved_names,
        key=lambda n: name_row_count.get(n, 0),
        reverse=True,
    )[:20]

    logger.info(
        "DDInter rxcui backfill done: "
        "target_rows=%d distinct_names=%d resolved_synonyms=%d resolved_rxnorm=%d "
        "unresolved=%d rows_updated=%d skipped_unresolved=%d "
        "skipped_collision=%d skipped_self_pair=%d dry_run=%s",
        len(target_rows),
        len(distinct_names),
        resolved_via_synonyms,
        resolved_via_rxnorm,
        len(unresolved_names),
        rows_updated if not args.dry_run else 0,
        skipped_unresolved,
        skipped_collision,
        skipped_self_pair,
        args.dry_run,
    )

    if top_unresolved:
        logger.info(
            "Top unresolved names (by row count): %s",
            ", ".join(f"{n!r}({name_row_count.get(n, 0)})" for n in top_unresolved),
        )

    if args.dry_run:
        logger.info(
            "DRY-RUN summary: would update %d rows, skip %d unresolved, "
            "%d collision, %d self-pair.",
            len([r for r in target_rows
                 if rxcui_cache.get((r.drug_name_1 or "").strip().lower())
                 and rxcui_cache.get((r.drug_name_2 or "").strip().lower())
                 and rxcui_cache.get((r.drug_name_1 or "").strip().lower())
                    != rxcui_cache.get((r.drug_name_2 or "").strip().lower())]),
            skipped_unresolved,
            skipped_collision,
            skipped_self_pair,
        )


if __name__ == "__main__":
    main(sys.argv[1:])
