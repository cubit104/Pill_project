"""MedlinePlus Connect client — patient-friendly drug info from NIH/NLM.

Free public API. No key. Be polite (small sleep between requests in callers).
Docs: https://medlineplus.gov/connect/overview.html
"""

import logging
import re
import time
from typing import Optional
from urllib.parse import urlparse, urlunparse

import requests

logger = logging.getLogger(__name__)

MEDLINEPLUS_URL = "https://connect.medlineplus.gov/service"
_CODE_SYSTEM = "2.16.840.1.113883.6.88"
_MAX_RETRIES = 2
_RETRY_BACKOFF_S = 1.0


def fetch_by_rxcui(rxcui: str, timeout: int = 10) -> Optional[dict]:
    """Fetch MedlinePlus drug info by RxCUI.

    Returns:
        {
            "rxcui": str,           # echo of input
            "title": str,           # e.g. "Lisinopril"
            "plain_text": str,      # cleaned summary text
            "source_url": str,      # link to medlineplus.gov page
        }
    or None if no MedlinePlus entry exists for this rxcui.

    Implementation:
    - GET https://connect.medlineplus.gov/service?
        mainSearchCriteria.v.cs=2.16.840.1.113883.6.88
        &mainSearchCriteria.v.c={rxcui}
        &knowledgeResponseType=application/json
    - Parse feed.entry[0]. If missing, return None.
    - Extract:
        title       = entry.title._value
        plain_text  = entry.summary._value (clean: collapse whitespace, strip HTML if any)
        source_url  = entry.link[0].href  (strip ?utm_source=... params for cleanliness)
    - Retry 2x with 1s backoff on transient errors (timeout, 5xx).
    - Return None on 404 / empty / malformed; never raise to caller.
    """
    params = {
        "mainSearchCriteria.v.cs": _CODE_SYSTEM,
        "mainSearchCriteria.v.c": rxcui,
        "knowledgeResponseType": "application/json",
    }

    data = None
    last_exc = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = requests.get(MEDLINEPLUS_URL, params=params, timeout=timeout)
            if resp.status_code == 404:
                logger.debug("MedlinePlus: 404 for rxcui=%s", rxcui)
                return None
            resp.raise_for_status()
            data = resp.json()
            break
        except requests.exceptions.HTTPError as exc:
            last_exc = exc
            logger.warning("MedlinePlus HTTP error (attempt %d): %s", attempt + 1, exc)
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            logger.warning("MedlinePlus request error (attempt %d): %s", attempt + 1, exc)
        if attempt < _MAX_RETRIES:
            time.sleep(_RETRY_BACKOFF_S)

    if data is None:
        if last_exc:
            logger.error(
                "MedlinePlus fetch failed after %d attempts for rxcui=%s: %s",
                _MAX_RETRIES + 1, rxcui, last_exc,
            )
        return None

    try:
        entries = (data.get("feed") or {}).get("entry") or []
        if not entries:
            logger.debug("MedlinePlus: no entries for rxcui=%s", rxcui)
            return None

        entry = entries[0]

        title = ((entry.get("title") or {}).get("_value") or "").strip()
        if not title:
            return None

        summary_val = ((entry.get("summary") or {}).get("_value") or "")
        plain_text = _clean_text(summary_val)
        if not plain_text:
            return None

        # Extract source_url — first link with an href
        links = entry.get("link") or []
        source_url = ""
        for link in links:
            if isinstance(link, dict):
                href = link.get("href") or ""
                if href:
                    source_url = _strip_utm(href)
                    break

        return {
            "rxcui": rxcui,
            "title": title,
            "plain_text": plain_text,
            "source_url": source_url,
        }
    except Exception as exc:
        logger.error(
            "MedlinePlus: failed to parse response for rxcui=%s: %s", rxcui, exc
        )
        return None


def _strip_utm(url: str) -> str:
    """Remove query parameters (UTM/tracking) from a URL."""
    parsed = urlparse(url)
    return urlunparse(parsed._replace(query=""))


def _clean_text(s: str) -> str:
    """Collapse whitespace, strip basic HTML tags, trim."""
    if not s:
        return ""
    # Strip HTML tags
    cleaned = re.sub(r"<[^>]+>", " ", s)
    # Collapse whitespace and newlines
    cleaned = re.sub(r"[\r\n\t]+", " ", cleaned)
    cleaned = re.sub(r" {2,}", " ", cleaned)
    return cleaned.strip()
