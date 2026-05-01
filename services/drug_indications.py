"""Drug indications service — fetches FDA "Indications and Usage" text from openFDA
and stores it in the drug_indications table.

Functions
---------
fetch_indications_from_openfda(drug_name) -> dict | None
upsert_indication(conn, drug_name_key, payload, *, source) -> None
truncate_indication(text, limit) -> str
"""

import logging
import re
import time
from typing import Optional

import requests
from sqlalchemy import text

logger = logging.getLogger(__name__)

OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
_MAX_RETRIES = 2
_RETRY_BACKOFF_S = 1.0


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def truncate_indication(text: str, limit: int = 300) -> str:
    """Return *text* truncated to *limit* characters, preferring a sentence
    boundary after character 150, then a word boundary, then a hard cut."""
    if not text or len(text) <= limit:
        return text or ""
    truncated = text[:limit]
    last_period = truncated.rfind('.')
    if last_period > 150:
        return truncated[:last_period + 1]
    last_space = truncated.rfind(' ')
    if last_space > 150:
        return truncated[:last_space] + '\u2026'
    return truncated + '\u2026'


def fetch_indications_from_openfda(drug_name: str) -> Optional[dict]:
    """Query openFDA drug label API for *drug_name* and return a cleaned dict.

    Returns
    -------
    dict with keys ``generic_name``, ``pharm_class``, ``indications_text``
    or ``None`` if the drug is not found / the response is empty.
    """
    params = {
        "search": f'openfda.generic_name:"{drug_name}"',
        "limit": 1,
    }

    data = None
    last_exc = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = requests.get(OPENFDA_LABEL_URL, params=params, timeout=15)
            if resp.status_code == 404:
                logger.debug("openFDA: 404 for %r", drug_name)
                return None
            resp.raise_for_status()
            data = resp.json()
            break
        except requests.exceptions.HTTPError as exc:
            # Non-404 HTTP errors — retry
            last_exc = exc
            logger.warning("openFDA HTTP error (attempt %d): %s", attempt + 1, exc)
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            logger.warning("openFDA request error (attempt %d): %s", attempt + 1, exc)
        if attempt < _MAX_RETRIES:
            time.sleep(_RETRY_BACKOFF_S)

    if data is None:
        if last_exc:
            logger.error("openFDA fetch failed after %d attempts: %s", _MAX_RETRIES + 1, last_exc)
        return None

    results = data.get("results") or []
    if not results:
        logger.debug("openFDA: empty results for %r", drug_name)
        return None

    hit = results[0]

    # --- generic_name ---
    generic_raw = hit.get("openfda", {}).get("generic_name") or []
    generic_name: Optional[str] = None
    if isinstance(generic_raw, list) and generic_raw:
        generic_name = generic_raw[0].strip()
    elif isinstance(generic_raw, str):
        generic_name = generic_raw.strip() or None

    # --- pharm_class ---
    pharm_raw = hit.get("openfda", {}).get("pharm_class_epc") or []
    pharm_class: Optional[str] = None
    if isinstance(pharm_raw, list) and pharm_raw:
        pharm_class = pharm_raw[0].strip()
    elif isinstance(pharm_raw, str):
        pharm_class = pharm_raw.strip() or None

    # --- indications_text ---
    ind_raw = hit.get("indications_and_usage") or []
    indications_text: Optional[str] = None
    if isinstance(ind_raw, list) and ind_raw:
        indications_text = ind_raw[0]
    elif isinstance(ind_raw, str):
        indications_text = ind_raw

    if indications_text:
        indications_text = _clean_text(indications_text)

    return {
        "generic_name": generic_name,
        "pharm_class": pharm_class,
        "indications_text": indications_text or None,
    }


def upsert_indication(
    conn,
    drug_name_key: str,
    payload: dict,
    *,
    source: str = "openfda",
) -> str:
    """Upsert one row into drug_indications.

    If an existing row has ``source='manual'``, the update is skipped and
    ``'skipped_manual'`` is returned.  Otherwise returns ``'inserted'`` or
    ``'updated'``.
    """
    # Check whether a manual-override row already exists
    existing = conn.execute(
        text("SELECT source FROM drug_indications WHERE drug_name_key = :key"),
        {"key": drug_name_key},
    ).fetchone()

    if existing and existing[0] == "manual":
        logger.info("drug_indications: skipping %r — manual override in place", drug_name_key)
        return "skipped_manual"

    now_sql = "NOW()"
    if existing:
        conn.execute(
            text(
                """
                UPDATE drug_indications
                SET generic_name     = :generic_name,
                    pharm_class      = :pharm_class,
                    indications_text = :indications_text,
                    fetched_at       = NOW(),
                    source           = :source
                WHERE drug_name_key = :key
                """
            ),
            {
                "generic_name": payload.get("generic_name"),
                "pharm_class": payload.get("pharm_class"),
                "indications_text": payload.get("indications_text"),
                "source": source,
                "key": drug_name_key,
            },
        )
        return "updated"
    else:
        conn.execute(
            text(
                """
                INSERT INTO drug_indications
                    (drug_name_key, generic_name, pharm_class, indications_text, source, fetched_at)
                VALUES
                    (:key, :generic_name, :pharm_class, :indications_text, :source, NOW())
                ON CONFLICT (drug_name_key) DO UPDATE
                SET generic_name     = EXCLUDED.generic_name,
                    pharm_class      = EXCLUDED.pharm_class,
                    indications_text = EXCLUDED.indications_text,
                    fetched_at       = EXCLUDED.fetched_at,
                    source           = EXCLUDED.source
                """
            ),
            {
                "key": drug_name_key,
                "generic_name": payload.get("generic_name"),
                "pharm_class": payload.get("pharm_class"),
                "indications_text": payload.get("indications_text"),
                "source": source,
            },
        )
        return "inserted"


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _clean_text(raw: str) -> str:
    """Strip HTML tags, bullet characters, and collapse whitespace."""
    # Remove HTML tags
    cleaned = re.sub(r'<[^>]+>', ' ', raw)
    # Remove common bullet/list characters
    cleaned = re.sub(r'[•\u2022\u2023\u25E6\u2043\u2219*\-](?=\s)', ' ', cleaned)
    # Collapse whitespace and newlines
    cleaned = re.sub(r'[\r\n\t]+', ' ', cleaned)
    cleaned = re.sub(r' {2,}', ' ', cleaned)
    return cleaned.strip()
