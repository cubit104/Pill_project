"""Core NDC backfill service — shared by the CLI script and admin API endpoints.

Flow per row
------------
1. Try DailyMed (by RxCUI) → collect (ndc, package_description) pairs
2. Fall back to openFDA (by generic_name) if DailyMed returns nothing
3. Normalise every candidate NDC to canonical 11-digit 5-4-2 (HIPAA)
4. Decide outcome:
   - zero candidates       → reason='no_match'
   - exactly one product   → primary = smallest-package NDC, extras stored
   - multiple products     → reason='multiple_matches'
   - exception during API  → reason='api_error'
5. Write to DB in a single transaction (or just log when dry_run=True)
"""

import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import text

import database
from ndc_normalize import normalize_ndc_to_11, ndc11_to_ndc9
from routes.admin.auth import log_audit

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DAILYMED_SPL_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"
DAILYMED_NDC_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}/ndcs.json"
DAILYMED_PACKAGING_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}/packaging.json"
OPENFDA_NDC_URL = "https://api.fda.gov/drug/ndc.json"

SYSTEM_ACTOR_EMAIL = "system:backfill_ndc11"
SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000"

ROW_SELECT_SQL = """
    SELECT id, medicine_name, splimprint, rxcui, ndc9, ndc11
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND (ndc11 IS NULL OR TRIM(ndc11) = '')
    ORDER BY updated_at DESC NULLS LAST
    LIMIT :limit OFFSET :offset
"""

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _fetch(
    url: str,
    params: Optional[Dict] = None,
    timeout: int = 30,
    client: Optional["httpx.Client"] = None,
) -> Optional[Dict]:
    """GET *url* with one retry on 5xx / timeout.  Returns parsed JSON or None.

    If *client* is supplied it is reused (connection pooling); otherwise a
    temporary client is created per call (tests / standalone use).
    """
    _close = client is None
    if _close:
        client = httpx.Client(timeout=timeout)
    try:
        for attempt in range(2):
            try:
                resp = client.get(url, params=params)
                if resp.status_code == 200:
                    return resp.json()
                if resp.status_code >= 500 and attempt == 0:
                    time.sleep(1)
                    continue
                logger.debug("HTTP %s from %s", resp.status_code, url)
                return None
            except (httpx.TimeoutException, httpx.ConnectError, httpx.RequestError) as exc:
                if attempt == 0:
                    time.sleep(1)
                    continue
                logger.warning("HTTP error fetching %s: %s", url, exc)
                return None
    finally:
        if _close:
            client.close()
    return None


# ---------------------------------------------------------------------------
# API fetch functions
# ---------------------------------------------------------------------------


def fetch_dailymed_by_rxcui(rxcui: str, client: Optional["httpx.Client"] = None) -> List[Dict]:
    """Query DailyMed for SPL sets by RxCUI, then pull package-level NDCs per set."""
    data = _fetch(DAILYMED_SPL_URL, params={"rxcui": rxcui, "pagesize": 25}, client=client)
    if not data or "data" not in data:
        return []

    candidates: List[Dict] = []
    for spl in data["data"]:
        setid = spl.get("setid")
        if not setid:
            continue
        pkg_data = _fetch(DAILYMED_PACKAGING_URL.format(setid=setid), client=client)
        if logger.isEnabledFor(logging.DEBUG) and pkg_data:
            entries = pkg_data.get("data", [])
            first_keys = list(entries[0].keys()) if entries and isinstance(entries[0], dict) else None
            logger.debug(
                "DailyMed packaging response for setid=%s: top_keys=%s, entries=%d, first_entry_keys=%s",
                setid, list(pkg_data.keys()), len(entries), first_keys,
            )
        if not pkg_data or "data" not in pkg_data:
            continue
        for entry in pkg_data.get("data", []):
            if isinstance(entry, str):
                ndc_raw = entry
                pkg_desc = ""
            elif isinstance(entry, dict):
                ndc_raw = (
                    entry.get("ndc")
                    or entry.get("package_ndc")
                    or entry.get("ndc_code")
                    or ""
                )
                pkg_desc = (
                    entry.get("package_description")
                    or entry.get("description")
                    or ""
                )
            else:
                continue
            if ndc_raw:
                candidates.append(
                    {
                        "ndc": ndc_raw,
                        "package_description": pkg_desc,
                        "source": "dailymed",
                        "setid": setid,
                    }
                )
    return candidates


