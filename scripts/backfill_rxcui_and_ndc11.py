"""CLI script: backfill missing rxcui values using openFDA + RxNorm properties API.

Strategy (proven from live API testing)
----------------------------------------
Step 1 — openFDA by brand_name + strength:
  GET https://api.fda.gov/drug/ndc.json
      ?search=brand_name:"{name}"+AND+active_ingredients.strength:"{strength}"&limit=5

  Returns openfda.rxcui[] — a list of candidate rxcuis.
  Fallback chain if NOT_FOUND:
    1. Retry without strength filter: search=brand_name:"{name}"
    2. Try generic_name:"{name}" with strength
    3. Try generic_name:"{name}" without strength

Step 2 — RxNorm properties to pick the correct rxcui:
  GET https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/properties.json
  Response contains properties.tty and properties.name.

  Priority order for picking the best rxcui:
    1. tty=SCD AND strength in name matches spl_strength  (best)
    2. tty=SBD AND strength in name matches spl_strength  (good)
    3. tty=SCD without strength match                     (fallback)
    4. tty=SBD without strength match                     (fallback)
    5. Any other tty — skip

NOTE: ndc11 is never updated by this script.  These are old/discontinued drugs
whose original NDC labeler has changed; only rxcui is safe to backfill.

Usage
-----
    python scripts/backfill_rxcui_and_ndc11.py --dry-run --limit 10
    python scripts/backfill_rxcui_and_ndc11.py --limit 200 --sleep-ms 300
    python scripts/backfill_rxcui_and_ndc11.py --limit 200 --offset 200 --sleep-ms 300
    python scripts/backfill_rxcui_and_ndc11.py --confidence HIGH --limit 500

Flags
-----
--dry-run              Fetch and print results, write nothing to DB.
--limit N              Process at most N rows (default: 10).
--offset N             Skip first N rows (default: 0).
--sleep-ms N           Milliseconds between rows (default: 300).
--skip-discontinued    Skip rows where drug is likely discontinued
                       (ndc9 has < 6 significant digits before zero-padding).
--confidence LEVEL     Only write rows at or above this confidence level.
                       Choices: HIGH, MEDIUM, LOW, ALL (default: MEDIUM).
"""

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Dict, List, Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("backfill_rxcui_and_ndc11")

# Allow running from repository root OR from within scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

OPENFDA_NDC_URL = "https://api.fda.gov/drug/ndc.json"
RXNORM_PROPERTIES_URL = "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/properties.json"

# ---------------------------------------------------------------------------
# SQL statements
# ---------------------------------------------------------------------------

_ROW_SELECT_SQL = """
    SELECT id, medicine_name, ndc9, ndc11, rxcui, spl_strength, dosage_form
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND (rxcui IS NULL OR TRIM(rxcui) = '')
      AND (
        (ndc9 IS NOT NULL AND TRIM(ndc9) != '')
        OR (ndc11 IS NOT NULL AND TRIM(ndc11) != '')
      )
    ORDER BY LENGTH(ndc9) DESC NULLS LAST, id
    LIMIT :limit OFFSET :offset
"""

