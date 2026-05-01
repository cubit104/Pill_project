"""RxNorm / RxNav API client for resolving drug names to canonical RxCUIs.

RxNav is the NIH/NLM REST API: https://rxnav.nlm.nih.gov/RxNormAPIs.html
No API key needed. Be polite (small sleep between requests in callers).
"""

import logging
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST"
_MAX_RETRIES = 2
_RETRY_BACKOFF_S = 1.0


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _get(url: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET *url* with retry/backoff. Returns parsed JSON or None on failure."""
    last_exc = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code == 404:
                logger.debug("RxNav 404: %s", url)
                return None
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.HTTPError as exc:
            last_exc = exc
            logger.warning("RxNav HTTP error (attempt %d): %s", attempt + 1, exc)
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            logger.warning("RxNav request error (attempt %d): %s", attempt + 1, exc)
        if attempt < _MAX_RETRIES:
            time.sleep(_RETRY_BACKOFF_S)
    logger.error("RxNav fetch failed after %d attempts: %s", _MAX_RETRIES + 1, last_exc)
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def find_ingredient_rxcui(drug_name: str) -> Optional[dict]:
    """Resolve a drug name (e.g. 'lisinopril') to its INGREDIENT RxCUI.

    Returns ``{'rxcui': '29046', 'name': 'lisinopril'}`` or ``None``.

    Steps:
    1. GET rxcui.json?name={drug_name}&search=2  (approximate match).
    2. Take the first RxCUI from ``idGroup.rxnormId``.
    3. GET rxcui/{rxcui}/related.json?tty=IN to resolve to ingredient level.
    4. Return the ingredient RxCUI + name.

    If the drug name already maps to an ingredient (TTY=IN), step 3 returns
    itself — this is handled gracefully.

    Errors / not-found → return None, do not raise.
    """
    if not drug_name or not drug_name.strip():
        return None

    # Step 1: resolve name to any RxCUI
    data = _get(f"{_RXNAV_BASE}/rxcui.json", params={"name": drug_name.strip(), "search": 2})
    if data is None:
        return None

    rxnorm_ids = (data.get("idGroup") or {}).get("rxnormId") or []
    if not rxnorm_ids:
        logger.debug("RxNav: no RxCUI found for %r", drug_name)
        return None

    rxcui = rxnorm_ids[0]

    # Step 2: short sleep between the two RxNav calls (be polite)
    time.sleep(0.1)

    # Step 3: resolve to ingredient TTY=IN
    related = _get(f"{_RXNAV_BASE}/rxcui/{rxcui}/related.json", params={"tty": "IN"})
    if related is None:
        return None

    concept_group = (related.get("relatedGroup") or {}).get("conceptGroup") or []
    for group in concept_group:
        if group.get("tty") != "IN":
            continue
        concepts = group.get("conceptProperties") or []
        if concepts:
            ing = concepts[0]
            return {"rxcui": str(ing.get("rxcui", "")), "name": ing.get("name", "")}

    # Drug was already an ingredient — fall back to the original RxCUI
    # by querying its properties directly
    props = _get(f"{_RXNAV_BASE}/rxcui/{rxcui}/properties.json")
    if props:
        prop = (props.get("properties") or {})
        name = prop.get("name", "")
        return {"rxcui": str(rxcui), "name": name}

    return None


def find_rxcui_by_ndc(ndc: str) -> Optional[str]:
    """Resolve an NDC to an RxCUI.

    The NDC is normalised to 11-digit no-dash format before the lookup.
    Uses the project's ``ndc_normalize.normalize_ndc_to_11`` helper when
    available; falls back to stripping non-digit characters otherwise.

    Returns the RxCUI string or ``None``.

    Endpoint: ``GET /rxcui.json?idtype=NDC&id={ndc11_nodash}``
    """
    if not ndc or not isinstance(ndc, str):
        return None

    # Normalise NDC to 11-digit no-dash form
    ndc_nodash: Optional[str] = None
    try:
        from ndc_normalize import normalize_ndc_to_11

        ndc11 = normalize_ndc_to_11(ndc)
        if ndc11:
            ndc_nodash = ndc11.replace("-", "")
    except ImportError:
        pass

    if ndc_nodash is None:
        # Strip non-digit characters as a fallback
        import re
        digits = re.sub(r"\D", "", ndc)
        if len(digits) == 11:
            ndc_nodash = digits
        elif len(digits) == 10:
            # Pad to 11 digits (ambiguous — try as-is for RxNav)
            ndc_nodash = digits
        else:
            logger.debug("RxNav: cannot normalise NDC %r", ndc)
            return None

    data = _get(
        f"{_RXNAV_BASE}/rxcui.json",
        params={"idtype": "NDC", "id": ndc_nodash},
    )
    if data is None:
        return None

    rxnorm_ids = (data.get("idGroup") or {}).get("rxnormId") or []
    if not rxnorm_ids:
        logger.debug("RxNav: no RxCUI found for NDC %r", ndc)
        return None

    return str(rxnorm_ids[0])
