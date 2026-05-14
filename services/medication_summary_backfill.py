from __future__ import annotations

import logging
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

import database
from services.medication_summary import generate_medication_summary

logger = logging.getLogger(__name__)


@dataclass
class MedicationSummaryBackfillResult:
    processed: int
    generated: int
    skipped_has_medguide: int
    skipped_missing_professional: int
    skipped_existing_summary: int
    errors: int
    slugs_for_indexnow: list[str]


def _connect_db() -> None:
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")


def _iter_rows(limit: int, offset: int):
    _connect_db()
    with database.db_engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    id,
                    rxcui,
                    ndc,
                    spl_set_id,
                    generic_name,
                    brand_name,
                    source_url,
                    professional_html,
                    medguide_html,
                    boxed_warning_html,
                    uses,
                    contraindications,
                    special_populations,
                    warnings,
                    dosage,
                    how_to_take,
                    side_effects,
                    interactions,
                    medication_summary_json,
                    medication_summary_html
                FROM public.medication_guide
                ORDER BY id ASC
                LIMIT :limit
                OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
        for row in rows:
            yield dict(row._mapping)


def _pillfinder_set_id_column(conn) -> str | None:
    row = conn.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pillfinder'
              AND column_name IN ('spl_set_id', 'setid', 'spl_set_id_value')
            ORDER BY CASE column_name
                WHEN 'spl_set_id' THEN 1
                WHEN 'setid' THEN 2
                WHEN 'spl_set_id_value' THEN 3
                ELSE 4
            END
            LIMIT 1
            """
        )
    ).fetchone()
    if not row:
        return None
    column_name = row[0]
    if column_name in {"spl_set_id", "setid", "spl_set_id_value"}:
        return column_name
    return None


def _resolve_slugs(conn, *, rxcui: str | None, ndc: str | None, spl_set_id: str | None) -> list[str]:
    if not any([rxcui, ndc, spl_set_id]):
        return []

    set_id_column = _pillfinder_set_id_column(conn)
    ndc_match_clause = """
    :ndc <> ''
    AND (
        p.ndc11 = :ndc
        OR p.ndc9 = :ndc
        OR REPLACE(COALESCE(p.ndc11, ''), '-', '') = :clean_ndc
        OR REPLACE(COALESCE(p.ndc9, ''), '-', '') = :clean_ndc
    )
    """
    match_clauses = []
    rank_clauses = []
    if set_id_column:
        match_clauses.append(f"(:spl_set_id <> '' AND p.{set_id_column} = :spl_set_id)")
        rank_clauses.append(f"WHEN :spl_set_id <> '' AND p.{set_id_column} = :spl_set_id THEN 1")
        rxcui_rank = 2
        ndc_rank = 3
    else:
        rxcui_rank = 1
        ndc_rank = 2
    match_clauses.append("(:rxcui <> '' AND p.rxcui = :rxcui)")
    rank_clauses.append(f"WHEN :rxcui <> '' AND p.rxcui = :rxcui THEN {rxcui_rank}")
    match_clauses.append(f"({ndc_match_clause})")
    rank_clauses.append(f"WHEN {ndc_match_clause} THEN {ndc_rank}")

    where_match_sql = "\n                 OR ".join(match_clauses)
    rank_sql = "\n                        ".join(rank_clauses)
    result = conn.execute(
        text(
            f"""
            SELECT p.slug
            FROM public.pillfinder p
            WHERE p.deleted_at IS NULL
              AND p.published = true
              AND p.slug IS NOT NULL
              AND (
                    {where_match_sql}
              )
            GROUP BY p.slug
            ORDER BY MIN(
                CASE
                    {rank_sql}
                    ELSE 999
                END
            ), p.slug
            """
        ),
        {
            "spl_set_id": (spl_set_id or "").strip(),
            "rxcui": (rxcui or "").strip(),
            "ndc": (ndc or "").strip(),
            "clean_ndc": (ndc or "").replace("-", ""),
        },
    )
    return [row[0] for row in result if row[0]]


def run_medication_summary_backfill(
    *,
    limit: int = 100,
    offset: int = 0,
    dry_run: bool = False,
    force: bool = False,
) -> MedicationSummaryBackfillResult:
    generated = 0
    processed = 0
    skipped_has_medguide = 0
    skipped_missing_professional = 0
    skipped_existing_summary = 0
    errors = 0
    changed_slugs: set[str] = set()

    _connect_db()

    for row in _iter_rows(limit, offset):
        processed += 1
        try:
            medguide_html = (row.get("medguide_html") or "").strip()
            professional_html = (row.get("professional_html") or "").strip()
            summary_html = (row.get("medication_summary_html") or "").strip()

            if medguide_html:
                skipped_has_medguide += 1
                continue
            if not professional_html:
                skipped_missing_professional += 1
                continue
            if summary_html and not force:
                skipped_existing_summary += 1
                continue

            summary_json, summary_rendered_html = generate_medication_summary(row)
            generated += 1

            if not dry_run:
                with database.db_engine.begin() as conn:
                    conn.execute(
                        text(
                            """
                            UPDATE public.medication_guide
                            SET
                                medication_summary_json = CAST(:summary_json AS JSONB),
                                medication_summary_html = :summary_html,
                                medication_summary_source = :summary_source,
                                medication_summary_generated_at = :generated_at,
                                updated_at = :updated_at
                            WHERE id = :id
                            """
                        ),
                        {
                            "id": row["id"],
                            "summary_json": json.dumps(summary_json),
                            "summary_html": summary_rendered_html,
                            "summary_source": "fda_dailymed_professional_label",
                            "generated_at": datetime.now(timezone.utc),
                            "updated_at": datetime.now(timezone.utc),
                        },
                    )

                try:
                    with database.db_engine.connect() as conn:
                        slugs = _resolve_slugs(
                            conn,
                            rxcui=row.get("rxcui"),
                            ndc=row.get("ndc"),
                            spl_set_id=row.get("spl_set_id"),
                        )
                    changed_slugs.update(slugs)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Medication summary backfill slug resolution failed for row id=%s (%s): %s",
                        row.get("id"),
                        type(exc).__name__,
                        exc,
                    )

        except SQLAlchemyError as exc:
            errors += 1
            logger.exception("Medication summary backfill database error for row id=%s: %s", row.get("id"), exc)
        except (TypeError, ValueError, KeyError) as exc:
            errors += 1
            logger.exception(
                "Medication summary backfill data error for row id=%s (%s): %s",
                row.get("id"),
                type(exc).__name__,
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            errors += 1
            logger.exception(
                "Medication summary backfill unexpected error for row id=%s (%s): %s",
                row.get("id"),
                type(exc).__name__,
                exc,
            )

    return MedicationSummaryBackfillResult(
        processed=processed,
        generated=generated,
        skipped_has_medguide=skipped_has_medguide,
        skipped_missing_professional=skipped_missing_professional,
        skipped_existing_summary=skipped_existing_summary,
        errors=errors,
        slugs_for_indexnow=sorted(changed_slugs),
    )
