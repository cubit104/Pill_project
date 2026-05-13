"""CLI entrypoint for medication summary backfill."""

from __future__ import annotations

import argparse
import logging
import sys
from urllib.parse import quote

from services.indexnow import IndexNowSubmissionError, load_indexnow_config, submit_indexnow_urls
from services.medication_summary_backfill import run_medication_summary_backfill

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill medication summary rows from cached professional label HTML.")
    parser.add_argument("--limit", type=int, default=100, metavar="N")
    parser.add_argument("--offset", type=int, default=0, metavar="N")
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--force", action="store_true", default=False)
    parser.add_argument(
        "--submit-indexnow",
        action="store_true",
        default=False,
        help="Submit changed /pill/{slug} and /pill/{slug}/medication-summary URLs after live generation.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    summary = run_medication_summary_backfill(
        limit=args.limit,
        offset=args.offset,
        dry_run=args.dry_run,
        force=args.force,
    )

    print("========================================")
    print("Medication Summary Backfill Summary")
    print("========================================")
    print(f"Processed:                   {summary.processed}")
    print(f"Generated:                   {summary.generated}")
    print(f"Skipped has_medguide:        {summary.skipped_has_medguide}")
    print(f"Skipped missing_professional:{summary.skipped_missing_professional}")
    print(f"Skipped existing_summary:    {summary.skipped_existing_summary}")
    print(f"Errors:                      {summary.errors}")
    print("========================================")

    if args.submit_indexnow and not args.dry_run and summary.slugs_for_indexnow:
        try:
            config = load_indexnow_config()
            urls: list[str] = []
            for slug in summary.slugs_for_indexnow:
                encoded_slug = quote(slug, safe="")
                base_url = f"{config.site_url}/pill/{encoded_slug}"
                urls.append(base_url)
                urls.append(f"{base_url}/medication-summary")
            result = submit_indexnow_urls(urls, config=config, ignore_errors=True)
            logger.info(
                "Medication summary IndexNow: eligible=%d submitted=%d skipped=%d failed_batches=%d",
                result.total_urls,
                result.submitted_urls,
                result.skipped_urls,
                result.failed_batches,
            )
        except IndexNowSubmissionError as exc:
            logger.warning("Skipping medication summary IndexNow submission: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Medication summary IndexNow failed (non-fatal): %s", exc, exc_info=True)

    return 1 if summary.errors > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