_CREATE_LOG_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS rxcui_backfill_log (
      id SERIAL PRIMARY KEY,
      pill_id UUID NOT NULL,
      medicine_name TEXT,
      old_rxcui TEXT,
      new_rxcui TEXT,
      old_ndc11 TEXT,
      new_ndc11 TEXT,
      padded_ndc9 TEXT,
      confidence TEXT,
      outcome TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
"""

_INSERT_LOG_SQL = """
    INSERT INTO rxcui_backfill_log
        (pill_id, medicine_name, old_rxcui, new_rxcui, old_ndc11, new_ndc11,
         padded_ndc9, confidence, outcome, notes)
    VALUES
        (:pill_id, :medicine_name, :old_rxcui, :new_rxcui, :old_ndc11, :new_ndc11,
         :padded_ndc9, :confidence, :outcome, :notes)
"""

_UPDATE_RXCUI_SQL = """
    UPDATE pillfinder
    SET rxcui = :rxcui,
        updated_at = NOW()
    WHERE id = :pill_id
      AND (rxcui IS NULL OR TRIM(rxcui) = '')
"""

# Confidence level ordering (higher index = higher confidence)
_CONFIDENCE_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "ALL": -1}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------


def _parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Backfill missing rxcui and ndc11 values using the free RxNorm API."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        dest="dry_run",
        help="Fetch and print results, write nothing to DB.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        metavar="N",
        help="Process at most N rows (default: 10).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        metavar="N",
        help="Skip first N rows (default: 0).",
    )
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=300,
        metavar="N",
        dest="sleep_ms",
        help="Milliseconds between API calls (default: 300).",
    )
    parser.add_argument(
        "--skip-discontinued",
        action="store_true",
        default=False,
        dest="skip_discontinued",
        help=(
            "Skip rows where drug is likely discontinued "
            "(ndc9 has < 6 significant digits before padding)."
        ),
    )
    parser.add_argument(
        "--confidence",
        choices=["HIGH", "MEDIUM", "LOW", "ALL"],
        default="MEDIUM",
        metavar="LEVEL",
        help="Only write rows at or above this confidence level (default: MEDIUM).",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# NDC helpers
# ---------------------------------------------------------------------------


def pad_ndc9(raw: str) -> str:
    """Zero-pad ndc9 to 9 digits."""
    cleaned = raw.strip().replace("-", "")
    return cleaned.zfill(9)


def _significant_digits(raw: str) -> int:
    """Return the number of significant (non-stripped) digits in the raw ndc9."""
    return len(raw.strip().replace("-", ""))


# ---------------------------------------------------------------------------
# RxNorm API helpers
# ---------------------------------------------------------------------------


def _fetch_json(
    url: str,
    params: Optional[Dict] = None,
    timeout: int = 15,
    client: Optional["httpx.Client"] = None,
) -> Optional[Dict]:
    """GET url with one retry on 5xx / timeout. Returns parsed JSON or None.

    If *client* is provided it is reused (connection pooling); otherwise a
    temporary client is created per call.
    """
    import httpx

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
            except Exception as exc:
                if attempt == 0:
                    time.sleep(1)
                    continue
                logger.warning("HTTP error fetching %s: %s", url, exc)
                return None
    finally:
        if _close:
            client.close()
    return None


def _parse_strength_str(spl_strength: str) -> Optional[str]:
    """Extract 'N unit' from spl_strength for the openFDA active_ingredients.strength search.

    Examples:
      'METHYLPREDNISOLONE 2 mg;'        → '2 mg'
      'MONTELUKAST SODIUM 10 mg/1'      → '10 mg'
      'IBUPROFEN 200 MG'                → '200 mg'
      'FLUTICASONE PROPIONATE 0.05 %'   → '0.05 %'
    Returns None if no numeric+unit pattern found.
    """
    if not spl_strength:
        return None
    m = re.search(
        r'(\d+(?:\.\d+)?)\s*(mg|mcg|g\b|ml\b|%|IU|units?)',
        spl_strength,
        re.IGNORECASE,
    )
    if m:
        return f"{m.group(1)} {m.group(2).lower()}"
    return None


def _extract_strength_num(spl_strength: str) -> Optional[str]:
    """Extract just the numeric value from spl_strength for RxNorm name matching.

    'METHYLPREDNISOLONE 2 mg;' → '2'
    'MONTELUKAST SODIUM 10 mg/1' → '10'
    """
    if not spl_strength:
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:mg|mcg|g\b|ml\b|%|IU|units?)', spl_strength, re.IGNORECASE)
    return m.group(1) if m else None


def fetch_openfda_candidates(
    name: str,
    strength_str: Optional[str] = None,
    name_field: str = "brand_name",
    limit: int = 5,
    client: Optional["httpx.Client"] = None,
) -> Optional[List[str]]:
    """Search openFDA for a drug by name (+ optional strength).

    Returns:
      - list of rxcui strings (may be empty) if openFDA returns results
      - None if openFDA returns NOT_FOUND (HTTP 404 / error body)
    """
    if strength_str:
        search = f'{name_field}:"{name}"+AND+active_ingredients.strength:"{strength_str}"'
    else:
        search = f'{name_field}:"{name}"'
    data = _fetch_json(OPENFDA_NDC_URL, params={"search": search, "limit": limit}, client=client)
    if data is None:
        # HTTP 404 (NOT_FOUND) or network error
        return None
    if "error" in data:
        return None

    rxcuis: List[str] = []
    for result in data.get("results", []):
        for rxcui in result.get("openfda", {}).get("rxcui", []):
            if rxcui not in rxcuis:
                rxcuis.append(rxcui)
    return rxcuis


def fetch_rxnorm_properties(
    rxcui: str, client: Optional["httpx.Client"] = None
) -> Optional[Dict]:
    """Fetch RxNorm properties (tty, name) for a single rxcui.

    Returns the 'properties' dict, e.g.
      {"rxcui": "200224", "name": "montelukast 10 MG Oral Tablet", "tty": "SCD", ...}
    or None on failure.
    """
    url = RXNORM_PROPERTIES_URL.format(rxcui=rxcui)
    data = _fetch_json(url, client=client)
    if not data:
        return None
    return data.get("properties") or None


def _pick_best_rxcui(
    candidates: List[str],
    strength_num: Optional[str],
    client: Optional["httpx.Client"] = None,
) -> Tuple[Optional[str], str, str]:
    """Pick the best rxcui from a list of candidates using RxNorm properties.

    Priority order:
      1. tty=SCD AND strength_num appears in name  → HIGH (1 match) or MEDIUM (multiple)
      2. tty=SBD AND strength_num appears in name  → HIGH (1 match) or MEDIUM (multiple)
      3. tty=SCD without strength match             → LOW confidence
      4. tty=SBD without strength match             → LOW confidence
      5. Any other tty                              → skipped

    Returns (rxcui, confidence, notes).
    """
    scd_strength: List[str] = []
    sbd_strength: List[str] = []
    scd_any: List[str] = []
    sbd_any: List[str] = []

    for rxcui in candidates:
        props = fetch_rxnorm_properties(rxcui, client=client)
        if props is None:
            continue
        tty = props.get("tty", "")
        name = props.get("name", "")
        if tty not in ("SCD", "SBD"):
            continue

        strength_matches = False
        if strength_num:
            # Case-insensitive: strength number followed by a space + unit
            # e.g. "10" matches "montelukast 10 MG Oral Tablet"
            strength_matches = bool(
                re.search(
                    r'\b' + re.escape(strength_num) + r'\s+(?:MG|MCG|G\b|ML\b|%|IU)',
                    name,
                    re.IGNORECASE,
                )
            )

        if tty == "SCD":
            if strength_matches:
                scd_strength.append(rxcui)
            else:
                scd_any.append(rxcui)
        else:  # SBD
            if strength_matches:
                sbd_strength.append(rxcui)
            else:
                sbd_any.append(rxcui)

    # Priority 1 & 2: strength match
    strength_matches_all = scd_strength + sbd_strength
    if len(strength_matches_all) == 1:
        chosen = strength_matches_all[0]
        tty_label = "SCD" if chosen in scd_strength else "SBD"
        return chosen, "HIGH", f"tty={tty_label} strength match"
    if len(strength_matches_all) > 1:
        # Prefer SCD over SBD when both match
        chosen = (scd_strength or sbd_strength)[0]
        tty_label = "SCD" if chosen in scd_strength else "SBD"
        return chosen, "MEDIUM", f"tty={tty_label} strength match ({len(strength_matches_all)} candidates)"

    # Priority 3 & 4: tty match without strength
    tty_fallback = scd_any + sbd_any
    if tty_fallback:
        chosen = tty_fallback[0]
        tty_label = "SCD" if chosen in scd_any else "SBD"
        return chosen, "LOW", f"tty={tty_label} no strength match"

    return None, "SKIPPED", "no SCD/SBD tty found in candidates"


# ---------------------------------------------------------------------------
# Per-row processing
# ---------------------------------------------------------------------------


def _process_row(row, *, sleep_s: float, skip_discontinued: bool, client: Optional["httpx.Client"] = None) -> Dict:
    """Fetch rxcui for a single pillfinder row using openFDA + RxNorm properties.

    Returns a result dict with keys:
        pill_id, medicine_name, padded_ndc9, rxcui, ndc11, confidence, outcome, notes

    ndc11 is always None — this script never updates ndc11.
    """
    pill_id = str(row.id)
    medicine_name = row.medicine_name or ""
    raw_ndc9 = (row.ndc9 or "").strip()
    existing_ndc11 = (row.ndc11 or "").strip()
    spl_strength = (row.spl_strength or "").strip()

    result: Dict = {
        "pill_id": pill_id,
        "medicine_name": medicine_name,
        "padded_ndc9": None,
        "rxcui": None,
        "ndc11": None,  # never updated
        "confidence": None,
        "outcome": None,
        "notes": None,
    }

    # Record padded_ndc9 for audit log / skip_discontinued check
    if raw_ndc9:
        padded = pad_ndc9(raw_ndc9)
        result["padded_ndc9"] = padded
        sig_digits = _significant_digits(raw_ndc9)

        if skip_discontinued and sig_digits < 6:
            result["confidence"] = "SKIPPED"
            result["outcome"] = "skipped_discontinued"
            result["notes"] = f"ndc9={raw_ndc9!r} has {sig_digits} significant digits (likely discontinued)"
            return result
    elif existing_ndc11:
        result["padded_ndc9"] = existing_ndc11.replace("-", "")
    else:
        result["confidence"] = "SKIPPED"
        result["outcome"] = "skipped_no_ndc"
        result["notes"] = "no usable NDC"
        return result

    if not medicine_name.strip():
        result["confidence"] = "SKIPPED"
        result["outcome"] = "no_match"
        result["notes"] = "empty medicine_name, cannot search openFDA"
        return result

    # Parse strength for openFDA search and RxNorm name matching
    strength_str = _parse_strength_str(spl_strength)   # e.g. "10 mg"
    strength_num = _extract_strength_num(spl_strength)  # e.g. "10"

    # --- Step 1: openFDA search with fallback chain ---
    # Attempts (in order): brand+strength, brand, generic+strength, generic
    candidates: Optional[List[str]] = None
    search_notes: List[str] = []

    try:
        # 1a. brand_name + strength
        if strength_str:
            candidates = fetch_openfda_candidates(
                medicine_name, strength_str=strength_str, name_field="brand_name", client=client
            )
            if candidates is None:
                search_notes.append("brand+strength=NOT_FOUND")
            else:
                search_notes.append(f"brand+strength={len(candidates)} rxcuis")

        # 1b. brand_name without strength
        if candidates is None:
            candidates = fetch_openfda_candidates(
                medicine_name, strength_str=None, name_field="brand_name", client=client
            )
            if candidates is None:
                search_notes.append("brand=NOT_FOUND")
            else:
                search_notes.append(f"brand={len(candidates)} rxcuis")

        # 1c. generic_name + strength
        if candidates is None and strength_str:
            candidates = fetch_openfda_candidates(
                medicine_name, strength_str=strength_str, name_field="generic_name", client=client
            )
            if candidates is None:
                search_notes.append("generic+strength=NOT_FOUND")
            else:
                search_notes.append(f"generic+strength={len(candidates)} rxcuis")

        # 1d. generic_name without strength
        if candidates is None:
            candidates = fetch_openfda_candidates(
                medicine_name, strength_str=None, name_field="generic_name", client=client
            )
            if candidates is None:
                search_notes.append("generic=NOT_FOUND")
            else:
                search_notes.append(f"generic={len(candidates)} rxcuis")

    except Exception as exc:
        result["confidence"] = "ERROR"
        result["outcome"] = "api_error"
        result["notes"] = f"openFDA search failed: {exc}"
        return result
    finally:
        time.sleep(sleep_s)

    if candidates is None or len(candidates) == 0:
        result["confidence"] = "SKIPPED"
        result["outcome"] = "no_match"
        result["notes"] = "; ".join(search_notes) or "openFDA returned no results"
        return result

    # --- Step 2: pick best rxcui from candidates via RxNorm properties ---
    try:
        chosen_rxcui, confidence, pick_notes = _pick_best_rxcui(
            candidates, strength_num, client=client
        )
    except Exception as exc:
        result["confidence"] = "ERROR"
        result["outcome"] = "api_error"
        result["notes"] = f"RxNorm properties lookup failed: {exc}"
        return result

    notes = "; ".join(filter(None, ["; ".join(search_notes), pick_notes]))

    if chosen_rxcui is None:
        result["confidence"] = "SKIPPED"
        result["outcome"] = "no_match"
        result["notes"] = notes
        return result

    result["rxcui"] = chosen_rxcui
    result["confidence"] = confidence
    result["outcome"] = "pending"
    result["notes"] = notes
    return result


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _ensure_log_table(conn):
    """Create rxcui_backfill_log if it doesn't exist."""
    from sqlalchemy import text

    conn.execute(text(_CREATE_LOG_TABLE_SQL))


def _write_log(conn, *, pill_id, medicine_name, old_rxcui, new_rxcui,
               old_ndc11, new_ndc11, padded_ndc9, confidence, outcome, notes):
    from sqlalchemy import text

    conn.execute(
        text(_INSERT_LOG_SQL),
        {
            "pill_id": pill_id,
            "medicine_name": medicine_name,
            "old_rxcui": old_rxcui,
            "new_rxcui": new_rxcui,
            "old_ndc11": old_ndc11,
            "new_ndc11": new_ndc11,
            "padded_ndc9": padded_ndc9,
            "confidence": confidence,
            "outcome": outcome,
            "notes": notes,
        },
    )


def _confidence_meets_threshold(confidence: str, threshold: str) -> bool:
    """Return True if confidence level >= threshold."""
    if threshold == "ALL":
        return True
    order = _CONFIDENCE_ORDER
    return order.get(confidence, -1) >= order.get(threshold, 1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv=None):
    args = _parse_args(argv)

    # Safety reminder
    if not args.dry_run:
        logger.warning(
            "⚠️  LIVE MODE — changes will be written to pillfinder. "
            "Always run with --dry-run first to review results before writing."
        )
    else:
        logger.info("DRY-RUN mode — no changes will be written to the database.")

    logger.info(
        "Starting RxCUI+NDC11 backfill: dry_run=%s limit=%d offset=%d "
        "sleep_ms=%d skip_discontinued=%s confidence=%s",
        args.dry_run,
        args.limit,
        args.offset,
        args.sleep_ms,
        args.skip_discontinued,
        args.confidence,
    )

    sleep_s = args.sleep_ms / 1000.0

    # --- DB setup ---
    db_engine = None
    try:
        import database

        if not database.db_engine:
            if not database.connect_to_database():
                logger.error("Cannot connect to database. Aborting.")
                sys.exit(1)
        db_engine = database.db_engine
    except Exception as exc:
        logger.error("DB setup failed: %s", exc)
        sys.exit(1)

    from sqlalchemy import text

    # Ensure audit log table exists
    try:
        with db_engine.begin() as conn:
            _ensure_log_table(conn)
    except Exception as exc:
        logger.error("Failed to create rxcui_backfill_log table: %s", exc)
        sys.exit(1)

    # --- Fetch candidate rows ---
    try:
        with db_engine.connect() as conn:
            rows = conn.execute(
                text(_ROW_SELECT_SQL),
                {"limit": args.limit, "offset": args.offset},
            ).fetchall()
    except Exception as exc:
        logger.error("Failed to select rows from pillfinder: %s", exc)
        sys.exit(1)

    if not rows:
        logger.info("No rows to process.")
        summary = {
            "processed": 0,
            "written": 0,
            "skipped_confidence": 0,
            "no_match": 0,
            "api_error": 0,
            "dry_run": args.dry_run,
        }
        print(json.dumps(summary))
        sys.exit(0)

    # --- Process rows ---
    counters = {
        "processed": 0,
        "written": 0,
        "skipped_confidence": 0,
        "no_match": 0,
        "api_error": 0,
    }

    import httpx

    with httpx.Client(timeout=15) as http_client:
        for row in rows:
            counters["processed"] += 1
            pill_id = str(row.id)
            medicine_name = row.medicine_name or ""
            old_rxcui = (row.rxcui or "").strip() or None
            old_ndc11 = (row.ndc11 or "").strip() or None

            try:
                result = _process_row(
                    row,
                    sleep_s=sleep_s,
                    skip_discontinued=args.skip_discontinued,
                    client=http_client,
                )
            except Exception as exc:
                logger.error("Unexpected error processing pill_id=%s: %s", pill_id, exc)
                result = {
                    "pill_id": pill_id,
                    "medicine_name": medicine_name,
                    "padded_ndc9": None,
                    "rxcui": None,
                    "ndc11": None,
                    "confidence": "ERROR",
                    "outcome": "api_error",
                    "notes": str(exc),
                }

            confidence = result.get("confidence")
            outcome = result.get("outcome")
            new_rxcui = result.get("rxcui")
            new_ndc11 = result.get("ndc11")
            padded_ndc9 = result.get("padded_ndc9")

            # Map internal outcomes to counters
            if outcome == "api_error":
                counters["api_error"] += 1
            elif outcome == "no_match":
                counters["no_match"] += 1
            elif outcome in ("skipped_discontinued", "skipped_no_ndc"):
                counters["skipped_confidence"] += 1

            # Determine final write outcome
            should_write = (
                outcome == "pending"
                and not args.dry_run
                and confidence in ("HIGH", "MEDIUM", "LOW")
                and _confidence_meets_threshold(confidence, args.confidence)
            )

            if args.dry_run:
                final_outcome = "dry_run"
            elif outcome in ("api_error", "no_match", "skipped_discontinued", "skipped_no_ndc"):
                final_outcome = outcome
            elif outcome == "pending" and not _confidence_meets_threshold(confidence, args.confidence):
                final_outcome = "skipped_confidence"
                counters["skipped_confidence"] += 1
            elif should_write:
                final_outcome = "written"
            else:
                final_outcome = outcome or "skipped_confidence"

            # --- DB writes (live mode only) ---
            if should_write:
                try:
                    with db_engine.begin() as conn:
                        if new_rxcui and new_rxcui != old_rxcui:
                            conn.execute(
                                text(_UPDATE_RXCUI_SQL),
                                {"rxcui": new_rxcui, "pill_id": pill_id},
                            )
                        # ndc11 is intentionally NOT updated — these are old drugs whose
                        # original NDC labeler has changed; only rxcui is safe to backfill.
                        _write_log(
                            conn,
                            pill_id=pill_id,
                            medicine_name=medicine_name,
                            old_rxcui=old_rxcui,
                            new_rxcui=new_rxcui,
                            old_ndc11=old_ndc11,
                            new_ndc11=None,
                            padded_ndc9=padded_ndc9,
                            confidence=confidence,
                            outcome=final_outcome,
                            notes=result.get("notes"),
                        )
                    counters["written"] += 1
                    logger.info(
                        "✓ %s (%s) rxcui=%s [%s]",
                        medicine_name,
                        pill_id,
                        new_rxcui,
                        confidence,
                    )
                except Exception as exc:
                    logger.error("DB write failed for pill_id=%s: %s", pill_id, exc)
                    counters["api_error"] += 1
                    # Attempt to log the error
                    try:
                        with db_engine.begin() as conn:
                            _write_log(
                                conn,
                                pill_id=pill_id,
                                medicine_name=medicine_name,
                                old_rxcui=old_rxcui,
                                new_rxcui=new_rxcui,
                                old_ndc11=old_ndc11,
                                new_ndc11=None,
                                padded_ndc9=padded_ndc9,
                                confidence="ERROR",
                                outcome="api_error",
                                notes=f"DB write failed: {exc}",
                            )
                    except Exception:
                        pass
            else:
                # Log every non-written row (dry-run, skipped, errors, no_match)
                try:
                    with db_engine.begin() as conn:
                        _write_log(
                            conn,
                            pill_id=pill_id,
                            medicine_name=medicine_name,
                            old_rxcui=old_rxcui,
                            new_rxcui=new_rxcui,
                            old_ndc11=old_ndc11,
                            new_ndc11=None,
                            padded_ndc9=padded_ndc9,
                            confidence=confidence,
                            outcome=final_outcome,
                            notes=result.get("notes"),
                        )
                except Exception as exc:
                    logger.warning("Failed to write audit log for pill_id=%s: %s", pill_id, exc)

            # Print per-row JSON in dry-run mode
            if args.dry_run:
                row_out = {
                    "pill_id": pill_id,
                    "medicine_name": medicine_name,
                    "padded_ndc9": padded_ndc9,
                    "rxcui": new_rxcui,
                    "confidence": confidence,
                    "outcome": final_outcome,
                }
                print(json.dumps(row_out))
            else:
                if final_outcome not in ("written",):
                    logger.info(
                        "↪ %s (%s) outcome=%s confidence=%s notes=%s",
                        medicine_name,
                        pill_id,
                        final_outcome,
                        confidence,
                        result.get("notes"),
                    )

    # --- Summary ---
    summary = {
        "processed": counters["processed"],
        "written": counters["written"],
        "skipped_confidence": counters["skipped_confidence"],
        "no_match": counters["no_match"],
        "api_error": counters["api_error"],
        "dry_run": args.dry_run,
    }
    print(json.dumps(summary))
    logger.info("Done: %s", summary)


if __name__ == "__main__":
    main(sys.argv[1:])
