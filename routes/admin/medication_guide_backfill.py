"""Admin route to trigger medication guide backfill in background."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import JSONResponse

from routes.admin.auth import require_superuser
from services.medication_guide_backfill import run_backfill

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/medication-guide", tags=["admin-medication-guide"])

_state_lock = asyncio.Lock()
_is_running = False


async def _try_start_backfill() -> bool:
    global _is_running
    async with _state_lock:
        if _is_running:
            return False
        _is_running = True
        return True


async def _finish_backfill() -> None:
    global _is_running
    async with _state_lock:
        _is_running = False


async def _run_backfill_job(
    *,
    limit: int | None,
    offset: int,
    only_missing_professional: bool,
    dry_run: bool,
    force: bool,
) -> None:
    try:
        summary = await run_backfill(
            limit=limit,
            offset=offset,
            only_missing_professional=only_missing_professional,
            dry_run=dry_run,
            force_refresh=force,
            report_dir=Path("./backfill_reports"),
        )
        logger.info("Medication guide backfill finished: %s", summary)
    except Exception:  # noqa: BLE001
        logger.exception("Medication guide backfill failed")
    finally:
        await _finish_backfill()


@router.post("/backfill", status_code=202)
async def backfill_medication_guide(
    background_tasks: BackgroundTasks,
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
    only_missing_professional: bool = Query(default=False),
    dry_run: bool = Query(default=False),
    force: bool = Query(default=False),
    _admin=Depends(require_superuser),
):
    if not await _try_start_backfill():
        return JSONResponse(status_code=409, content={"error": "Backfill already in progress"})

    background_tasks.add_task(
        _run_backfill_job,
        limit=limit,
        offset=offset,
        only_missing_professional=only_missing_professional,
        dry_run=dry_run,
        force=force,
    )
    return {
        "status": "started",
        "limit": limit,
        "offset": offset,
        "only_missing_professional": only_missing_professional,
        "dry_run": dry_run,
        "force": force,
        "message": "Backfill started in background. Check server logs and ./backfill_reports/ for results.",
    }
