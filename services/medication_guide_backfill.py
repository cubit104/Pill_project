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
from services.medication_guide import GuideNotFoundError, GuideValidationError, build_guide

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
    matched: int
    complete: int
    partial: int
    not_found: int
    skipped: int
    errors: int
    professional_found: int
    medguide_found: int
    boxed_warning_found: int
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


def _pillfinder_has_ndc9(conn) -> bool:
    row = conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pillfinder'
              AND column_name = 'ndc9'
            LIMIT 1
            """
        )
    ).fetchone()
    return bool(row)


def _pillfinder_has_spl_set_id(conn) -> bool:
    row = conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pillfinder'
              AND column_name = 'spl_set_id'
            LIMIT 1
            """
        )
    ).fetchone()
    return bool(row)


def _select_published_pills_sql(
    *,
    has_rxcui: bool,
    has_ndc9: bool,
    has_spl_set_id: bool,
    limit: Optional[int],
    offset: int,
    only_missing_professional: bool,
) -> tuple[str, dict[str, Any]]:
    spl_col = "spl_set_id" if has_spl_set_id else "NULL::text AS spl_set_id"
    rxcui_col = "rxcui" if has_rxcui else "NULL::text AS rxcui"
    ndc9_col = "ndc9" if has_ndc9 else "NULL::text AS ndc9"
    match_conditions = [
        """
        (
            pf.ndc11 IS NOT NULL
            AND TRIM(pf.ndc11) <> ''
            AND (
                mg.ndc = pf.ndc11
                OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = REPLACE(pf.ndc11, '-', '')
            )
        )
        """
    ]
    if has_spl_set_id:
        match_conditions.insert(
            0,
            """
            (
                pf.spl_set_id IS NOT NULL
                AND TRIM(pf.spl_set_id) <> ''
                AND mg.spl_set_id = pf.spl_set_id
            )
            """,
        )
    if has_rxcui:
        match_conditions.append(
            """
            (
                pf.rxcui IS NOT NULL
                AND TRIM(pf.rxcui) <> ''
                AND mg.rxcui = pf.rxcui
            )
            """
        )
    if has_ndc9:
        match_conditions.append(
            """
            (
                pf.ndc9 IS NOT NULL
                AND TRIM(pf.ndc9) <> ''
                AND (
                    mg.ndc = pf.ndc9
                    OR REPLACE(COALESCE(mg.ndc, ''), '-', '') = REPLACE(pf.ndc9, '-', '')
                )
            )
            """
        )
    matching_guide_sql = " OR ".join(f"({condition.strip()})" for condition in match_conditions)

    sql = f"""
        SELECT pf.id, pf.slug, pf.medicine_name, pf.ndc11, {ndc9_col}, {rxcui_col}, {spl_col}
        FROM public.pillfinder pf
        WHERE pf.published = TRUE
          AND pf.deleted_at IS NULL
    """
    if only_missing_professional:
        sql += f"""
          AND (
                NOT EXISTS (
                    SELECT 1
                    FROM public.medication_guide mg
                    WHERE {matching_guide_sql}
                )
                OR EXISTS (
                    SELECT 1
                    FROM public.medication_guide mg
                    WHERE {matching_guide_sql}
                      AND (mg.professional_html IS NULL OR BTRIM(mg.professional_html) = '')
                )
          )
        """
    sql += "\n        ORDER BY pf.id ASC"
    params: dict[str, Any] = {}
    if limit is not None:
        sql += "\n        LIMIT :limit"
        params["limit"] = limit
    sql += "\n        OFFSET :offset"
    params["offset"] = offset
    return sql, params


def _count_published_pills(
    limit: Optional[int],
    *,
    offset: int = 0,
    only_missing_professional: bool = False,
) -> int:
    _connect_db()
    with database.db_engine.connect() as conn:
        has_rxcui = _pillfinder_has_rxcui(conn)
        if not has_rxcui:
            logger.warning("pillfinder.rxcui column not found; falling back to NDC-only backfill")
        has_ndc9 = _pillfinder_has_ndc9(conn)
        if not has_ndc9:
            logger.warning("pillfinder.ndc9 column not found; ndc11-only NDC fallback will be used")
        has_spl_set_id = _pillfinder_has_spl_set_id(conn)
        sql, params = _select_published_pills_sql(
            has_rxcui=has_rxcui,
            has_ndc9=has_ndc9,
            has_spl_set_id=has_spl_set_id,
            limit=None,
            offset=0,
            only_missing_professional=only_missing_professional,
        )
        offsetless_sql = sql.rsplit("OFFSET :offset", 1)[0].rstrip()
        total = conn.execute(text(f"SELECT COUNT(*) FROM ({offsetless_sql}) AS selected_pills"), params).scalar() or 0
    total = max(int(total) - offset, 0)
    if limit is not None:
        return min(total, limit)
    return total


