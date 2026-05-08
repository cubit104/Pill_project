"""Medication guide backfill runner shared by CLI and admin endpoint."""

from __future__ import annotations

import asyncio
import csv
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy import text

import database
from services.medication_guide import GuideNotFoundError, build_guide

logger = logging.getLogger(__name__)

SECTION_KEYS = [
    "overview",
    "uses",
    "dosage",
    "how_to_take",
    "side_effects",
    "warnings",
    "interactions",
    "contraindications",
    "special_populations",
    "overdose",
    "storage",
    "pharmacology",
    "manufacturer",
]


@dataclass
class BackfillProgress:
    processed: int
    total: int
    last_pill_id: int
    last_status: str


@dataclass
class BackfillSummary:
    total_pills: int
    processed: int
    complete: int
    partial: int
    not_found: int
    skipped: int
    errors: int
    duration_seconds: float
    report_paths: dict[str, str]


def _connect_db() -> None:
    if not database.db_engine and not database.connect_to_database():
        raise RuntimeError("Database connection not available")


def _pillfinder_has_rxcui(conn) -> bool:
    row = conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pillfinder'
              AND column_name = 'rxcui'
            LIMIT 1
            """
        )
    ).fetchone()
    return bool(row)


def _load_published_pills(limit: Optional[int]) -> list[dict[str, Any]]:
    _connect_db()
    with database.db_engine.connect() as conn:
        has_rxcui = _pillfinder_has_rxcui(conn)
        if not has_rxcui:
            logger.warning("pillfinder.rxcui column not found; falling back to NDC-only backfill")

        if has_rxcui:
            sql = """
                SELECT id, slug, medicine_name, ndc11, rxcui
                FROM public.pillfinder
                WHERE published = TRUE
                ORDER BY id ASC
            """
        else:
            sql = """
                SELECT id, slug, medicine_name, ndc11, NULL::text AS rxcui
                FROM public.pillfinder
                WHERE published = TRUE
                ORDER BY id ASC
            """
        params: dict[str, Any] = {}
        if limit is not None:
            sql += "\nLIMIT :limit"
            params["limit"] = limit

        rows = conn.execute(text(sql), params).fetchall()
        return [dict(row._mapping) for row in rows]


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _safe_pill_id(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _emit_progress(
    callback: Optional[Callable[[BackfillProgress], None]],
    *,
    processed: int,
    total: int,
    pill_id: Any,
    status: str,
) -> None:
    if callback is None:
        return
    callback(
        BackfillProgress(
            processed=processed,
            total=total,
            last_pill_id=_safe_pill_id(pill_id),
            last_status=status,
        )
    )


async def run_backfill(
    *,
    limit: Optional[int] = None,
    dry_run: bool = False,
    force_refresh: bool = False,
    rate_limit_seconds: float = 0.25,
    report_dir: Optional[Path] = None,
    progress_callback: Optional[Callable[[BackfillProgress], None]] = None,
) -> BackfillSummary:
    start = time.monotonic()
    pills = _load_published_pills(limit)
    total = len(pills)

    complete_rows: list[dict[str, Any]] = []
    partial_rows: list[dict[str, Any]] = []
    not_found_rows: list[dict[str, Any]] = []
    errors_rows: list[dict[str, Any]] = []
    skipped_rows: list[dict[str, Any]] = []

    complete = partial = not_found = skipped = errors = 0
    processed = 0
    call_count = 0
    use_sleep = not bool(os.getenv("OPENFDA_API_KEY"))

    for pill in pills:
        processed += 1
        pill_id = pill.get("id")
        slug = pill.get("slug")
        medicine_name = pill.get("medicine_name")
        rxcui = pill.get("rxcui")
        ndc = pill.get("ndc11")

        if not rxcui and not ndc:
            skipped += 1
            skipped_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "medicine_name": medicine_name,
                    "rxcui": "",
                    "ndc": "",
                    "reason": "no rxcui or ndc",
                }
            )
            logger.info("Backfill skipped pill_id=%s slug=%s — no rxcui or ndc", pill_id, slug)
            _emit_progress(
                progress_callback,
                processed=processed,
                total=total,
                pill_id=pill_id,
                status="skipped",
            )
            if processed % 10 == 0 or processed == total:
                logger.info(
                    "Backfill progress: %d/%d (complete=%d, partial=%d, not_found=%d, errors=%d)",
                    processed,
                    total,
                    complete,
                    partial,
                    not_found,
                    errors,
                )
            continue

        if dry_run:
            complete += 1
            complete_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "medicine_name": medicine_name,
                    "rxcui": rxcui or "",
                    "ndc": ndc or "",
                    "brand_name": "would-fetch",
                    "generic_name": "would-fetch",
                }
            )
            logger.info(
                "Backfill dry-run would fetch pill_id=%s slug=%s rxcui=%s ndc=%s",
                pill_id,
                slug,
                rxcui,
                ndc,
            )
            _emit_progress(
                progress_callback,
                processed=processed,
                total=total,
                pill_id=pill_id,
                status="complete",
            )
            if processed % 10 == 0 or processed == total:
                logger.info(
                    "Backfill progress: %d/%d (complete=%d, partial=%d, not_found=%d, errors=%d)",
                    processed,
                    total,
                    complete,
                    partial,
                    not_found,
                    errors,
                )
            continue

        if use_sleep and call_count > 0 and rate_limit_seconds > 0:
            await asyncio.sleep(rate_limit_seconds)
        call_count += 1

        try:
            if rxcui:
                result = await build_guide(rxcui=str(rxcui), force_refresh=force_refresh)
            else:
                result = await build_guide(ndc=str(ndc), force_refresh=force_refresh)

            sections = result.get("sections") or {}
            missing_sections = [key for key in SECTION_KEYS if not sections.get(key)]
            row_base = {
                "pill_id": pill_id,
                "slug": slug,
                "medicine_name": medicine_name,
                "rxcui": result.get("rxcui") or rxcui or "",
                "ndc": result.get("ndc") or ndc or "",
                "brand_name": result.get("brand_name") or "",
                "generic_name": result.get("generic_name") or "",
            }

            if missing_sections:
                partial += 1
                partial_rows.append(
                    {
                        **row_base,
                        "missing_sections": ",".join(missing_sections),
                    }
                )
                status = "partial"
            else:
                complete += 1
                complete_rows.append(row_base)
                status = "complete"
        except GuideNotFoundError:
            not_found += 1
            not_found_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "medicine_name": medicine_name,
                    "rxcui": rxcui or "",
                    "ndc": ndc or "",
                    "brand_name": "",
                    "generic_name": "",
                }
            )
            status = "not_found"
        except Exception as exc:  # noqa: BLE001
            errors += 1
            errors_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                }
            )
            logger.exception("Backfill error pill_id=%s slug=%s: %s", pill_id, slug, exc)
            status = "error"

        _emit_progress(
            progress_callback,
            processed=processed,
            total=total,
            pill_id=pill_id,
            status=status,
        )

        if processed % 10 == 0 or processed == total:
            logger.info(
                "Backfill progress: %d/%d (complete=%d, partial=%d, not_found=%d, errors=%d)",
                processed,
                total,
                complete,
                partial,
                not_found,
                errors,
            )

    reports_root = report_dir or Path("./backfill_reports")
    reports_root.mkdir(parents=True, exist_ok=True)
    ts = _timestamp()

    complete_path = reports_root / f"complete-{ts}.csv"
    partial_path = reports_root / f"partial-{ts}.csv"
    not_found_path = reports_root / f"not_found-{ts}.csv"
    errors_path = reports_root / f"errors-{ts}.csv"
    skipped_path = reports_root / f"skipped-{ts}.csv"

    _write_csv(
        complete_path,
        ["pill_id", "slug", "medicine_name", "rxcui", "ndc", "brand_name", "generic_name"],
        complete_rows,
    )
    _write_csv(
        partial_path,
        [
            "pill_id",
            "slug",
            "medicine_name",
            "rxcui",
            "ndc",
            "brand_name",
            "generic_name",
            "missing_sections",
        ],
        partial_rows,
    )
    _write_csv(
        not_found_path,
        ["pill_id", "slug", "medicine_name", "rxcui", "ndc", "brand_name", "generic_name"],
        not_found_rows,
    )
    _write_csv(errors_path, ["pill_id", "slug", "error_type", "error_message"], errors_rows)
    _write_csv(skipped_path, ["pill_id", "slug", "medicine_name", "rxcui", "ndc", "reason"], skipped_rows)

    duration = time.monotonic() - start
    return BackfillSummary(
        total_pills=total,
        processed=processed,
        complete=complete,
        partial=partial,
        not_found=not_found,
        skipped=skipped,
        errors=errors,
        duration_seconds=duration,
        report_paths={
            "complete": str(complete_path),
            "partial": str(partial_path),
            "not_found": str(not_found_path),
            "errors": str(errors_path),
            "skipped": str(skipped_path),
        },
    )
