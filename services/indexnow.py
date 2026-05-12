"""Helpers for IndexNow key configuration and URL submission."""

from __future__ import annotations

import csv
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence
from urllib.parse import quote, urlsplit

import requests

logger = logging.getLogger(__name__)

INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
DEFAULT_BATCH_SIZE = 1000
SUPPORTED_BACKFILL_REPORT_TYPES = frozenset({"complete", "partial"})
PILL_PAGE_SUFFIXES = ("", "/medication-guide", "/professional-information")


class IndexNowSubmissionError(RuntimeError):
    """Raised when IndexNow configuration or submission fails."""


@dataclass(frozen=True)
class IndexNowConfig:
    key: str
    key_location: str
    site_url: str
    host: str


@dataclass(frozen=True)
class IndexNowSubmissionResult:
    total_urls: int
    submitted_urls: int
    skipped_urls: int
    batches_attempted: int
    batches_succeeded: int
    failed_batches: int


def _normalize_site_url(value: str) -> str:
    site_url = value.strip().rstrip("/")
    parsed = urlsplit(site_url)
    if not parsed.scheme or not parsed.netloc:
        raise IndexNowSubmissionError("SITE_URL must be an absolute URL")
    if parsed.query or parsed.fragment:
        raise IndexNowSubmissionError("SITE_URL must not include query strings or fragments")
    return site_url


def load_indexnow_config(env: Mapping[str, str] | None = None) -> IndexNowConfig:
    env_map = os.environ if env is None else env
    key = (env_map.get("INDEXNOW_KEY") or "").strip()
    if not key:
        raise IndexNowSubmissionError("INDEXNOW_KEY environment variable is not set")

    site_url = _normalize_site_url(
        (env_map.get("SITE_URL") or env_map.get("NEXT_PUBLIC_SITE_URL") or "https://pillseek.com")
    )
    key_location = (env_map.get("INDEXNOW_KEY_LOCATION") or "").strip() or f"{site_url}/{key}.txt"
    key_location = key_location.strip()
    parsed_key_location = urlsplit(key_location)
    if not parsed_key_location.scheme or not parsed_key_location.netloc:
        raise IndexNowSubmissionError("INDEXNOW_KEY_LOCATION must be an absolute URL")

    host = urlsplit(site_url).netloc
    return IndexNowConfig(
        key=key,
        key_location=key_location,
        site_url=site_url,
        host=host,
    )


