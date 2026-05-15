"""Backfill missing medication_guide ndc/rxcui values from pillfinder."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from sqlalchemy import text

import database
from ndc_normalize import normalize_ndc_to_11

logger = logging.getLogger(__name__)
# Keep audit-log error notes short enough to stay readable in the admin/SQL view.
MAX_ERROR_MESSAGE_LENGTH = 500

SELECT_CANDIDATE_ROWS_SQL = """
    SELECT id, ndc, rxcui, spl_set_id
    FROM medication_guide
    WHERE (ndc IS NULL OR TRIM(ndc) = '')
       OR (rxcui IS NULL OR TRIM(rxcui) = '')
    ORDER BY id
    LIMIT :limit OFFSET :offset
"""

MATCH_BY_SPL_SET_ID_SQL = """
    SELECT id, ndc11, rxcui, spl_set_id
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND spl_set_id = :spl_set_id
    ORDER BY id
    LIMIT 1
"""

MATCH_BY_RXCUI_SQL = """
    SELECT id, ndc11, rxcui, spl_set_id
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND rxcui = :rxcui
    ORDER BY id
    LIMIT 1
"""

MATCH_BY_NDC11_SQL = """
    SELECT id, ndc11, rxcui, spl_set_id
    FROM pillfinder
    WHERE deleted_at IS NULL
      AND ndc11 = :ndc11
    ORDER BY id
    LIMIT 1
"""

CREATE_LOG_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS medication_guide_identifier_backfill_log (
      id SERIAL PRIMARY KEY,
      medication_guide_id INT,
      old_ndc TEXT,
      new_ndc TEXT,
      old_rxcui TEXT,
      new_rxcui TEXT,
      match_source TEXT,
      outcome TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
"""

UPDATE_NDC_SQL = """
    UPDATE medication_guide
    SET ndc = :ndc,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :medication_guide_id
      AND (ndc IS NULL OR TRIM(ndc) = '')
"""

UPDATE_RXCUI_SQL = """
    UPDATE medication_guide
    SET rxcui = :rxcui,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :medication_guide_id
      AND (rxcui IS NULL OR TRIM(rxcui) = '')
"""

INSERT_LOG_SQL = """
    INSERT INTO medication_guide_identifier_backfill_log (
      medication_guide_id,
      old_ndc,
      new_ndc,
      old_rxcui,
      new_rxcui,
      match_source,
      outcome,
      notes
    )
    VALUES (
      :medication_guide_id,
      :old_ndc,
      :new_ndc,
      :old_rxcui,
      :new_rxcui,
      :match_source,
      :outcome,
      :notes
    )
"""


def _nonempty_identifier(value: Any) -> Optional[str]:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _row_as_dict(row: Any) -> dict[str, Any]:
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return dict(mapping)
    if isinstance(row, dict):
        return dict(row)
    raise TypeError(f"Unsupported row type: {type(row)!r}")


def _select_candidate_rows(conn, *, limit: int, offset: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(SELECT_CANDIDATE_ROWS_SQL),
        {"limit": limit, "offset": offset},
    ).fetchall()
    return [_row_as_dict(row) for row in rows]


def _find_pillfinder_match(conn, medication_guide_row: dict[str, Any]) -> tuple[str, Optional[dict[str, Any]]]:
    spl_set_id = _nonempty_identifier(medication_guide_row.get("spl_set_id"))
    if spl_set_id:
        row = conn.execute(text(MATCH_BY_SPL_SET_ID_SQL), {"spl_set_id": spl_set_id}).fetchone()
        if row:
            return ("spl_set_id", _row_as_dict(row))

    rxcui = _nonempty_identifier(medication_guide_row.get("rxcui"))
    if rxcui:
        row = conn.execute(text(MATCH_BY_RXCUI_SQL), {"rxcui": rxcui}).fetchone()
        if row:
            return ("rxcui", _row_as_dict(row))

    normalized_ndc = normalize_ndc_to_11(
        _nonempty_identifier(medication_guide_row.get("ndc")) or ""
    )
    if normalized_ndc:
        row = conn.execute(text(MATCH_BY_NDC11_SQL), {"ndc11": normalized_ndc}).fetchone()
        if row:
            return ("ndc11", _row_as_dict(row))

    return ("none", None)


def _insert_log(conn, entry: dict[str, Any]) -> None:
    conn.execute(text(INSERT_LOG_SQL), entry)


