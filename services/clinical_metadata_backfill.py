"""Clinical metadata backfill service.

Fills missing clinical fields on ``pillfinder`` rows using openFDA drug
labels and (optionally) DailyMed SPL XML.  Values are written **only** to
columns that are currently NULL/empty — existing curated values are never
overwritten.

Target columns
--------------
dosage_form, route, rx_otc_status, dea_schedule, fda_pharma_class,
brand_names, active_ingredients, inactive_ingredients

Entry point
-----------
    from services.clinical_metadata_backfill import run_backfill
    summary = run_backfill(limit=50, dry_run=True)
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy import text

import database

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OPENFDA_LABEL_URL = "https://api.fda.gov/drug/label.json"
DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}.xml"
DAILYMED_SPL_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"

SYSTEM_ACTOR = "system:clinical_metadata_backfill"

# All target columns this service can populate
TARGET_COLUMNS: List[str] = [
    "dosage_form",
    "route",
    "rx_otc_status",
    "dea_schedule",
    "fda_pharma_class",
    "brand_names",
    "active_ingredients",
    "inactive_ingredients",
]

# Possible column names for the SPL set-id on pillfinder (varies by environment)
_SPL_SET_ID_CANDIDATES = ("spl_set_id", "setid", "spl_set_id_value")

# Prefixes to strip from inactive_ingredients text
_INACTIVE_PREFIXES_RE = re.compile(
    r"^inactive\s+ingredient(?:s)?:\s*",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Audit log DDL
# ---------------------------------------------------------------------------

_AUDIT_LOG_DDL = """
CREATE TABLE IF NOT EXISTS clinical_metadata_backfill_log (
    id            SERIAL PRIMARY KEY,
    pill_id       UUID NOT NULL,
    medicine_name TEXT,
    rxcui         TEXT,
    ndc11         TEXT,
    changes       JSONB,
    match_source  TEXT,
    outcome       TEXT,
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
"""

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _fetch_json(
    url: str,
    params: Optional[Dict] = None,
    timeout: int = 30,
    client: Optional[httpx.Client] = None,
) -> Optional[Dict]:
    """GET *url*, return parsed JSON or None on any error."""
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


def _fetch_xml(
    url: str,
    timeout: int = 30,
    client: Optional[httpx.Client] = None,
) -> Optional[ET.Element]:
    """GET *url*, return parsed XML root or None on any error."""
    _close = client is None
    if _close:
        client = httpx.Client(timeout=timeout)
    try:
        for attempt in range(2):
            try:
                resp = client.get(url)
                if resp.status_code == 200:
                    try:
                        return ET.fromstring(resp.content)
                    except ET.ParseError as exc:
                        logger.warning("XML parse error from %s: %s", url, exc)
                        return None
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
# openFDA fetch
# ---------------------------------------------------------------------------


def fetch_openfda_label_by_rxcui(
    rxcui: str,
    client: Optional[httpx.Client] = None,
) -> Optional[Dict]:
    """Fetch the first openFDA drug label matching *rxcui*."""
    data = _fetch_json(
        OPENFDA_LABEL_URL,
        params={"search": f"openfda.rxcui:{rxcui}", "limit": 1},
        client=client,
    )
    if data and data.get("results"):
        return data["results"][0]
    return None


def fetch_openfda_label_by_ndc(
    ndc11: str,
    client: Optional[httpx.Client] = None,
) -> Optional[Dict]:
    """Fetch the first openFDA drug label matching *ndc11*."""
    # Try both with and without dashes; openFDA accepts both
    for ndc_val in [ndc11, ndc11.replace("-", "")]:
        data = _fetch_json(
            OPENFDA_LABEL_URL,
            params={"search": f"openfda.package_ndc:{ndc_val}", "limit": 1},
            client=client,
        )
        if data and data.get("results"):
            return data["results"][0]
    return None


# ---------------------------------------------------------------------------
# DailyMed SPL fetch (for active ingredients)
# ---------------------------------------------------------------------------


def _resolve_setid_for_rxcui(
    rxcui: str,
    client: Optional[httpx.Client] = None,
) -> Optional[str]:
    """Return the first DailyMed setid for *rxcui* (or None)."""
    data = _fetch_json(
        DAILYMED_SPL_URL,
        params={"rxcui": rxcui, "pagesize": 1},
        client=client,
    )
    if data and data.get("data"):
        return data["data"][0].get("setid")
    return None


def fetch_dailymed_spl_xml(
    setid: str,
    client: Optional[httpx.Client] = None,
) -> Optional[ET.Element]:
    """Fetch DailyMed SPL XML root for *setid*."""
    url = DAILYMED_SPL_XML_URL.format(setid=setid)
    return _fetch_xml(url, client=client)


# ---------------------------------------------------------------------------
# Field mapping helpers
# ---------------------------------------------------------------------------


def _openfda_str(label: Dict, key: str, index: int = 0) -> Optional[str]:
    """Return label['openfda'][key][index] as a stripped string or None."""
    openfda = label.get("openfda") or {}
    val_list = openfda.get(key)
    if not isinstance(val_list, list) or not val_list:
        return None
    val = val_list[index] if index < len(val_list) else None
    if not val:
        return None
    return str(val).strip() or None


def map_dosage_form(label: Dict) -> Optional[str]:
    val = _openfda_str(label, "dosage_form")
    return val.title() if val else None


def map_route(label: Dict) -> Optional[str]:
    val = _openfda_str(label, "route")
    return val.title() if val else None


def map_rx_otc_status(label: Dict) -> Optional[str]:
    val = _openfda_str(label, "product_type")
    if not val:
        return None
    upper = val.upper()
    if "PRESCRIPTION" in upper:
        return "Rx"
    if "OTC" in upper:
        return "OTC"
    return None


def map_dea_schedule(label: Dict) -> Optional[str]:
    return _openfda_str(label, "dea_schedule")


def map_fda_pharma_class(label: Dict) -> Optional[str]:
    return _openfda_str(label, "pharm_class_epc")


def map_brand_names(label: Dict) -> Optional[str]:
    val = _openfda_str(label, "brand_name")
    return val.title() if val else None


def map_active_ingredients(
    label: Dict,
    spl_root: Optional[ET.Element] = None,
) -> Optional[str]:
    """Comma-separated active ingredients.

    Tries DailyMed SPL ``<activeMoiety>`` first; falls back to
    ``openfda.substance_name``.
    """
    if spl_root is not None:
        names: List[str] = []
        for elem in spl_root.iter():
            # Look for activeMoiety regardless of namespace
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            if tag == "activeMoiety":
                name_elem = None
                for child in elem:
                    child_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                    if child_tag == "name":
                        name_elem = child
                        break
                if name_elem is not None and name_elem.text:
                    val = name_elem.text.strip()
                    if val:
                        names.append(val)
        if names:
            return ", ".join(names)

    # Fallback: openfda.substance_name
    openfda = label.get("openfda") or {}
    substances = openfda.get("substance_name")
    if isinstance(substances, list) and substances:
        return ", ".join(s.strip() for s in substances if s.strip())
    return None


def map_inactive_ingredients(label: Dict) -> Optional[str]:
    """Plain-text inactive ingredients, with leading prefix stripped."""
    raw_list = label.get("inactive_ingredient")
    if not isinstance(raw_list, list) or not raw_list:
        return None
    raw = raw_list[0] if raw_list else ""
    if not raw:
        return None
    raw = raw.strip()
    # Strip leading "Inactive ingredients: " / "Inactive Ingredient: " etc.
    raw = _INACTIVE_PREFIXES_RE.sub("", raw, count=1)
    # Collapse internal whitespace
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw or None


# ---------------------------------------------------------------------------
# Column existence check
# ---------------------------------------------------------------------------


def _get_existing_columns(conn) -> List[str]:
    """Return the list of columns that actually exist on public.pillfinder."""
    rows = conn.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'pillfinder'
            """
        )
    ).fetchall()
    return [r[0] for r in rows]