def dedupe_urls(urls: Iterable[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for raw_url in urls:
        url = str(raw_url).strip()
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def _is_url_under_site(url: str, config: IndexNowConfig) -> bool:
    parsed_url = urlsplit(url)
    parsed_site = urlsplit(config.site_url)
    if not parsed_url.scheme or not parsed_url.netloc:
        return False
    if parsed_url.netloc != parsed_site.netloc:
        return False

    base_path = parsed_site.path.rstrip("/")
    if not base_path:
        return True

    path = parsed_url.path.rstrip("/")
    return path == base_path or path.startswith(f"{base_path}/")


def filter_indexnow_urls(urls: Iterable[str], config: IndexNowConfig) -> tuple[list[str], list[str]]:
    allowed: list[str] = []
    skipped: list[str] = []
    for url in dedupe_urls(urls):
        if _is_url_under_site(url, config):
            allowed.append(url)
        else:
            skipped.append(url)
    return allowed, skipped


def build_indexnow_payload(config: IndexNowConfig, urls: Sequence[str]) -> dict[str, object]:
    url_list = dedupe_urls(urls)
    return {
        "host": config.host,
        "key": config.key,
        "keyLocation": config.key_location,
        "urlList": url_list,
    }


def read_urls_from_file(path: str | Path) -> list[str]:
    file_path = Path(path)
    urls: list[str] = []
    with file_path.open(encoding="utf-8") as handle:
        for line in handle:
            value = line.strip()
            if not value or value.startswith("#"):
                continue
            urls.append(value)
    return urls


def _backfill_report_type(path: Path) -> str:
    return path.name.split("-", 1)[0].lower()


def expand_backfill_report_urls(path: str | Path, config: IndexNowConfig) -> list[str]:
    report_path = Path(path)
    report_type = _backfill_report_type(report_path)
    if report_type not in SUPPORTED_BACKFILL_REPORT_TYPES:
        logger.info("Skipping unsupported backfill report for IndexNow: %s", report_path)
        return []

    urls: list[str] = []
    with report_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            slug = (row.get("slug") or "").strip()
            if not slug:
                continue
            encoded_slug = quote(slug, safe="")
            pill_base = f"{config.site_url}/pill/{encoded_slug}"
            for suffix in PILL_PAGE_SUFFIXES:
                urls.append(f"{pill_base}{suffix}")
    return urls


def _iter_batches(urls: Sequence[str], batch_size: int) -> Iterable[list[str]]:
    for start in range(0, len(urls), batch_size):
        yield list(urls[start : start + batch_size])


def submit_indexnow_urls(
    urls: Iterable[str],
    *,
    config: IndexNowConfig | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    ignore_errors: bool = False,
    endpoint: str = INDEXNOW_ENDPOINT,
) -> IndexNowSubmissionResult:
    if batch_size <= 0:
        raise IndexNowSubmissionError("batch_size must be greater than 0")

    indexnow_config = config or load_indexnow_config()
    allowed_urls, skipped_urls = filter_indexnow_urls(urls, indexnow_config)

    if skipped_urls:
        logger.warning(
            "Skipping %d URL(s) outside configured SITE_URL host %s",
            len(skipped_urls),
            indexnow_config.host,
        )

    if not allowed_urls:
        logger.info("No eligible URLs to submit to IndexNow")
        return IndexNowSubmissionResult(
            total_urls=0,
            submitted_urls=0,
            skipped_urls=len(skipped_urls),
            batches_attempted=0,
            batches_succeeded=0,
            failed_batches=0,
        )

    batches_attempted = 0
    batches_succeeded = 0
    failed_batches = 0
    submitted_urls = 0
    errors: list[str] = []

    for batch in _iter_batches(allowed_urls, batch_size):
        batches_attempted += 1
        payload = build_indexnow_payload(indexnow_config, batch)
        try:
            response = requests.post(endpoint, json=payload, timeout=30)
        except requests.RequestException as exc:
            failed_batches += 1
            message = f"IndexNow request failed for batch {batches_attempted}: {exc}"
            logger.error(message)
            errors.append(message)
            continue

        if 200 <= response.status_code < 300:
            batches_succeeded += 1
            submitted_urls += len(batch)
            logger.info(
                "Submitted %d URL(s) to IndexNow (batch %d/%d, status=%d)",
                len(batch),
                batches_attempted,
                (len(allowed_urls) + batch_size - 1) // batch_size,
                response.status_code,
            )
            continue

        failed_batches += 1
        response_text = response.text.strip()
        message = (
            f"IndexNow rejected batch {batches_attempted} with status {response.status_code}: {response_text or '<empty>'}"
        )
        logger.error(message)
        errors.append(message)

    if errors and not ignore_errors:
        raise IndexNowSubmissionError("; ".join(errors))

    return IndexNowSubmissionResult(
        total_urls=len(allowed_urls),
        submitted_urls=submitted_urls,
        skipped_urls=len(skipped_urls),
        batches_attempted=batches_attempted,
        batches_succeeded=batches_succeeded,
        failed_batches=failed_batches,
    )


def submit_indexnow_urls_from_backfill_reports(
    report_paths: Sequence[str | Path],
    *,
    config: IndexNowConfig | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    ignore_errors: bool = False,
    endpoint: str = INDEXNOW_ENDPOINT,
) -> IndexNowSubmissionResult:
    indexnow_config = config or load_indexnow_config()
    urls: list[str] = []
    for report_path in report_paths:
        urls.extend(expand_backfill_report_urls(report_path, indexnow_config))
    return submit_indexnow_urls(
        urls,
        config=indexnow_config,
        batch_size=batch_size,
        ignore_errors=ignore_errors,
        endpoint=endpoint,
    )