def fetch_openfda_by_name(name: str, client: Optional["httpx.Client"] = None) -> List[Dict]:
    """Query openFDA drug/ndc endpoint by generic_name."""
    safe_name = name.replace('"', '\\"')
    params = {"search": f'generic_name:"{safe_name}"', "limit": 25}
    data = _fetch(OPENFDA_NDC_URL, params=params, client=client)
    if not data or "results" not in data:
        return []

    candidates: List[Dict] = []
    for result in data["results"]:
        product_ndc = result.get("product_ndc") or ""
        dosage_form = result.get("dosage_form") or ""
        active_ings = result.get("active_ingredients") or []
        strength = active_ings[0].get("strength", "") if active_ings else ""

        pkgs = result.get("packaging") or []
        if pkgs:
            for pkg in pkgs:
                package_ndc = pkg.get("package_ndc") or ""
                if package_ndc:
                    candidates.append(
                        {
                            "ndc": package_ndc,
                            "package_description": pkg.get("description") or "",
                            "source": "openfda",
                            "dosage_form": dosage_form,
                            "strength": strength,
                        }
                    )
        elif product_ndc:
            candidates.append(
                {
                    "ndc": product_ndc,
                    "package_description": "",
                    "source": "openfda",
                    "dosage_form": dosage_form,
                    "strength": strength,
                }
            )
    return candidates


# ---------------------------------------------------------------------------
# Candidate processing
# ---------------------------------------------------------------------------


def _normalise_candidates(raw: List[Dict]) -> List[Dict]:
    """Return only candidates whose raw NDC successfully normalises to 11 digits."""
    out: List[Dict] = []
    for c in raw:
        ndc11 = normalize_ndc_to_11(c.get("ndc") or "")
        if ndc11:
            out.append({**c, "ndc11": ndc11, "ndc9": ndc11_to_ndc9(ndc11)})
    return out


def _product_key(ndc11: str) -> str:
    """First 9 digits of digit-stripped NDC — labeler (5) + product (4)."""
    digits = ndc11.replace("-", "")
    return digits[:9]


def _package_code(ndc11: str) -> str:
    """Last 2 digits of digit-stripped NDC — the package segment."""
    return ndc11.replace("-", "")[9:]


def _decide(candidates: List[Dict]) -> Tuple[str, Optional[Dict], List[Dict]]:
    """Return (outcome, primary_candidate, extra_candidates).

    outcome is one of: 'updated', 'multiple_matches', 'no_match'

    When a single product is matched, the primary is the package with the
    **smallest** package code (deterministic across API orderings), and the
    rest are extras.
    """
    if not candidates:
        return ("no_match", None, [])

    # Group by product (labeler+product = first 9 digits)
    products: Dict[str, List[Dict]] = {}
    for c in candidates:
        key = _product_key(c["ndc11"])
        products.setdefault(key, []).append(c)

    if len(products) > 1:
        return ("multiple_matches", None, [])

    # Single product — sort by package code (smallest first) for determinism
    all_pkg = sorted(candidates, key=lambda c: _package_code(c["ndc11"]))
    primary = all_pkg[0]
    extras = all_pkg[1:]
    return ("updated", primary, extras)


# ---------------------------------------------------------------------------
# Per-row processing
# ---------------------------------------------------------------------------


