"""Drug indications service — fetches FDA "Indications and Usage" text from openFDA
and stores it in the drug_indications table.

Functions
---------
fetch_indications_from_openfda(drug_name) -> dict | None   [deprecated — use resolve_and_fetch]
fetch_indications_by_rxcui(rxcui) -> dict | None
resolve_and_fetch(drug_name) -> dict | None
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

from services.rxnorm import find_ingredient_rxcui

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

    .. deprecated::
        Use :func:`resolve_and_fetch` for new code. This function performs a
        loose name search and may match combo-drug labels (e.g. searching
        "lisinopril" can return "LISINOPRIL AND HYDROCHLOROTHIAZIDE").

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


def fetch_indications_by_rxcui(rxcui: str) -> Optional[dict]:
    """Query openFDA by RxCUI for an unambiguous single-ingredient match.

    Endpoint: ``drug/label.json?search=openfda.rxcui:"{rxcui}"&limit=5``

    Picks the result whose ``openfda.generic_name`` array contains exactly one
    name (single-ingredient drug) when possible.  If only multi-ingredient
    results exist, prefers the one with the shortest generic_name.

    Returns
    -------
    dict with keys ``generic_name``, ``pharm_class``, ``indications_text``,
    ``rxcui`` or ``None``.
    """
    if not rxcui or not str(rxcui).strip():
        return None

    escaped = str(rxcui).strip().replace('"', '\\"')
    params = {
        "search": f'openfda.rxcui:"{escaped}"',
        "limit": 5,
    }

    data = None
    last_exc = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = requests.get(OPENFDA_LABEL_URL, params=params, timeout=15)
            if resp.status_code == 404:
                logger.debug("openFDA: 404 for rxcui %r", rxcui)
                return None
            resp.raise_for_status()
            data = resp.json()
            break
        except requests.exceptions.HTTPError as exc:
            last_exc = exc
            logger.warning("openFDA HTTP error (attempt %d): %s", attempt + 1, exc)
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            logger.warning("openFDA request error (attempt %d): %s", attempt + 1, exc)
        if attempt < _MAX_RETRIES:
            time.sleep(_RETRY_BACKOFF_S)

    if data is None:
        if last_exc:
            logger.error(
                "openFDA fetch failed after %d attempts: %s", _MAX_RETRIES + 1, last_exc
            )
        return None

    results = data.get("results") or []
    if not results:
        logger.debug("openFDA: empty results for rxcui %r", rxcui)
        return None

    # Prefer results where generic_name is a single ingredient (no "AND" / "/" combos).
    # In openFDA, multi-ingredient labels can appear as either:
    #   - one entry: ["LISINOPRIL AND HYDROCHLOROTHIAZIDE"]
    #   - two entries: ["LISINOPRIL", "HYDROCHLOROTHIAZIDE"]
    # We detect both cases.
    def _is_single(result: dict) -> bool:
        names = (result.get("openfda") or {}).get("generic_name") or []
        if len(names) != 1:
            return False
        name_upper = names[0].upper()
        return " AND " not in name_upper and "/" not in name_upper

    single = [r for r in results if _is_single(r)]
    # Fall back to shortest generic_name when all results are multi-ingredient.
    # If a result has no generic_name, its sort key is 0 (empty string length),
    # which is intentional — it won't beat a real single-ingredient match.
    hit = single[0] if single else min(
        results,
        key=lambda r: len(((r.get("openfda") or {}).get("generic_name") or [""])[0]),
    )

    return _extract_label_fields(hit, rxcui=rxcui)


def resolve_and_fetch(drug_name: str) -> Optional[dict]:
    """Full resolution chain for the backfill script.

    name → ingredient RxCUI (via RxNav) → openFDA label by RxCUI.

    Returns a dict ready for upsert::

        {
            "drug_name_key": "lisinopril",
            "rxcui": "29046",
            "rxcui_name": "lisinopril",
            "generic_name": "LISINOPRIL",
            "pharm_class": "Angiotensin Converting Enzyme Inhibitor [EPC]",
            "indications_text": "Lisinopril is indicated for...",
        }

    Returns ``None`` if any step fails.
    """
    if not drug_name or not drug_name.strip():
        return None

    key = drug_name.strip().lower()

    rxcui_info = find_ingredient_rxcui(key)
    if rxcui_info is None:
        logger.warning("resolve_and_fetch: RxNav could not resolve %r", key)
        return None

    rxcui = rxcui_info["rxcui"]
    rxcui_name = rxcui_info["name"]

    label = fetch_indications_by_rxcui(rxcui)
    if label is None:
        logger.warning(
            "resolve_and_fetch: no FDA label for %r (rxcui %s)", key, rxcui
        )
        return None

    return {
        "drug_name_key": key,
        "rxcui": rxcui,
        "rxcui_name": rxcui_name,
        "generic_name": label.get("generic_name"),
        "pharm_class": label.get("pharm_class"),
        "indications_text": label.get("indications_text"),
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

    Accepts optional ``rxcui`` and ``rxcui_name`` keys in *payload*.

    Returns one of ``'inserted'``, ``'updated'``, or ``'skipped_manual'``.
    """
    result = conn.execute(
        text(
            """
            INSERT INTO drug_indications
                (drug_name_key, generic_name, pharm_class, indications_text,
                 rxcui, rxcui_name, source, fetched_at)
            VALUES
                (:key, :generic_name, :pharm_class, :indications_text,
                 :rxcui, :rxcui_name, :source, NOW())
            ON CONFLICT (drug_name_key) DO UPDATE
            SET generic_name     = EXCLUDED.generic_name,
                pharm_class      = EXCLUDED.pharm_class,
                indications_text = EXCLUDED.indications_text,
                rxcui            = EXCLUDED.rxcui,
                rxcui_name       = EXCLUDED.rxcui_name,
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
            "rxcui": payload.get("rxcui"),
            "rxcui_name": payload.get("rxcui_name"),
            "source": source,
        },
    ).fetchone()

    if result is None:
        # ON CONFLICT DO UPDATE WHERE condition was false — manual override row
        logger.info("drug_indications: skipping %r — manual override in place", drug_name_key)
        return "skipped_manual"

    return "inserted" if result[1] else "updated"


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


def _extract_label_fields(hit: dict, *, rxcui: Optional[str] = None) -> dict:
    """Extract generic_name, pharm_class, and indications_text from an openFDA label result."""
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

    result: dict = {
        "generic_name": generic_name,
        "pharm_class": pharm_class,
        "indications_text": indications_text or None,
    }
    if rxcui is not None:
        result["rxcui"] = rxcui
    return result
