"""Drug indications service — fetches FDA "Indications and Usage" text from openFDA
and stores it in the drug_indications table.

Functions
---------
fetch_indications_from_openfda(drug_name) -> dict | None
upsert_indication(conn, drug_name_key, payload, *, source) -> str
    Returns one of: 'inserted' | 'updated' | 'skipped_manual'
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
    escaped_name = drug_name.replace('"', '\\"')
    params = {
        "search": f'openfda.generic_name:"{escaped_name}"',
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
    """Upsert one row into drug_indications atomically.

    The manual-override guard is enforced in SQL so there is no race window:
    the ``ON CONFLICT ... DO UPDATE ... WHERE source <> 'manual'`` clause
    prevents overwriting manual rows even under concurrent writes.

    Returns one of ``'inserted'``, ``'updated'``, or ``'skipped_manual'``.
    """
    result = conn.execute(
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
            WHERE drug_indications.source <> 'manual'
            RETURNING id, (xmax = 0) AS was_inserted
            """
        ),
        {
            "key": drug_name_key,
            "generic_name": payload.get("generic_name"),
            "pharm_class": payload.get("pharm_class"),
            "indications_text": payload.get("indications_text"),
            "source": source,
        },
    ).fetchone()

    if result is None:
        # ON CONFLICT DO UPDATE WHERE condition was false — manual override row
        logger.info("drug_indications: skipping %r — manual override in place", drug_name_key)
        return "skipped_manual"

    return "inserted" if result[1] else "updated"


def upsert_from_medlineplus(conn, rxcui: str, payload: dict) -> str:
    """Upsert a drug_indications row keyed by rxcui.

    Behavior:
    - If row exists with source='manual': SKIP (return 'skipped_manual'). User edits win.
      This is enforced atomically in SQL via ``WHERE source <> 'manual'`` so concurrent
      flips to 'manual' can never be overwritten.
    - Otherwise: INSERT or UPDATE plain_text, source_url, source='medlineplus',
      fetched_at=NOW(), generic_name=payload['title'].
    - drug_name_key is a NOT NULL UNIQUE column. For NEW rows it is set to
      lower(payload['title']). For existing rows matched by drug_name_key it is not
      changed (already set).
    - If a row already exists with that drug_name_key but a DIFFERENT rxcui,
      log and return 'skipped_collision'.

    Returns: 'inserted' | 'updated' | 'skipped_manual' | 'skipped_collision'
    """
    drug_name_key = payload["title"].lower()

    # 1. Check for existing row by rxcui
    row = conn.execute(
        text("SELECT id, source FROM drug_indications WHERE rxcui = :rxcui"),
        {"rxcui": rxcui},
    ).fetchone()

    if row is not None:
        row_id = row[0]
        # Enforce manual-override guard atomically in SQL: only update when
        # source <> 'manual'.  If 0 rows updated, the row was manual-protected.
        result = conn.execute(
            text(
                """
                UPDATE drug_indications
                SET plain_text   = :plain_text,
                    source_url   = :source_url,
                    source       = 'medlineplus',
                    fetched_at   = NOW(),
                    generic_name = :generic_name
                WHERE id = :id
                  AND source <> 'manual'
                """
            ),
            {
                "plain_text": payload["plain_text"],
                "source_url": payload["source_url"],
                "generic_name": payload["title"],
                "id": row_id,
            },
        )
        if result.rowcount == 0:
            logger.info(
                "drug_indications: skipping rxcui=%s — manual override in place", rxcui
            )
            return "skipped_manual"
        return "updated"

    # 2. No rxcui match — check for existing row by drug_name_key (collision guard)
    name_row = conn.execute(
        text(
            "SELECT id, source, rxcui FROM drug_indications WHERE drug_name_key = :key"
        ),
        {"key": drug_name_key},
    ).fetchone()

    if name_row is not None:
        existing_id, existing_source, existing_rxcui = (
            name_row[0],
            name_row[1],
            name_row[2],
        )
        if existing_rxcui is not None and existing_rxcui != rxcui:
            logger.warning(
                "drug_indications: rxcui collision for drug_name_key=%s "
                "(existing rxcui=%s, new rxcui=%s) — skipping",
                drug_name_key,
                existing_rxcui,
                rxcui,
            )
            return "skipped_collision"
        # Existing row has this drug_name_key but no rxcui (or same rxcui) — update it.
        # Guard against concurrent manual flip atomically.
        result = conn.execute(
            text(
                """
                UPDATE drug_indications
                SET rxcui        = :rxcui,
                    plain_text   = :plain_text,
                    source_url   = :source_url,
                    source       = 'medlineplus',
                    fetched_at   = NOW(),
                    generic_name = :generic_name
                WHERE id = :id
                  AND source <> 'manual'
                """
            ),
            {
                "rxcui": rxcui,
                "plain_text": payload["plain_text"],
                "source_url": payload["source_url"],
                "generic_name": payload["title"],
                "id": existing_id,
            },
        )
        if result.rowcount == 0:
            logger.info(
                "drug_indications: skipping rxcui=%s — manual override on drug_name_key=%s",
                rxcui,
                drug_name_key,
            )
            return "skipped_manual"
        return "updated"

    # 3. No existing row — INSERT new
    conn.execute(
        text(
            """
            INSERT INTO drug_indications
                (drug_name_key, rxcui, generic_name, plain_text, source_url,
                 source, fetched_at)
            VALUES
                (:drug_name_key, :rxcui, :generic_name, :plain_text, :source_url,
                 'medlineplus', NOW())
            """
        ),
        {
            "drug_name_key": drug_name_key,
            "rxcui": rxcui,
            "generic_name": payload["title"],
            "plain_text": payload["plain_text"],
            "source_url": payload["source_url"],
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
