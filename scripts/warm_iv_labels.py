"""Fetch the FDA label of every IV drug into the medication_guide cache, so its label pages have content.

    python -m scripts.warm_iv_labels --limit 5        # try a few
    python -m scripts.warm_iv_labels                  # every IV drug whose label is not cached yet
    python -m scripts.warm_iv_labels --all --force    # re-fetch everything

Uses the same build_guide(spl_set_id=...) the pill pages use: one DailyMed label per drug, rendered
professional label, medication guide and boxed warning included. Safe to stop and re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from collections import Counter

from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402
from services.medication_guide import GuideNotFoundError, build_guide  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
for noisy in ("httpx", "httpcore"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
logger = logging.getLogger("warm_iv_labels")

SELECT_SQL = """
    SELECT i.slug, i.spl_set_id
    FROM public.iv_drugs i
    WHERE i.deleted_at IS NULL
      AND (:everything OR NOT EXISTS (
            SELECT 1 FROM public.medication_guide mg
            WHERE mg.spl_set_id = i.spl_set_id AND NULLIF(mg.professional_html, '') IS NOT NULL
      ))
    ORDER BY i.maker_count DESC, i.slug
    LIMIT :limit
"""


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Warm the medication_guide cache for IV drugs")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--all", action="store_true", default=False, dest="everything", help="also drugs already cached")
    parser.add_argument("--force", action="store_true", default=False, help="re-fetch even when the cached label is fresh")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between drugs (be polite to DailyMed)")
    parser.add_argument("--dry-run", action="store_true", default=False)
    return parser.parse_args(argv)


async def _warm(rows, force: bool, delay: float) -> Counter:
    stats: Counter = Counter()
    for n, (slug, setid) in enumerate(rows, 1):
        started = time.time()
        try:
            guide = await build_guide(
                spl_set_id=setid,
                force_refresh=force,
                include_professional=True,
                include_medguide=True,
                include_boxed_warning=True,
            )
            outcome = "label cached" if guide.get("professional_html") else "cached without professional label"
        except GuideNotFoundError:
            outcome = "no label found"
        except Exception as exc:  # one bad label must not stop the run
            outcome = "error"
            logger.warning("%s (%s): %s", slug, setid, exc)
        stats[outcome] += 1
        logger.info("%d/%d %s -> %s (%.1fs)", n, len(rows), slug, outcome, time.time() - started)
        await asyncio.sleep(delay)
    return stats


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    with database.db_engine.connect() as conn:
        rows = conn.execute(text(SELECT_SQL), {"everything": args.everything, "limit": args.limit}).fetchall()
    logger.info("%d IV drugs to warm", len(rows))
    if args.dry_run:
        return

    stats = asyncio.run(_warm([(r[0], r[1]) for r in rows], args.force, args.delay))
    for name, count in sorted(stats.items()):
        logger.info("  %-40s %d", name, count)


if __name__ == "__main__":
    main()