def _process_row(conn, medication_guide_row: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    old_ndc = _nonempty_identifier(medication_guide_row.get("ndc"))
    old_rxcui = _nonempty_identifier(medication_guide_row.get("rxcui"))

    result: dict[str, Any] = {
        "medication_guide_id": medication_guide_row["id"],
        "old_ndc": old_ndc,
        "new_ndc": old_ndc,
        "old_rxcui": old_rxcui,
        "new_rxcui": old_rxcui,
        "match_source": "none",
        "outcome": "already_populated",
        "notes": "",
    }

    try:
        match_source, pillfinder_row = _find_pillfinder_match(conn, medication_guide_row)
        result["match_source"] = match_source
        if pillfinder_row is None:
            result["outcome"] = "no_pillfinder_match"
            result["notes"] = "No pillfinder row matched by spl_set_id, rxcui, or ndc11."
            return result

        matched_ndc = _nonempty_identifier(pillfinder_row.get("ndc11"))
        matched_rxcui = _nonempty_identifier(pillfinder_row.get("rxcui"))

        wants_ndc = old_ndc is None and matched_ndc is not None
        wants_rxcui = old_rxcui is None and matched_rxcui is not None

        result["new_ndc"] = matched_ndc if wants_ndc else old_ndc
        result["new_rxcui"] = matched_rxcui if wants_rxcui else old_rxcui

        if not wants_ndc and not wants_rxcui:
            result["outcome"] = "already_populated"
            result["notes"] = "Matched pillfinder row had no missing identifiers to fill."
            if not dry_run:
                _insert_log(conn, result)
            return result

        notes: list[str] = []
        if wants_ndc:
            notes.append("fill ndc from pillfinder.ndc11")
        if wants_rxcui:
            notes.append("fill rxcui from pillfinder.rxcui")
        result["notes"] = "; ".join(notes)

        if dry_run:
            result["outcome"] = "dry_run"
            return result

        if wants_ndc:
            conn.execute(
                text(UPDATE_NDC_SQL),
                {
                    "medication_guide_id": medication_guide_row["id"],
                    "ndc": matched_ndc,
                },
            )
        if wants_rxcui:
            conn.execute(
                text(UPDATE_RXCUI_SQL),
                {
                    "medication_guide_id": medication_guide_row["id"],
                    "rxcui": matched_rxcui,
                },
            )

        result["outcome"] = "updated"
        _insert_log(conn, result)
        return result
    except Exception as exc:
        # Keep the batch running: one bad row should be logged, not abort the whole backfill.
        logger.exception(
            "Medication guide identifier backfill failed for medication_guide_id=%s",
            medication_guide_row.get("id"),
        )
        result["outcome"] = "error"
        result["notes"] = str(exc)[:MAX_ERROR_MESSAGE_LENGTH]
        if not dry_run:
            _insert_log(conn, result)
        return result


def run_backfill(
    *,
    limit: int = 10,
    offset: int = 0,
    dry_run: bool = False,
    sleep_ms: int = 250,
) -> dict[str, Any]:
    """Backfill missing medication_guide identifiers from pillfinder."""
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")

    logger.info(
        "Starting medication guide identifier backfill: dry_run=%s limit=%d offset=%d sleep_ms=%d",
        dry_run,
        limit,
        offset,
        sleep_ms,
    )

    summary = {
        "processed": 0,
        "updated": 0,
        "already_populated": 0,
        "no_pillfinder_match": 0,
        "errors": 0,
        "dry_run": dry_run,
        "rows": [],
    }

    # Dry runs should not open a write transaction; live runs should commit the whole batch together.
    context_factory = database.db_engine.connect if dry_run else database.db_engine.begin
    with context_factory() as conn:
        if not dry_run:
            conn.execute(text(CREATE_LOG_TABLE_SQL))

        rows = _select_candidate_rows(conn, limit=limit, offset=offset)
        for index, row in enumerate(rows):
            result = _process_row(conn, row, dry_run=dry_run)
            summary["processed"] += 1
            summary["rows"].append(result)

            outcome = result["outcome"]
            if outcome == "updated":
                summary["updated"] += 1
            elif outcome == "already_populated":
                summary["already_populated"] += 1
            elif outcome == "no_pillfinder_match":
                summary["no_pillfinder_match"] += 1
            elif outcome == "error":
                summary["errors"] += 1

            if sleep_ms and index < len(rows) - 1:
                time.sleep(sleep_ms / 1000)

    logger.info(
        "Medication guide identifier backfill done: %s",
        json.dumps(
            {
                "processed": summary["processed"],
                "updated": summary["updated"],
                "already_populated": summary["already_populated"],
                "no_pillfinder_match": summary["no_pillfinder_match"],
                "errors": summary["errors"],
                "dry_run": summary["dry_run"],
            }
        ),
    )
    return summary
