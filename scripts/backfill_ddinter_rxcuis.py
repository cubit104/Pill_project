"""CLI script: backfill missing rxcui_1 / rxcui_2 on DDInter rows.

The DDInter import wrote 160 K rows into ``drug_interactions`` with
``source_ddinter = TRUE`` but left ``rxcui_1`` and ``rxcui_2`` NULL because
the source file only contains drug names.  This script resolves each name to
an ingredient rxcui via ``drug_synonyms`` (and optionally via the free RxNorm
API as a fallback) and writes the resolved pair back to the row, while
respecting the ``UNIQUE(rxcui_1, rxcui_2)`` constraint.

Usage
-----
    # Always dry-run first:
    python scripts/backfill_ddinter_rxcuis.py --dry-run

    # Live run (Render Web Shell):
    python scripts/backfill_ddinter_rxcuis.py --limit 10000

    # Resume in batches:
    python scripts/backfill_ddinter_rxcuis.py --limit 10000 --offset 10000

    # Optional second pass for names not found in drug_synonyms:
    python scripts/backfill_ddinter_rxcuis.py --use-rxnorm --sleep-ms 250

Flags
-----
--dry-run          Resolve and compute everything, print summary, write nothing.
--limit N          Process at most N target rows (default: all).
--offset N         Skip first N target rows (default: 0).
--sleep-ms N       Delay (ms) between RxNorm API calls (only with --use-rxnorm, default: 250).
--use-rxnorm       For names not found in drug_synonyms, fall back to the live
                   RxNorm API (name → rxcui → ingredient rxcui).  Default OFF.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from collections import defaultdict
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

BATCH_SIZE = 1000
_RXNORM_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
_RXNORM_INGREDIENT_URL = "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/related.json"


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Populate missing rxcui_1 / rxcui_2 on DDInter rows in drug_interactions."
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
        help="Process at most N target rows (default: all).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        metavar="N",
        help="Skip the first N target rows (default: 0).",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=250,
        metavar="N",
        dest="sleep_ms",
        help="Milliseconds between RxNorm API calls (only with --use-rxnorm, default: 250).",
    )
    parser.add_argument(
        "--use-rxnorm",
        action="store_true",
        default=False,
        dest="use_rxnorm",
        help="For names not found in drug_synonyms, fall back to the live RxNorm API.",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# RxNorm helpers
# ---------------------------------------------------------------------------


def _resolve_to_ingredient_rxcui(client: httpx.Client, rxcui: str) -> str:
    """Given any rxcui, try to resolve it to an ingredient (IN tty) rxcui."""
    try:
        url = _RXNORM_INGREDIENT_URL.format(rxcui=rxcui)
        response = client.get(url, params={"tty": "IN"}, timeout=10)
        if response.status_code != 200:
            return rxcui
        data = response.json() or {}
        related_group = data.get("relatedGroup") or {}
        concept_groups = related_group.get("conceptGroup") or []
        for group in concept_groups:
            for prop in group.get("conceptProperties") or []:
                ingredient_rxcui = (prop.get("rxcui") or "").strip()
                if ingredient_rxcui:
                    return ingredient_rxcui
    except Exception as exc:
        logger.warning("Ingredient rxcui resolution failed for %s: %s", rxcui, exc)
    return rxcui


def _resolve_via_rxnorm(
    client: httpx.Client,
    name: str,
    sleep_s: float,
) -> Optional[str]:
    """Resolve a drug name to an ingredient rxcui via the free RxNorm API."""
    cleaned = (name or "").strip()
    if not cleaned:
        return None
    try:
        response = client.get(
            _RXNORM_URL, params={"name": cleaned, "allsrc": 0}, timeout=10
        )
        if sleep_s > 0:
            time.sleep(sleep_s)
        if response.status_code != 200:
            return None
        rxnorm_ids = (
            ((response.json() or {}).get("idGroup") or {}).get("rxnormId") or []
        )
        if rxnorm_ids:
            raw_rxcui = str(rxnorm_ids[0]).strip()
            return _resolve_to_ingredient_rxcui(client, raw_rxcui)
    except Exception as exc:
        logger.warning("RxNorm lookup failed for %r: %s", cleaned, exc)
    return None


# ---------------------------------------------------------------------------
# Synonym lookup
# ---------------------------------------------------------------------------


def _resolve_via_synonyms(conn, name: str) -> Optional[str]:
    """Resolve a drug name to an ingredient rxcui using the drug_synonyms table."""
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


# ---------------------------------------------------------------------------
# Collision-safe pair resolution
# ---------------------------------------------------------------------------


def _choose_order(
    a: str,
    b: str,
    occupied: Set[Tuple[str, str]],
) -> Optional[Tuple[str, str]]:
    """
    Return (r1, r2) that is free in *occupied*, preferring name order (a, b).
    Returns None if both orders are occupied.
    """
    if (a, b) not in occupied:
        return (a, b)
    if (b, a) not in occupied:
        return (b, a)
    return None


# ---------------------------------------------------------------------------
# Core logic (pure, testable)
# ---------------------------------------------------------------------------


def process_rows(
    rows: list,
    rxcui_cache: Dict[str, Optional[str]],
    occupied: Set[Tuple[str, str]],
    dry_run: bool,
    conn=None,
) -> dict:
    """
    Process a list of target rows and return a stats dict.

    Each row must have attributes/keys: id, drug_name_1, drug_name_2.
    If dry_run is False, conn must be a live DB connection; UPDATE statements
    are issued directly (caller manages the transaction).

    Returns a dict with keys:
        updated, skipped_unresolved, skipped_collision, skipped_self_pair,
        updates (list of (id, r1, r2) tuples for the caller to flush).
    """
    stats = dict(
        updated=0,
        skipped_unresolved=0,
        skipped_collision=0,
        skipped_self_pair=0,
        updates=[],
    )

    for row in rows:
        row_id = row[0]
        name1 = row[1]
        name2 = row[2]

        rxcui1 = rxcui_cache.get((name1 or "").lower())
        rxcui2 = rxcui_cache.get((name2 or "").lower())

        if not rxcui1 or not rxcui2:
            stats["skipped_unresolved"] += 1
            continue

        if rxcui1 == rxcui2:
            stats["skipped_self_pair"] += 1
            continue

        chosen = _choose_order(rxcui1, rxcui2, occupied)
        if chosen is None:
            stats["skipped_collision"] += 1
            logger.debug(
                "skipped_collision: id=%s (%s, %s) both orders occupied",
                row_id,
                rxcui1,
                rxcui2,
            )
            continue

        r1, r2 = chosen
        # Mark BOTH orderings so intra-run duplicates resolving to the same
        # drug pair (e.g., two DDInter rows for the same drugs) are blocked.
        occupied.add((r1, r2))
        occupied.add((r2, r1))
        stats["updates"].append((row_id, r1, r2))
        stats["updated"] += 1

    if not dry_run and conn is not None:
        for row_id, r1, r2 in stats["updates"]:
            conn.execute(
                text(
                    "UPDATE drug_interactions "
                    "SET rxcui_1 = :r1, rxcui_2 = :r2 "
                    "WHERE id = :id"
                ),
                {"r1": r1, "r2": r2, "id": row_id},
            )

    return stats


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
        "Starting DDInter rxcui backfill: dry_run=%s limit=%d offset=%d "
        "use_rxnorm=%s sleep_ms=%d",
        args.dry_run,
        args.limit,
        args.offset,
        args.use_rxnorm,
        args.sleep_ms,
    )

    if not database.db_engine:
        if not database.connect_to_database():
            logger.error("Cannot connect to database. Aborting.")
            sys.exit(1)

    sleep_s = args.sleep_ms / 1000.0

    # --- Step 1: select target rows ---
    target_query = text(
        """
        SELECT id, drug_name_1, drug_name_2
        FROM drug_interactions
        WHERE source_ddinter = TRUE
          AND (
            rxcui_1 IS NULL OR TRIM(COALESCE(rxcui_1, '')) = ''
            OR rxcui_2 IS NULL OR TRIM(COALESCE(rxcui_2, '')) = ''
          )
        ORDER BY id
        LIMIT :limit OFFSET :offset
        """
    )
    limit_val = args.limit if args.limit and args.limit > 0 else 10_000_000

    with database.db_engine.connect() as conn:
        target_rows = conn.execute(
            target_query,
            {"limit": limit_val, "offset": args.offset},
        ).fetchall()

    logger.info("Target DDInter rows to process: %d", len(target_rows))
    if not target_rows:
        logger.info("Nothing to do. Exiting.")
        return

    # --- Step 2: collect distinct drug names ---
    distinct_names: set[str] = set()
    for row in target_rows:
        if row[1]:
            distinct_names.add(row[1].strip())
        if row[2]:
            distinct_names.add(row[2].strip())
    logger.info("Distinct drug names to resolve: %d", len(distinct_names))

    # --- Step 3: resolve via drug_synonyms ---
    rxcui_cache: Dict[str, Optional[str]] = {}
    resolved_synonym = 0
    unresolved_names: set[str] = set()

    with database.db_engine.connect() as conn:
        for name in distinct_names:
            rxcui = _resolve_via_synonyms(conn, name)
            if rxcui:
                rxcui_cache[name.lower()] = rxcui
                resolved_synonym += 1
            else:
                rxcui_cache[name.lower()] = None
                unresolved_names.add(name)

    logger.info(
        "Synonym resolution: resolved=%d unresolved=%d",
        resolved_synonym,
        len(unresolved_names),
    )

    # --- Step 4: optional RxNorm fallback ---
    resolved_rxnorm = 0
    if args.use_rxnorm and unresolved_names:
        logger.info(
            "RxNorm fallback enabled — querying %d unresolved names (sleep_ms=%d)…",
            len(unresolved_names),
            args.sleep_ms,
        )
        with httpx.Client(timeout=12) as client:
            for name in sorted(unresolved_names):
                rxcui = _resolve_via_rxnorm(client, name, sleep_s)
                if rxcui:
                    rxcui_cache[name.lower()] = rxcui
                    resolved_rxnorm += 1
                    logger.debug("RxNorm resolved %r → %s", name, rxcui)
                else:
                    logger.debug("RxNorm could not resolve %r", name)

        logger.info("RxNorm resolution: additionally resolved=%d", resolved_rxnorm)

    # --- Step 5: load existing (rxcui_1, rxcui_2) pairs for collision detection ---
    logger.info("Loading existing rxcui pairs from drug_interactions…")
    with database.db_engine.connect() as conn:
        existing_rows = conn.execute(
            text(
                """
                SELECT rxcui_1, rxcui_2
                FROM drug_interactions
                WHERE rxcui_1 IS NOT NULL AND TRIM(COALESCE(rxcui_1,'')) <> ''
                  AND rxcui_2 IS NOT NULL AND TRIM(COALESCE(rxcui_2,'')) <> ''
                """
            )
        ).fetchall()
    occupied: Set[Tuple[str, str]] = {
        (str(r[0]).strip(), str(r[1]).strip()) for r in existing_rows
    }
    logger.info("Loaded %d existing rxcui pairs into collision-detection set.", len(occupied))

    # --- Step 6: per-name unresolved row counts (for summary) ---
    name_row_count: Dict[str, int] = defaultdict(int)
    for row in target_rows:
        n1 = (row[1] or "").strip()
        n2 = (row[2] or "").strip()
        if not rxcui_cache.get(n1.lower()):
            name_row_count[n1] += 1
        if not rxcui_cache.get(n2.lower()):
            name_row_count[n2] += 1

    # --- Step 7: batch update ---
    total_updated = 0
    total_skipped_unresolved = 0
    total_skipped_collision = 0
    total_skipped_self_pair = 0

    batches = [
        target_rows[i : i + BATCH_SIZE] for i in range(0, len(target_rows), BATCH_SIZE)
    ]
    logger.info("Processing %d batches of up to %d rows each…", len(batches), BATCH_SIZE)

    for batch_idx, batch in enumerate(batches):
        if args.dry_run:
            stats = process_rows(batch, rxcui_cache, occupied, dry_run=True)
        else:
            with database.db_engine.begin() as conn:
                stats = process_rows(batch, rxcui_cache, occupied, dry_run=False, conn=conn)

        total_updated += stats["updated"]
        total_skipped_unresolved += stats["skipped_unresolved"]
        total_skipped_collision += stats["skipped_collision"]
        total_skipped_self_pair += stats["skipped_self_pair"]

        if (batch_idx + 1) % 10 == 0 or batch_idx == len(batches) - 1:
            logger.info(
                "Batch %d/%d done — updated=%d skipped_unresolved=%d "
                "skipped_collision=%d skipped_self_pair=%d",
                batch_idx + 1,
                len(batches),
                total_updated,
                total_skipped_unresolved,
                total_skipped_collision,
                total_skipped_self_pair,
            )

    # --- Summary ---
    top_unresolved = sorted(name_row_count.items(), key=lambda x: -x[1])[:20]
    all_unresolved_names = sorted(
        {n for n in distinct_names if not rxcui_cache.get(n.lower())}
    )

    logger.info(
        "=== DDInter rxcui backfill summary ===\n"
        "  total_target_rows   : %d\n"
        "  distinct_names      : %d\n"
        "  resolved_synonym    : %d\n"
        "  resolved_rxnorm     : %d\n"
        "  unresolved_names    : %d\n"
        "  rows_updated        : %d\n"
        "  skipped_unresolved  : %d\n"
        "  skipped_collision   : %d\n"
        "  skipped_self_pair   : %d\n"
        "  dry_run             : %s",
        len(target_rows),
        len(distinct_names),
        resolved_synonym,
        resolved_rxnorm,
        len(all_unresolved_names),
        total_updated,
        total_skipped_unresolved,
        total_skipped_collision,
        total_skipped_self_pair,
        args.dry_run,
    )
    if top_unresolved:
        logger.info(
            "  top unresolved names by row count (up to 20):\n%s",
            "\n".join(f"    {cnt:>6}  {name}" for name, cnt in top_unresolved),
        )


if __name__ == "__main__":
    main(sys.argv[1:])