def _iter_published_pills(
    limit: Optional[int],
    *,
    offset: int = 0,
    only_missing_professional: bool = False,
):
    _connect_db()
    with database.db_engine.connect() as conn:
        has_rxcui = _pillfinder_has_rxcui(conn)
        if not has_rxcui:
            logger.warning("pillfinder.rxcui column not found; falling back to NDC-only backfill")
        has_ndc9 = _pillfinder_has_ndc9(conn)
        if not has_ndc9:
            logger.warning("pillfinder.ndc9 column not found; ndc11-only NDC fallback will be used")
        has_spl_set_id = _pillfinder_has_spl_set_id(conn)
        if not has_spl_set_id:
            logger.debug("pillfinder.spl_set_id column not found; spl_set_id backfill path disabled")
        sql, params = _select_published_pills_sql(
            has_rxcui=has_rxcui,
            has_ndc9=has_ndc9,
            has_spl_set_id=has_spl_set_id,
            limit=limit,
            offset=offset,
            only_missing_professional=only_missing_professional,
        )
        result = conn.execution_options(stream_results=True).execute(text(sql), params)
        for row in result:
            yield dict(row._mapping)


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


def _clean_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _identifier_candidates(*, spl_set_id: Optional[str], rxcui: Any, ndc11: Optional[str], ndc9: Optional[str]) -> list[tuple[str, str]]:
    candidates: list[tuple[str, str]] = []
    if spl_set_id:
        candidates.append(("spl_set_id", spl_set_id))
    if rxcui is not None and str(rxcui).strip():
        candidates.append(("rxcui", str(rxcui).strip()))
    if ndc11:
        candidates.append(("ndc11", ndc11))
    if ndc9:
        candidates.append(("ndc9", ndc9))
    return candidates


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


def _log_progress_milestone(
    *, processed: int, total: int, complete: int, partial: int, not_found: int, errors: int
) -> None:
    if processed % 10 != 0 and processed != total:
        return
    logger.info(
        "Backfill progress: %d/%d (complete=%d, partial=%d, not_found=%d, errors=%d)",
        processed,
        total,
        complete,
        partial,
        not_found,
        errors,
    )