def process_pill_row(
    row: Dict,
    match_mode: str = "auto",
    sleep_ms: int = 250,
    client: Optional["httpx.Client"] = None,
) -> Dict:
    """Process one pill row; return outcome dict (never raises)."""
    pill_id = str(row["id"])
    rxcui = row.get("rxcui")
    name = (row.get("medicine_name") or "").strip()
    splimprint = (row.get("splimprint") or "").strip()

    result: Dict[str, Any] = {
        "pill_id": pill_id,
        "medicine_name": name,
        "splimprint": splimprint,
        "outcome": "no_match",
        "chosen_ndc11": None,
        "extras_count": 0,
        "primary_candidate": None,
        "extra_candidates": [],
        "candidates": [],
        "error": None,
    }

    try:
        use_rxcui = match_mode in ("rxcui", "auto") and bool(rxcui)
        use_name = match_mode in ("name", "auto")

        dailymed_raw_count = 0
        openfda_raw_count = 0
        dailymed_norm_count = 0
        openfda_norm_count = 0

        candidates: List[Dict] = []

        if use_rxcui:
            dm_raw = fetch_dailymed_by_rxcui(str(rxcui), client=client)
            dailymed_raw_count = len(dm_raw)
            time.sleep(sleep_ms / 1000)
            dm_norm = _normalise_candidates(dm_raw)
            dailymed_norm_count = len(dm_norm)
            candidates = dm_norm

        # Fall back to openFDA if DailyMed yielded nothing USABLE (after normalization)
        if not candidates and use_name and name:
            of_raw = fetch_openfda_by_name(name, client=client)
            openfda_raw_count = len(of_raw)
            time.sleep(sleep_ms / 1000)
            of_norm = _normalise_candidates(of_raw)
            openfda_norm_count = len(of_norm)
            candidates = of_norm

        result["candidates"] = candidates
        result["source_counts"] = {
            "dailymed_raw": dailymed_raw_count,
            "dailymed_normalized": dailymed_norm_count,
            "openfda_raw": openfda_raw_count,
            "openfda_normalized": openfda_norm_count,
        }

        outcome, primary, extras = _decide(candidates)
        result["outcome"] = outcome

        if outcome == "updated" and primary:
            result["chosen_ndc11"] = primary["ndc11"]
            result["primary_candidate"] = primary
            result["extra_candidates"] = extras
            result["extras_count"] = len(extras)
            if splimprint:
                logger.info(
                    "Pill %s splimprint=%r (not used for matching; review manually)",
                    pill_id,
                    splimprint,
                )

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Error processing pill %s: %s", pill_id, exc, exc_info=True)
        result["outcome"] = "api_error"
        result["error"] = str(exc)

    return result


# ---------------------------------------------------------------------------
# DB write helpers
# ---------------------------------------------------------------------------


def _write_pill_update(
    conn,
    pill_id: str,
    primary: Dict,
    extras: List[Dict],
) -> None:
    """Write NDC data for one pill within an open connection/transaction."""
    ndc11 = primary["ndc11"]
    ndc9_val = ndc11_to_ndc9(ndc11) or ndc11.replace("-", "")[:9]

    # Update pillfinder — only if still empty (safe guard)
    conn.execute(
        text(
            """
            UPDATE pillfinder
               SET ndc11       = :ndc11,
                   ndc9        = :ndc9,
                   updated_at  = now()
             WHERE id = :pill_id
               AND (ndc11 IS NULL OR TRIM(ndc11) = '')
            """
        ),
        {"ndc11": ndc11, "ndc9": ndc9_val, "pill_id": pill_id},
    )

    # Insert primary into pill_ndcs
    conn.execute(
        text(
            """
            INSERT INTO pill_ndcs
                   (pill_id, ndc11, ndc9, package_description, is_primary, source)
            VALUES (:pill_id, :ndc11, :ndc9, :desc, true, :source)
            ON CONFLICT (pill_id, ndc11) DO NOTHING
            """
        ),
        {
            "pill_id": pill_id,
            "ndc11": ndc11,
            "ndc9": ndc9_val,
            "desc": primary.get("package_description") or "",
            "source": primary.get("source") or "dailymed",
        },
    )

    # Insert extras
    for extra in extras:
        extra_ndc9 = ndc11_to_ndc9(extra["ndc11"]) or extra["ndc11"].replace("-", "")[:9]
        conn.execute(
            text(
                """
                INSERT INTO pill_ndcs
                       (pill_id, ndc11, ndc9, package_description, is_primary, source)
                VALUES (:pill_id, :ndc11, :ndc9, :desc, false, :source)
                ON CONFLICT (pill_id, ndc11) DO NOTHING
                """
            ),
            {
                "pill_id": pill_id,
                "ndc11": extra["ndc11"],
                "ndc9": extra_ndc9,
                "desc": extra.get("package_description") or "",
                "source": extra.get("source") or "dailymed",
            },
        )

    # Audit log
    log_audit(
        conn,
        actor_id=SYSTEM_ACTOR_ID,
        actor_email=SYSTEM_ACTOR_EMAIL,
        action="backfill_ndc",
        entity_type="pillfinder",
        entity_id=pill_id,
        diff={"ndc11": ndc11, "ndc9": ndc9_val},
        metadata={
            "source": primary.get("source"),
            "extras_count": len(extras),
        },
    )


