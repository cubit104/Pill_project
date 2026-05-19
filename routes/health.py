import logging
import os
import asyncio

from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy import text

import database
from utils import normalize_text, normalize_imprint, normalize_name, IMAGE_BASE

logger = logging.getLogger(__name__)

router = APIRouter()

IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")


# connection scoped to function body.
def _health_ping() -> int:
    with database.db_engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        return int(result.scalar() or 0)


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    if not database.db_engine:
        database.connect_to_database()

    db_connected = False
    record_count = 0
    if database.db_engine:
        try:
            ping = await asyncio.wait_for(asyncio.to_thread(_health_ping), timeout=2.0)
            db_connected = ping == 1
            if db_connected:
                record_count = 0
        except Exception:
            db_connected = False

    if not db_connected:
        return JSONResponse(status_code=503, content={"status": "degraded", "db": "unreachable"})

    return {
        "status": "healthy",
        "version": "1.0.0",
        "database_connected": db_connected,
        "record_count": record_count,
        "ndc_handler_active": database.ndc_handler is not None,
        "images_source": IMAGE_BASE,
        "images_dir": IMAGES_DIR,
        "images_dir_exists": os.path.exists(IMAGES_DIR),
        "using_supabase": True,
        "image_validation": "disabled",
    }


# connection scoped to function body.
@router.get("/reload-data")
async def reload_data(background_tasks: BackgroundTasks):
    """Reload database connection and recreate handlers"""
    database._missing_files_log.clear()
    database._common_drug_cache.clear()

    normalize_text.cache_clear()
    normalize_imprint.cache_clear()
    normalize_name.cache_clear()

    success = database.connect_to_database()

    record_count = 0
    if success and database.db_engine:
        try:
            with database.db_engine.connect() as conn:
                result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
                record_count = result.scalar()
        except Exception:
            pass

    background_tasks.add_task(database.warmup_system)

    return {
        "message": "Data reload " + ("succeeded" if success else "failed"),
        "record_count": record_count,
        "ndc_handler_active": database.ndc_handler is not None,
        "caches_cleared": True,
    }