async def run_backfill(
    *,
    limit: Optional[int] = None,
    offset: int = 0,
    only_missing_professional: bool = False,
    dry_run: bool = False,
    force_refresh: bool = False,
    rate_limit_seconds: float = 0.25,
    report_dir: Optional[Path] = None,
    progress_callback: Optional[Callable[[BackfillProgress], None]] = None,
) -> BackfillSummary:
    start = time.monotonic()
    logger.info(
        "Starting medication guide backfill limit=%s offset=%d dry_run=%s force_refresh=%s only_missing_professional=%s",
        limit,
        offset,
        dry_run,
        force_refresh,
        only_missing_professional,
    )
    total = _count_published_pills(limit, offset=offset, only_missing_professional=only_missing_professional)

    complete_rows: list[dict[str, Any]] = []
    partial_rows: list[dict[str, Any]] = []
    not_found_rows: list[dict[str, Any]] = []
    errors_rows: list[dict[str, Any]] = []
    skipped_rows: list[dict[str, Any]] = []
    would_fetch_rows: list[dict[str, Any]] = []

    matched = complete = partial = not_found = skipped = errors = 0
    professional_found = medguide_found = boxed_warning_found = 0
    processed = 0
    call_count = 0
    use_sleep = not bool(os.getenv("OPENFDA_API_KEY"))

    for pill in _iter_published_pills(limit, offset=offset, only_missing_professional=only_missing_professional):
        processed += 1
        pill_id = pill.get("id")
        slug = pill.get("slug")
        medicine_name = pill.get("medicine_name")
        rxcui = pill.get("rxcui")
        ndc11 = _clean_optional_text(pill.get("ndc11"))
        ndc9 = _clean_optional_text(pill.get("ndc9"))
        spl_set_id = _clean_optional_text(pill.get("spl_set_id"))
        ndc = ndc11 or ndc9
        candidates = _identifier_candidates(
            spl_set_id=spl_set_id,
            rxcui=rxcui,
            ndc11=ndc11,
            ndc9=ndc9,
        )
        default_match_type, default_identifier = candidates[0] if candidates else ("", "")

        if not spl_set_id and not rxcui and not ndc11 and not ndc9:
            skipped += 1
            skipped_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "medicine_name": medicine_name,
                    "spl_set_id": spl_set_id or "",
                    "rxcui": "",
                    "ndc": "",
                    "match_type": "",
                    "identifier_candidate": "",
                    "reason": "no rxcui, ndc11, ndc9, or spl_set_id",
                }
            )
            logger.info(
                "Backfill skipped pill_id=%s slug=%s — no rxcui, ndc11, ndc9, or spl_set_id",
                pill_id,
                slug,
            )
            _emit_progress(
                progress_callback,
                processed=processed,
                total=total,
                pill_id=pill_id,
                status="skipped",
            )
            _log_progress_milestone(
                processed=processed,
                total=total,
                complete=complete,
                partial=partial,
                not_found=not_found,
                errors=errors,
            )
            continue

        if dry_run:
            would_fetch_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "medicine_name": medicine_name,
                    "spl_set_id": spl_set_id or "",
                    "rxcui": rxcui or "",
                    "ndc": ndc or "",
                    "match_type": default_match_type,
                    "identifier_candidate": default_identifier,
                    "brand_name": "",
                    "generic_name": "",
                }
            )
            logger.info(
                "Backfill dry-run would fetch pill_id=%s slug=%s spl_set_id=%s rxcui=%s ndc=%s identifier=%s:%s",
                pill_id,
                slug,
                spl_set_id,
                rxcui,
                ndc,
                default_match_type,
                default_identifier,
            )
            _emit_progress(
                progress_callback,
                processed=processed,
                total=total,
                pill_id=pill_id,
                status="skipped",
            )
            _log_progress_milestone(
                processed=processed,
                total=total,
                complete=complete,
                partial=partial,
                not_found=not_found,
                errors=errors,
            )
            continue

        if use_sleep and call_count > 0 and rate_limit_seconds > 0:
            await asyncio.sleep(rate_limit_seconds)
        call_count += 1

        result = None
        match_type = None
        last_exc: Optional[Exception] = None
        status = "error"

        try:
            # Priority 1: spl_set_id
            if spl_set_id and result is None:
                try:
                    result = await build_guide(
                        spl_set_id=spl_set_id,
                        force_refresh=force_refresh,
                        include_professional=True,
                        include_medguide=True,
                        include_boxed_warning=True,
                    )
                    match_type = "spl_set_id"
                except GuideNotFoundError as exc:
                    logger.debug(
                        "Backfill spl_set_id=%s not found for pill_id=%s slug=%s, trying rxcui/ndc",
                        spl_set_id,
                        pill_id,
                        slug,
                    )
                    last_exc = exc

            # Priority 2: rxcui (without NDC — avoids NDC validation errors)
            if rxcui and result is None:
                try:
                    result = await build_guide(
                        rxcui=str(rxcui),
                        ndc=None,
                        force_refresh=force_refresh,
                        include_professional=True,
                        include_medguide=True,
                        include_boxed_warning=True,
                    )
                    match_type = "rxcui"
                except GuideNotFoundError as exc:
                    logger.debug(
                        "Backfill rxcui=%s not found for pill_id=%s slug=%s, trying ndc",
                        rxcui,
                        pill_id,
                        slug,
                    )
                    last_exc = exc

            # Priority 3: ndc11
            if ndc11 and result is None:
                try:
                    result = await build_guide(
                        rxcui=None,
                        ndc=ndc11,
                        force_refresh=force_refresh,
                        include_professional=True,
                        include_medguide=True,
                        include_boxed_warning=True,
                    )
                    match_type = "ndc11"
                except GuideValidationError:
                    logger.warning(
                        "Backfill ndc11=%s invalid for pill_id=%s slug=%s, trying ndc9",
                        ndc11,
                        pill_id,
                        slug,
                    )
                except GuideNotFoundError as exc:
                    logger.debug(
                        "Backfill ndc11=%s not found for pill_id=%s slug=%s, trying ndc9",
                        ndc11,
                        pill_id,
                        slug,
                    )
                    last_exc = exc

            # Priority 4: ndc9
            if ndc9 and result is None:
                try:
                    result = await build_guide(
                        rxcui=None,
                        ndc=ndc9,
                        force_refresh=force_refresh,
                        include_professional=True,
                        include_medguide=True,
                        include_boxed_warning=True,
                    )
                    match_type = "ndc9"
                except GuideValidationError:
                    logger.warning(
                        "Backfill ndc9=%s invalid for pill_id=%s slug=%s",
                        ndc9,
                        pill_id,
                        slug,
                    )
                except GuideNotFoundError as exc:
                    last_exc = exc

            if result is not None:
                logger.info(
                    "Backfill matched pill_id=%s slug=%s match_type=%s",
                    pill_id,
                    slug,
                    match_type,
                )
                matched += 1
                if result.get("professional_html") or result.get("professional_highlights_html"):
                    professional_found += 1
                if result.get("medguide_html") or result.get("has_medguide"):
                    medguide_found += 1
                if result.get("boxed_warning_html") or result.get("has_boxed_warning"):
                    boxed_warning_found += 1

                sections = result.get("sections") or {}
                missing_sections = [key for key in SECTION_KEYS if not sections.get(key)]
                row_base = {
                    "pill_id": pill_id,
                    "slug": slug,
                    "medicine_name": medicine_name,
                    "spl_set_id": result.get("spl_set_id") or spl_set_id or "",
                    "rxcui": result.get("rxcui") or rxcui or "",
                    "ndc": result.get("ndc") or ndc or "",
                    "match_type": match_type or "",
                    "identifier_candidate": default_identifier,
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
            elif last_exc is not None and isinstance(last_exc, GuideNotFoundError):
                not_found += 1
                not_found_rows.append(
                    {
                        "pill_id": pill_id,
                        "slug": slug,
                        "medicine_name": medicine_name,
                        "spl_set_id": spl_set_id or "",
                        "rxcui": rxcui or "",
                        "ndc": ndc or "",
                        "match_type": default_match_type,
                        "identifier_candidate": default_identifier,
                        "brand_name": "",
                        "generic_name": "",
                    }
                )
                status = "not_found"
            else:
                # All candidates were skipped (e.g. all NDCs invalid, no rxcui/spl_set_id)
                skipped += 1
                skipped_rows.append(
                    {
                        "pill_id": pill_id,
                        "slug": slug,
                        "medicine_name": medicine_name,
                        "spl_set_id": spl_set_id or "",
                        "rxcui": rxcui or "",
                        "ndc": ndc or "",
                        "match_type": default_match_type,
                        "identifier_candidate": default_identifier,
                        "reason": "all identifier candidates invalid or skipped",
                    }
                )
                status = "skipped"
        except Exception as exc:  # noqa: BLE001
            errors += 1
            errors_rows.append(
                {
                    "pill_id": pill_id,
                    "slug": slug,
                    "spl_set_id": spl_set_id or "",
                    "rxcui": rxcui or "",
                    "ndc": ndc or "",
                    "match_type": match_type or default_match_type,
                    "identifier_candidate": default_identifier,
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

        _log_progress_milestone(
            processed=processed,
            total=total,
            complete=complete,
            partial=partial,
            not_found=not_found,
            errors=errors,
        )

    reports_root = report_dir or Path("./backfill_reports")
    reports_root.mkdir(parents=True, exist_ok=True)
    ts = _timestamp()

    complete_path = reports_root / f"complete-{ts}.csv"
    partial_path = reports_root / f"partial-{ts}.csv"
    not_found_path = reports_root / f"not_found-{ts}.csv"
    errors_path = reports_root / f"errors-{ts}.csv"
    skipped_path = reports_root / f"skipped-{ts}.csv"
    would_fetch_path = reports_root / f"would_fetch-{ts}.csv"

    _write_csv(
        complete_path,
        ["pill_id", "slug", "medicine_name", "spl_set_id", "rxcui", "ndc", "match_type", "identifier_candidate", "brand_name", "generic_name"],
        complete_rows,
    )
    _write_csv(
        partial_path,
        [
            "pill_id",
            "slug",
            "medicine_name",
            "spl_set_id",
            "rxcui",
            "ndc",
            "match_type",
            "identifier_candidate",
            "brand_name",
            "generic_name",
            "missing_sections",
        ],
        partial_rows,
    )
    _write_csv(
        not_found_path,
        ["pill_id", "slug", "medicine_name", "spl_set_id", "rxcui", "ndc", "match_type", "identifier_candidate", "brand_name", "generic_name"],
        not_found_rows,
    )
    _write_csv(
        errors_path,
        ["pill_id", "slug", "spl_set_id", "rxcui", "ndc", "match_type", "identifier_candidate", "error_type", "error_message"],
        errors_rows,
    )
    _write_csv(
        skipped_path,
        ["pill_id", "slug", "medicine_name", "spl_set_id", "rxcui", "ndc", "match_type", "identifier_candidate", "reason"],
        skipped_rows,
    )
    _write_csv(
        would_fetch_path,
        ["pill_id", "slug", "medicine_name", "spl_set_id", "rxcui", "ndc", "match_type", "identifier_candidate", "brand_name", "generic_name"],
        would_fetch_rows,
    )

    duration = time.monotonic() - start
    return BackfillSummary(
        total_pills=total,
        processed=processed,
        matched=matched,
        complete=complete,
        partial=partial,
        not_found=not_found,
        skipped=skipped,
        errors=errors,
        professional_found=professional_found,
        medguide_found=medguide_found,
        boxed_warning_found=boxed_warning_found,
        duration_seconds=duration,
        report_paths={
            "complete": str(complete_path),
            "partial": str(partial_path),
            "not_found": str(not_found_path),
            "errors": str(errors_path),
            "skipped": str(skipped_path),
            "would_fetch": str(would_fetch_path),
        },
    )
