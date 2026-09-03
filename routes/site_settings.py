"""Site feature flags: public read, superuser write.

GET  /api/features               -> {"photo_id_enabled": bool}
PUT  /api/admin/features         -> body {"photo_id_enabled": bool}

Backed by public.site_settings (supabase/migrations/20260903000000_create_site_settings.sql).
If the table is missing, reads fall back to defaults (feature off) so the
site keeps working before the migration runs.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import database
from routes.admin.auth import require_role

logger = logging.getLogger(__name__)
router = APIRouter()

DEFAULTS = {"photo_id_enabled": False}
FLAG_KEYS = tuple(DEFAULTS)


class FeatureUpdate(BaseModel):
    photo_id_enabled: bool | None = None


def read_flags() -> dict:
    flags = dict(DEFAULTS)
    if not database.db_engine and not database.connect_to_database():
        return flags
    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text("SELECT key, value FROM site_settings WHERE key = ANY(:keys)"),
                {"keys": list(FLAG_KEYS)},
            ).fetchall()
        for key, value in rows:
            if isinstance(value, str):
                value = json.loads(value)
            flags[key] = bool(value)
    except Exception as e:  # table may not exist yet
        logger.warning("site_settings unavailable, using defaults: %s", e)
    return flags


@router.get("/api/features")
def get_features():
    return read_flags()


@router.put("/api/admin/features")
def update_features(payload: FeatureUpdate, admin: dict = Depends(require_role("superuser"))):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None and k in FLAG_KEYS}
    if not updates:
        raise HTTPException(status_code=422, detail="No settings provided")
    try:
        with database.db_engine.begin() as conn:
            for key, value in updates.items():
                conn.execute(
                    text(
                        "INSERT INTO site_settings (key, value, updated_at, updated_by) "
                        "VALUES (:key, CAST(:value AS jsonb), now(), :by) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
                        "updated_at = now(), updated_by = EXCLUDED.updated_by"
                    ),
                    {"key": key, "value": json.dumps(value), "by": admin.get("email")},
                )
    except Exception as e:
        logger.error("failed to update site_settings: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Could not save settings (is the site_settings migration applied?)")
    return read_flags()
