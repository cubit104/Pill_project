"""Best-effort IndexNow helpers for admin pill publish/update flows."""

from __future__ import annotations

import logging

from services.indexnow import (
    IndexNowSubmissionError,
    build_pill_page_urls,
    load_indexnow_config,
    submit_indexnow_urls,
)

logger = logging.getLogger(__name__)


def submit_pill_slug_to_indexnow(slug: str) -> None:
    normalized_slug = (slug or "").strip()
    if not normalized_slug:
        logger.info("Skipping IndexNow submission for pill with empty slug")
        return

    try:
        config = load_indexnow_config()
    except IndexNowSubmissionError as exc:
        logger.info("Skipping IndexNow submission for slug=%s: %s", normalized_slug, exc)
        return

    try:
        urls = build_pill_page_urls(normalized_slug, config)
        result = submit_indexnow_urls(
            urls,
            config=config,
            ignore_errors=True,
        )
        logger.info(
            "IndexNow summary for slug=%s: eligible=%d submitted=%d skipped=%d failed_batches=%d",
            normalized_slug,
            result.total_urls,
            result.submitted_urls,
            result.skipped_urls,
            result.failed_batches,
        )
    except IndexNowSubmissionError as exc:
        logger.warning("IndexNow submission failed for slug=%s: %s", normalized_slug, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("IndexNow submission failed for slug=%s: %s", normalized_slug, exc, exc_info=True)