def _write_skipped(conn, pill_id: str, reason: str, candidates: List[Dict]) -> None:
    """Upsert a row into ndc_backfill_skipped (idempotent: delete then insert)."""
    params = {
        "pill_id": pill_id,
        "reason": reason,
        "candidates": json.dumps(candidates),
    }
    # Remove any prior record so re-runs don't accumulate stale duplicates
    conn.execute(
        text(
            "DELETE FROM ndc_backfill_skipped WHERE pill_id = :pill_id AND reason = :reason"
        ),
        params,
    )
    conn.execute(
        text(
            """
            INSERT INTO ndc_backfill_skipped (pill_id, reason, candidates)
            VALUES (:pill_id, :reason, CAST(:candidates AS jsonb))
            """
        ),
        params,
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run_backfill(
    limit: int = 10,
    offset: int = 0,
    dry_run: bool = False,
    match_mode: str = "auto",
    sleep_ms: int = 250,
) -> Dict[str, Any]:
    """Run the NDC backfill for up to *limit* rows.

    Returns a summary dict with keys:
        processed, updated, skipped_multi, skipped_none, errors, dry_run, rows
    """
    if not database.db_engine:
        if not database.connect_to_database():
            raise RuntimeError("Database connection not available")

    summary: Dict[str, Any] = {
        "processed": 0,
        "updated": 0,
        "skipped_multi": 0,
        "skipped_none": 0,
        "errors": 0,
        "dry_run": dry_run,
        "rows": [],
    }

    # Fetch candidate rows
    with database.db_engine.connect() as conn:
        rows = conn.execute(
            text(ROW_SELECT_SQL),
            {"limit": limit, "offset": offset},
        ).fetchall()

    pill_rows = [
        dict(zip(["id", "medicine_name", "splimprint", "rxcui", "ndc9", "ndc11"], r))
        for r in rows
    ]

    # Use a single HTTP client for the entire run (connection pooling / keep-alive)
    with httpx.Client(timeout=30) as http_client:
        for row in pill_rows:
            summary["processed"] += 1
            result = process_pill_row(
                row, match_mode=match_mode, sleep_ms=sleep_ms, client=http_client
            )
            outcome = result["outcome"]

            row_summary: Dict[str, Any] = {
                "pill_id": result["pill_id"],
                "medicine_name": result.get("medicine_name"),
                "outcome": outcome,
                "chosen_ndc11": result.get("chosen_ndc11"),
                "extras_count": result.get("extras_count", 0),
                "source_counts": result.get("source_counts"),
            }
            if result.get("error"):
                row_summary["error"] = result["error"][:500]

            if outcome == "updated":
                if not dry_run:
                    try:
                        with database.db_engine.begin() as conn:
                            _write_pill_update(
                                conn,
                                result["pill_id"],
                                result["primary_candidate"],
                                result.get("extra_candidates") or [],
                            )
                        summary["updated"] += 1
                    except Exception as exc:
                        logger.error("DB write error for pill %s: %s", result["pill_id"], exc)
                        summary["errors"] += 1
                        row_summary["outcome"] = "db_error"
                        row_summary["error"] = str(exc)[:500]
                else:
                    summary["updated"] += 1

            elif outcome == "multiple_matches":
                if not dry_run:
                    try:
                        with database.db_engine.begin() as conn:
                            _write_skipped(
                                conn,
                                result["pill_id"],
                                "multiple_matches",
                                result.get("candidates") or [],
                            )
                        summary["skipped_multi"] += 1
                    except Exception as exc:
                        logger.error(
                            "DB write error for skipped pill %s: %s", result["pill_id"], exc
                        )
                        summary["errors"] += 1
                        row_summary["outcome"] = "db_error"
                        row_summary["error"] = str(exc)[:500]
                else:
                    summary["skipped_multi"] += 1

            elif outcome == "no_match":
                if not dry_run:
                    try:
                        with database.db_engine.begin() as conn:
                            _write_skipped(conn, result["pill_id"], "no_match", [])
                        summary["skipped_none"] += 1
                    except Exception as exc:
                        logger.error(
                            "DB write error for no-match pill %s: %s", result["pill_id"], exc
                        )
                        summary["errors"] += 1
                        row_summary["outcome"] = "db_error"
                        row_summary["error"] = str(exc)[:500]
                else:
                    summary["skipped_none"] += 1

            elif outcome == "api_error":
                if not dry_run:
                    try:
                        with database.db_engine.begin() as conn:
                            _write_skipped(
                                conn,
                                result["pill_id"],
                                "api_error",
                                [{"error": result.get("error")}],
                            )
                    except Exception as exc:
                        logger.error(
                            "DB write error for api_error pill %s: %s", result["pill_id"], exc
                        )
                        row_summary["outcome"] = "api_error_db_error"
                summary["errors"] += 1

            summary["rows"].append(row_summary)
            logger.info("Pill %s → %s", result["pill_id"], outcome)

    return summary