def _resolve_spl_set_id_column(existing_cols: List[str]) -> Optional[str]:
    """Return the first present SPL set-id column name, or None.

    Different environments store the SPL set-id under different column names
    (``spl_set_id``, ``setid``, ``spl_set_id_value``). We probe in priority
    order and return whichever is present. If none exist, we still proceed —
    the script just won't be able to use a pre-stored setid to short-circuit
    DailyMed lookups.
    """
    for candidate in _SPL_SET_ID_CANDIDATES:
        if candidate in existing_cols:
            return candidate
    return None


# ---------------------------------------------------------------------------
# Audit log helpers
# ---------------------------------------------------------------------------


def _ensure_audit_table(conn) -> None:
    conn.execute(text(_AUDIT_LOG_DDL))


def _write_audit_log(
    conn,
    *,
    pill_id: str,
    medicine_name: Optional[str],
    rxcui: Optional[str],
    ndc11: Optional[str],
    changes: Dict,
    match_source: str,
    outcome: str,
    notes: Optional[str] = None,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO clinical_metadata_backfill_log
                (pill_id, medicine_name, rxcui, ndc11, changes, match_source, outcome, notes)
            VALUES
                (:pill_id, :medicine_name, :rxcui, :ndc11,
                 CAST(:changes AS JSONB), :match_source, :outcome, :notes)
            """
        ),
        {
            "pill_id": pill_id,
            "medicine_name": medicine_name,
            "rxcui": rxcui,
            "ndc11": ndc11,
            "changes": json.dumps(changes),
            "match_source": match_source,
            "outcome": outcome,
            "notes": notes,
        },
    )


# ---------------------------------------------------------------------------
# Per-row logic
# ---------------------------------------------------------------------------


def _build_null_check(active_columns: List[str]) -> str:
    """Return SQL fragment: (col1 IS NULL OR TRIM(col1) = '') OR ..."""
    parts = []
    for col in active_columns:
        parts.append(f"({col} IS NULL OR TRIM({col}::text) = '')")
    return " OR ".join(parts)


def _is_empty(val: Any) -> bool:
    """Return True if *val* is considered NULL/empty."""
    if val is None:
        return True
    return str(val).strip() == ""


def process_pill_row(
    row: Dict,
    *,
    active_columns: List[str],
    match_mode: str = "auto",
    sleep_ms: int = 250,
    client: Optional[httpx.Client] = None,
) -> Dict:
    """Process one pillfinder row.  Returns outcome dict (never raises)."""
    pill_id = str(row["id"])
    medicine_name = (row.get("medicine_name") or "").strip()
    rxcui = (row.get("rxcui") or "").strip() or None
    ndc11 = (row.get("ndc11") or "").strip() or None
    spl_set_id = (row.get("spl_set_id") or "").strip() or None

    result: Dict[str, Any] = {
        "pill_id": pill_id,
        "medicine_name": medicine_name,
        "rxcui": rxcui,
        "ndc11": ndc11,
        "outcome": "no_match",
        "match_source": "none",
        "updates": {},
        "error": None,
    }

    try:
        # ------------------------------------------------------------------
        # 1. Fetch openFDA label
        # ------------------------------------------------------------------
        label: Optional[Dict] = None
        match_source = "none"

        if match_mode in ("rxcui", "auto") and rxcui:
            label = fetch_openfda_label_by_rxcui(rxcui, client=client)
            if label:
                match_source = "openfda_rxcui"
            if sleep_ms:
                time.sleep(sleep_ms / 1000)

        if label is None and match_mode in ("ndc", "auto") and ndc11:
            label = fetch_openfda_label_by_ndc(ndc11, client=client)
            if label:
                match_source = "openfda_ndc"
            if sleep_ms:
                time.sleep(sleep_ms / 1000)

        if label is None:
            result["outcome"] = "no_match"
            result["match_source"] = "none"
            return result

        # ------------------------------------------------------------------
        # 2. Optionally fetch DailyMed SPL XML (for active_ingredients)
        # ------------------------------------------------------------------
        spl_root: Optional[ET.Element] = None
        needs_active = (
            "active_ingredients" in active_columns
            and _is_empty(row.get("active_ingredients"))
        )
        if needs_active:
            resolved_setid = spl_set_id
            if not resolved_setid and rxcui:
                resolved_setid = _resolve_setid_for_rxcui(rxcui, client=client)
                if sleep_ms:
                    time.sleep(sleep_ms / 1000)
            if resolved_setid:
                spl_root = fetch_dailymed_spl_xml(resolved_setid, client=client)
                if spl_root is not None:
                    match_source = "dailymed_spl"
                if sleep_ms:
                    time.sleep(sleep_ms / 1000)

        # ------------------------------------------------------------------
        # 3. Build updates dict — only NULL/empty fields
        # ------------------------------------------------------------------
        mappers = {
            "dosage_form": lambda: map_dosage_form(label),
            "route": lambda: map_route(label),
            "rx_otc_status": lambda: map_rx_otc_status(label),
            "dea_schedule": lambda: map_dea_schedule(label),
            "fda_pharma_class": lambda: map_fda_pharma_class(label),
            "brand_names": lambda: map_brand_names(label),
            "active_ingredients": lambda: map_active_ingredients(label, spl_root),
            "inactive_ingredients": lambda: map_inactive_ingredients(label),
        }

        updates: Dict[str, Dict] = {}
        for col in active_columns:
            if col not in mappers:
                continue
            old_val = row.get(col)
            if not _is_empty(old_val):
                # Already populated — skip
                continue
            new_val = mappers[col]()
            if new_val is not None:
                updates[col] = {"old": old_val, "new": new_val}

        result["updates"] = updates
        result["match_source"] = match_source

        if not updates:
            result["outcome"] = "already_populated"
        else:
            result["outcome"] = "updated"

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Error processing pill %s: %s", pill_id, exc, exc_info=True)
        result["outcome"] = "api_error"
        result["error"] = str(exc)

    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run_backfill(
    *,
    limit: int = 10,
    offset: int = 0,
    dry_run: bool = False,
    sleep_ms: int = 250,
    only_fields: Optional[List[str]] = None,
    match_mode: str = "auto",
) -> Dict[str, Any]:
    """Run the clinical metadata backfill for up to *limit* rows.

    Parameters
    ----------
    limit:        Max rows to process.
    offset:       Skip first N candidate rows.
    dry_run:      If True, log diffs but write nothing.
    sleep_ms:     Milliseconds to sleep between API calls per row.
    only_fields:  If set, restrict updates to these column names only.
    match_mode:   "rxcui" | "ndc" | "auto".

    Returns
    -------
    dict with keys: processed, updated, skipped_no_match,
    skipped_already_populated, errors, dry_run, (rows in dry_run mode)
    """
    if not database.db_engine:
        if not database.connect_to_database():
            raise RuntimeError("Database connection not available")

    # ------------------------------------------------------------------
    # Determine which columns actually exist in this environment
    # ------------------------------------------------------------------
    with database.db_engine.connect() as conn:
        existing_cols = _get_existing_columns(conn)

    requested = only_fields if only_fields else TARGET_COLUMNS
    active_columns: List[str] = []
    for col in requested:
        if col not in TARGET_COLUMNS:
            logger.warning("Unknown field %r — skipping", col)
            continue
        if col not in existing_cols:
            logger.warning("Column %r does not exist on pillfinder — skipping", col)
            continue
        active_columns.append(col)

    if not active_columns:
        logger.warning("No active columns to update — aborting backfill")
        return {
            "processed": 0,
            "updated": 0,
            "skipped_no_match": 0,
            "skipped_already_populated": 0,
            "errors": 0,
            "dry_run": dry_run,
        }

    # ------------------------------------------------------------------
    # Resolve SPL set-id column name for this environment (may be absent).
    # ------------------------------------------------------------------
    spl_set_id_col = _resolve_spl_set_id_column(existing_cols)
    if spl_set_id_col is None:
        logger.info(
            "No SPL set-id column found on pillfinder (looked for %s); "
            "active_ingredients lookups will fall back to RxCUI-only resolution.",
            ", ".join(_SPL_SET_ID_CANDIDATES),
        )

    # ------------------------------------------------------------------
    # Ensure audit log table exists
    # ------------------------------------------------------------------
    with database.db_engine.begin() as conn:
        _ensure_audit_table(conn)

    # ------------------------------------------------------------------
    # Determine which columns to SELECT (only the ones we need)
    # ------------------------------------------------------------------
    base_cols = ["id", "medicine_name", "rxcui", "ndc11"]
    if spl_set_id_col:
        # Alias to a stable name 'spl_set_id' so downstream code can read row['spl_set_id']
        select_clause_extras = [f"{spl_set_id_col} AS spl_set_id"]
        select_cols_for_unpack = base_cols + ["spl_set_id"] + active_columns
    else:
        select_clause_extras = ["NULL::text AS spl_set_id"]
        select_cols_for_unpack = base_cols + ["spl_set_id"] + active_columns

    # De-duplicate active_columns from base while preserving order for the unpacking list
    seen: set = set()
    unique_unpack: List[str] = []
    for c in select_cols_for_unpack:
        if c not in seen:
            seen.add(c)
            unique_unpack.append(c)

    # Build the SELECT clause string (use the bare column names plus the extras)
    seen2: set = set()
    select_clause_parts: List[str] = []
    for c in base_cols:
        if c not in seen2:
            seen2.add(c)
            select_clause_parts.append(c)
    for extra in select_clause_extras:
        select_clause_parts.append(extra)
    for c in active_columns:
        if c not in seen2 and c != "spl_set_id":
            seen2.add(c)
            select_clause_parts.append(c)

    null_check = _build_null_check(active_columns)
    row_sql = f"""
        SELECT {', '.join(select_clause_parts)}
        FROM pillfinder
        WHERE deleted_at IS NULL
          AND ({null_check})
        ORDER BY updated_at DESC NULLS LAST
        LIMIT :limit OFFSET :offset
    """

    with database.db_engine.connect() as conn:
        db_rows = conn.execute(
            text(row_sql),
            {"limit": limit, "offset": offset},
        ).fetchall()

    pill_rows = [dict(zip(unique_unpack, r)) for r in db_rows]

    summary: Dict[str, Any] = {
        "processed": 0,
        "updated": 0,
        "skipped_no_match": 0,
        "skipped_already_populated": 0,
        "errors": 0,
        "dry_run": dry_run,
    }
    if dry_run:
        summary["rows"] = []

    with httpx.Client(timeout=30) as http_client:
        for row in pill_rows:
            summary["processed"] += 1
            result = process_pill_row(
                row,
                active_columns=active_columns,
                match_mode=match_mode,
                sleep_ms=sleep_ms,
                client=http_client,
            )
            outcome = result["outcome"]
            pill_id = result["pill_id"]

            if outcome == "updated":
                if dry_run:
                    summary["updated"] += 1
                    dry_row = {
                        "pill_id": pill_id,
                        "medicine_name": result.get("medicine_name"),
                        "outcome": "dry_run",
                        "changes": result["updates"],
                        "match_source": result["match_source"],
                    }
                    logger.info("DRY-RUN pill %s changes: %s", pill_id, json.dumps(result["updates"]))
                    summary["rows"].append(dry_row)
                else:
                    try:
                        with database.db_engine.begin() as conn:
                            _ensure_audit_table(conn)
                            # Build SET clause from updates
                            set_parts = []
                            params: Dict[str, Any] = {"pill_id": pill_id}
                            for col, diff in result["updates"].items():
                                set_parts.append(f"{col} = :{col}")
                                params[col] = diff["new"]

                            if set_parts:
                                update_sql = (
                                    f"UPDATE pillfinder SET {', '.join(set_parts)}, updated_at = now() "
                                    f"WHERE id = :pill_id"
                                )
                                conn.execute(text(update_sql), params)

                            _write_audit_log(
                                conn,
                                pill_id=pill_id,
                                medicine_name=result.get("medicine_name"),
                                rxcui=result.get("rxcui"),
                                ndc11=result.get("ndc11"),
                                changes=result["updates"],
                                match_source=result["match_source"],
                                outcome="updated",
                            )
                        summary["updated"] += 1
                    except Exception as exc:
                        logger.error("DB write error for pill %s: %s", pill_id, exc)
                        summary["errors"] += 1

            elif outcome == "no_match":
                summary["skipped_no_match"] += 1
                logger.info("Pill %s → no_match", pill_id)

            elif outcome == "already_populated":
                summary["skipped_already_populated"] += 1
                logger.info("Pill %s → already_populated", pill_id)

            elif outcome == "api_error":
                summary["errors"] += 1
                logger.warning(
                    "Pill %s → api_error: %s",
                    pill_id,
                    result.get("error", "")[:200],
                )

            else:
                logger.warning("Pill %s → unknown outcome %r", pill_id, outcome)

    return summary
