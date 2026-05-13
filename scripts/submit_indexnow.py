"""Submit PillSeek URLs to IndexNow-compatible search engines."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from services.indexnow import (
    DEFAULT_BATCH_SIZE,
    IndexNowSubmissionError,
    expand_backfill_report_urls,
    load_indexnow_config,
    read_urls_from_file,
    submit_indexnow_urls,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Submit PillSeek URLs to IndexNow from direct URLs, text files, or backfill reports."
    )
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        help="Absolute URL to submit. May be specified multiple times.",
    )
    parser.add_argument(
        "--file",
        action="append",
        default=[],
        metavar="PATH",
        help="Text file containing one absolute URL per line.",
    )
    parser.add_argument(
        "--from-backfill-report",
        action="append",
        default=[],
        metavar="PATH",
        help="Complete or partial backfill CSV report to expand into pill/medication-guide/professional-information URLs.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        metavar="N",
        help=f"Maximum URLs per IndexNow request (default: {DEFAULT_BATCH_SIZE}).",
    )
    parser.add_argument(
        "--ignore-errors",
        action="store_true",
        default=False,
        help="Log IndexNow failures but exit successfully.",
    )
    args = parser.parse_args(argv)

    if not args.url and not args.file and not args.from_backfill_report:
        parser.error("Provide at least one --url, --file, or --from-backfill-report input.")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    try:
        config = load_indexnow_config()
        urls = list(args.url)
        for file_path in args.file:
            urls.extend(read_urls_from_file(Path(file_path)))
        for report_path in args.from_backfill_report:
            urls.extend(expand_backfill_report_urls(Path(report_path), config))

        result = submit_indexnow_urls(
            urls,
            config=config,
            batch_size=args.batch_size,
            ignore_errors=args.ignore_errors,
        )
        logger.info(
            "IndexNow summary: eligible=%d submitted=%d skipped=%d failed_batches=%d",
            result.total_urls,
            result.submitted_urls,
            result.skipped_urls,
            result.failed_batches,
        )
        return 0
    except (FileNotFoundError, IndexNowSubmissionError) as exc:
        logger.error("IndexNow submission failed: %s", exc)
        return 0 if args.ignore_errors else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
