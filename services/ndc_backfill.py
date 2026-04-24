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


def _fetch(url: str, params: Optional[Dict] = None, timeout: int = 30) -> Optional[Dict]:
    """GET *url* with one retry on 5xx / timeout.  Returns parsed JSON or None."""
    for attempt in range(2):
        try:
            resp = httpx.get(url, params=params, timeout=timeout)
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
    return None


# ---------------------------------------------------------------------------
# API fetch functions
# ---------------------------------------------------------------------------


def fetch_dailymed_by_rxcui(rxcui: str) -> List[Dict]:
    """Query DailyMed for SPL sets by RxCUI, then pull NDC lists per set."""
    data = _fetch(DAILYMED_SPL_URL, params={"rxcui": rxcui, "pagesize": 25})
    if not data or "data" not in data:
        return []

    candidates: List[Dict] = []
    for spl in data["data"]:
        setid = spl.get("setid")
        if not setid:
            continue
        ndc_data = _fetch(DAILYMED_NDC_URL.format(setid=setid))
        if not ndc_data or "data" not in ndc_data:
            continue
        for entry in ndc_data.get("data", []):
            ndc_raw = entry.get("ndc") or entry.get("ndc_code") or ""
            if ndc_raw:
                candidates.append(
                    {
                        "ndc": ndc_raw,
                        "package_description": entry.get("package_description") or "",
                        "source": "dailymed",
                        "setid": setid,
                    }
                )
    return candidates


def fetch_openfda_by_name(name: str) -> List[Dict]:
    """Query openFDA drug/ndc endpoint by generic_name."""
    safe_name = name.replace('"', '\\"')
    params = {"search": f'generic_name:"{safe_name}"', "limit": 25}
    data = _fetch(OPENFDA_NDC_URL, params=params)
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


def _decide(candidates: List[Dict]) -> Tuple[str, Optional[Dict], List[Dict]]:
    """Return (outcome, primary_candidate, extra_candidates).

    outcome is one of: 'updated', 'multiple_matches', 'no_match'
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

    # Single product — pick first as primary (they're already ordered by DailyMed / openFDA)
    all_pkg = list(candidates)
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
        raw_candidates: List[Dict] = []

        use_rxcui = match_mode in ("rxcui", "auto") and bool(rxcui)
        use_name = match_mode in ("name", "auto")

        if use_rxcui:
            raw_candidates = fetch_dailymed_by_rxcui(str(rxcui))
            time.sleep(sleep_ms / 1000)

        if not raw_candidates and use_name and name:
            raw_candidates = fetch_openfda_by_name(name)
            time.sleep(sleep_ms / 1000)

        candidates = _normalise_candidates(raw_candidates)
        result["candidates"] = candidates

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
    """Insert a row into ndc_backfill_skipped."""
    conn.execute(
        text(
            """
            INSERT INTO ndc_backfill_skipped (pill_id, reason, candidates)
            VALUES (:pill_id, :reason, CAST(:candidates AS jsonb))
            """
        ),
        {
            "pill_id": pill_id,
            "reason": reason,
            "candidates": json.dumps(candidates),
        },
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

    for row in pill_rows:
        summary["processed"] += 1
        result = process_pill_row(row, match_mode=match_mode, sleep_ms=sleep_ms)
        outcome = result["outcome"]

        row_summary: Dict[str, Any] = {
            "pill_id": result["pill_id"],
            "medicine_name": result.get("medicine_name"),
            "outcome": outcome,
            "chosen_ndc11": result.get("chosen_ndc11"),
            "extras_count": result.get("extras_count", 0),
        }

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
                except Exception as exc:
                    logger.error(
                        "DB write error for skipped pill %s: %s", result["pill_id"], exc
                    )
            summary["skipped_multi"] += 1

        elif outcome == "no_match":
            if not dry_run:
                try:
                    with database.db_engine.begin() as conn:
                        _write_skipped(conn, result["pill_id"], "no_match", [])
                except Exception as exc:
                    logger.error(
                        "DB write error for no-match pill %s: %s", result["pill_id"], exc
                    )
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
            summary["errors"] += 1

        summary["rows"].append(row_summary)
        logger.info("Pill %s → %s", result["pill_id"], outcome)

    return summary
