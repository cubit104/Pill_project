"""CLI script: backfill missing rxcui and ndc11 values using the free RxNorm API.

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
--sleep-ms N           Milliseconds between API calls (default: 300).
--skip-discontinued    Skip rows where drug is likely discontinued
                       (ndc9 after padding has < 6 significant digits).
--confidence LEVEL     Only write rows at or above this confidence level.
                       Choices: HIGH, MEDIUM, LOW, ALL (default: MEDIUM).
"""

import argparse
import json
import logging
import os
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
# RxNorm API endpoints (free, no key required)
# ---------------------------------------------------------------------------

RXNORM_RXCUI_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json"
RXNORM_ALLNDCS_URL = "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/allndcs.json"

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

_UPDATE_NDC11_SQL = """
    UPDATE pillfinder
    SET ndc11 = :ndc11,
        updated_at = NOW()
    WHERE id = :pill_id
      AND (ndc11 IS NULL OR TRIM(ndc11) = '')
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


def _fetch_json(url: str, params: Optional[Dict] = None, timeout: int = 15) -> Optional[Dict]:
    """GET url with one retry on 5xx / timeout. Returns parsed JSON or None."""
    import httpx

    for attempt in range(2):
        try:
            with httpx.Client(timeout=timeout) as client:
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
    return None


def fetch_rxcui_by_ndc(ndc: str) -> Optional[str]:
    """Look up RxCUI for a given NDC string via RxNorm. Returns rxcui or None."""
    data = _fetch_json(RXNORM_RXCUI_URL, params={"idtype": "NDC", "id": ndc})
    if not data:
        return None
    ids = data.get("idGroup", {}).get("rxnormId", [])
    return ids[0] if ids else None


def fetch_all_ndcs_for_rxcui(rxcui: str) -> List[str]:
    """Return all NDC-11s for a given RxCUI via RxNorm allndcs endpoint."""
    url = RXNORM_ALLNDCS_URL.format(rxcui=rxcui)
    data = _fetch_json(url)
    if not data:
        return []
    # Response: {"ndcGroup": {"ndcList": {"ndc": ["00006-0117-31", ...]}}}
    try:
        ndc_list = data.get("ndcGroup", {}).get("ndcList", {}).get("ndc", [])
        return ndc_list if isinstance(ndc_list, list) else []
    except Exception:
        return []


# ---------------------------------------------------------------------------
# NDC-11 selection + confidence logic
# ---------------------------------------------------------------------------


def _strip_dashes(ndc: str) -> str:
    return ndc.replace("-", "")


def select_ndc11_with_confidence(
    padded_ndc9: str, all_ndcs: List[str]
) -> Tuple[Optional[str], str]:
    """Pick the best NDC-11 from the RxNorm list and return (ndc11, confidence).

    Confidence tiers:
      HIGH   — exactly 1 NDC-11 matching our labeler prefix (first 5 digits of padded_ndc9)
      MEDIUM — multiple NDC-11s, same labeler, same product code (digits 6-9 of padded_ndc9)
      LOW    — RxNorm matched but NDC-11 selection is ambiguous (different labeler or product)
    """
    if not all_ndcs:
        return None, "LOW"

    labeler_prefix = padded_ndc9[:5]  # first 5 digits
    product_code = padded_ndc9[5:9]   # next 4 digits (product)

    # Normalise all returned NDC-11s (strip dashes, keep raw for return)
    normalised = [(ndc, _strip_dashes(ndc)) for ndc in all_ndcs]

    # Filter by labeler prefix (first 5 digits of the 11-digit NDC)
    labeler_matches = [(raw, stripped) for raw, stripped in normalised if stripped[:5] == labeler_prefix]

    if len(labeler_matches) == 1:
        return labeler_matches[0][0], "HIGH"

    if len(labeler_matches) > 1:
        # Further filter by product code (digits 5-9 of the 11-digit NDC)
        product_matches = [
            (raw, stripped)
            for raw, stripped in labeler_matches
            if stripped[5:9] == product_code
        ]
        if product_matches:
            return product_matches[0][0], "MEDIUM"
        # Same labeler but different product — still MEDIUM (labeler confirmed)
        return labeler_matches[0][0], "MEDIUM"

    # No labeler match — LOW confidence, pick first returned NDC-11
    return all_ndcs[0], "LOW"


# ---------------------------------------------------------------------------
# Per-row processing
# ---------------------------------------------------------------------------


def _process_row(row, *, sleep_s: float, skip_discontinued: bool) -> Dict:
    """Fetch rxcui and ndc11 for a single pillfinder row.

    Returns a result dict with keys:
        pill_id, medicine_name, padded_ndc9, rxcui, ndc11, confidence, outcome, notes
    """
    pill_id = str(row.id)
    medicine_name = row.medicine_name or ""
    raw_ndc9 = (row.ndc9 or "").strip()
    existing_ndc11 = (row.ndc11 or "").strip()
    existing_rxcui = (row.rxcui or "").strip()

    result = {
        "pill_id": pill_id,
        "medicine_name": medicine_name,
        "padded_ndc9": None,
        "rxcui": existing_rxcui or None,
        "ndc11": existing_ndc11 or None,
        "confidence": None,
        "outcome": None,
        "notes": None,
    }

    # Determine which NDC to use for the lookup
    if raw_ndc9:
        padded = pad_ndc9(raw_ndc9)
        result["padded_ndc9"] = padded
        sig_digits = _significant_digits(raw_ndc9)

        # --skip-discontinued: skip if < 6 significant digits
        if skip_discontinued and sig_digits < 6:
            result["confidence"] = "SKIPPED"
            result["outcome"] = "skipped_discontinued"
            result["notes"] = f"ndc9={raw_ndc9!r} has {sig_digits} significant digits (likely discontinued)"
            return result

        lookup_ndc = padded
    elif existing_ndc11:
        # Has ndc11 but no ndc9 — use ndc11 directly for lookup
        lookup_ndc = _strip_dashes(existing_ndc11)
        result["padded_ndc9"] = lookup_ndc  # record what we used
    else:
        result["confidence"] = "SKIPPED"
        result["outcome"] = "skipped_discontinued"
        result["notes"] = "no usable NDC"
        return result

    # --- Step 1: NDC → RxCUI ---
    try:
        rxcui = fetch_rxcui_by_ndc(lookup_ndc)
        time.sleep(sleep_s)
    except Exception as exc:
        result["confidence"] = "ERROR"
        result["outcome"] = "api_error"
        result["notes"] = f"rxcui lookup failed: {exc}"
        return result

    if not rxcui:
        result["confidence"] = "LOW"
        result["outcome"] = "no_match"
        result["notes"] = f"RxNorm returned no rxcui for NDC={lookup_ndc!r}"
        return result

    result["rxcui"] = rxcui

    # --- Step 2: RxCUI → NDC-11s (only if ndc11 is missing) ---
    if existing_ndc11:
        # Already have an ndc11 — just needed the rxcui
        result["ndc11"] = existing_ndc11
        result["confidence"] = "HIGH"
        result["outcome"] = "pending"
        return result

    try:
        all_ndcs = fetch_all_ndcs_for_rxcui(rxcui)
        time.sleep(sleep_s)
    except Exception as exc:
        # We have rxcui but couldn't get ndc11 — still record rxcui
        result["confidence"] = "LOW"
        result["outcome"] = "pending"
        result["notes"] = f"allndcs lookup failed: {exc}"
        return result

    if not all_ndcs:
        result["confidence"] = "LOW"
        result["outcome"] = "pending"
        result["notes"] = "RxNorm returned no NDC-11s for rxcui"
        return result

    padded_ndc9 = result["padded_ndc9"] or lookup_ndc
    chosen_ndc11, confidence = select_ndc11_with_confidence(padded_ndc9, all_ndcs)
    result["ndc11"] = chosen_ndc11
    result["confidence"] = confidence
    result["outcome"] = "pending"
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

        # Map internal outcomes
        if outcome == "api_error":
            counters["api_error"] += 1
        elif outcome == "no_match":
            counters["no_match"] += 1
        elif outcome == "skipped_discontinued":
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
        elif outcome in ("api_error", "no_match", "skipped_discontinued"):
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
                    if new_ndc11 and new_ndc11 != old_ndc11 and not old_ndc11:
                        conn.execute(
                            text(_UPDATE_NDC11_SQL),
                            {"ndc11": new_ndc11, "pill_id": pill_id},
                        )
                    _write_log(
                        conn,
                        pill_id=pill_id,
                        medicine_name=medicine_name,
                        old_rxcui=old_rxcui,
                        new_rxcui=new_rxcui,
                        old_ndc11=old_ndc11,
                        new_ndc11=new_ndc11,
                        padded_ndc9=padded_ndc9,
                        confidence=confidence,
                        outcome=final_outcome,
                        notes=result.get("notes"),
                    )
                counters["written"] += 1
                logger.info(
                    "✓ %s (%s) rxcui=%s ndc11=%s [%s]",
                    medicine_name,
                    pill_id,
                    new_rxcui,
                    new_ndc11,
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
                            new_ndc11=new_ndc11,
                            padded_ndc9=padded_ndc9,
                            confidence="ERROR",
                            outcome="api_error",
                            notes=f"DB write failed: {exc}",
                        )
                except Exception:
                    pass
        else:
            # Log-only (dry-run, skipped, errors, no_match)
            if not args.dry_run:
                try:
                    with db_engine.begin() as conn:
                        _write_log(
                            conn,
                            pill_id=pill_id,
                            medicine_name=medicine_name,
                            old_rxcui=old_rxcui,
                            new_rxcui=new_rxcui,
                            old_ndc11=old_ndc11,
                            new_ndc11=new_ndc11,
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
                "ndc11": new_ndc11,
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
