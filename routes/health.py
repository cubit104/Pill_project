import os
import logging

from fastapi import APIRouter, BackgroundTasks
from sqlalchemy import text

import database
from utils import normalize_text, normalize_imprint, normalize_name, IMAGE_BASE

logger = logging.getLogger(__name__)

router = APIRouter()

IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")


@router.get("/health")
def health_check():
    """Health check endpoint"""
    if not database.db_engine:
        database.connect_to_database()

    db_connected = False
    record_count = 0
    if database.db_engine:
        try:
            with database.db_engine.connect() as conn:
                result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
                record_count = result.scalar()
                db_connected = True
        except Exception:
            db_connected = False

    return {
        "status": "healthy" if db_connected else "degraded",
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
