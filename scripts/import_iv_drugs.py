"""Fill public.iv_drugs from FDA's list of intravenous products (one row per drug).

    python -m scripts.import_iv_drugs                      # dry run: shows what would change, writes nothing
    python -m scripts.import_iv_drugs --report iv.csv      # dry run + spreadsheet of every row it would write
    python -m scripts.import_iv_drugs --apply              # write to the database

Safe to re-run: new rows arrive unpublished, a label already in use is kept while FDA still lists it,
rows with setid_locked keep their label, slugs never change and nothing is deleted.
See services/iv_drugs_import.py for how the one label per drug is picked.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import database  # noqa: E402
from services.iv_drugs_import import DEFAULT_CACHE_DIR, run_import  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("import_iv_drugs")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import IV drugs (one row per drug) into public.iv_drugs")
    parser.add_argument("--apply", action="store_true", default=False, help="write to the database (default is a dry run)")
    parser.add_argument("--refresh", action="store_true", default=False, help="ignore cached FDA / RxNorm / DailyMed answers")
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR, dest="cache_dir")
    parser.add_argument("--decisions", default=None, help="reviewed spreadsheet with slug and your_decision columns")
    parser.add_argument("--report", default=None, help="write every row that would be imported to this CSV")
    parser.add_argument(
        "--fix-unpublished",
        action="store_true",
        default=False,
        dest="fix_unpublished",
        help="before launch: rows never published and without a card may get a corrected slug or be dropped if now excluded",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)

    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    stats = run_import(
        database.db_engine,
        dry_run=not args.apply,
        cache_dir=args.cache_dir,
        refresh=args.refresh,
        decisions_csv=args.decisions,
        report_csv=args.report,
        fix_unpublished=args.fix_unpublished,
    )
    logger.info("%s", "APPLIED" if args.apply else "DRY RUN (nothing written; add --apply to write)")
    for name, count in sorted(stats.items()):
        logger.info("  %-55s %d", name, count)


if __name__ == "__main__":
    main()
