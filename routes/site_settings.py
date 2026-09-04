"""Site feature flags: public read, superuser write.

GET  /api/features               -> {"photo_id_enabled": bool, "photo_id_reader_mode": "fast"|"accurate"}
PUT  /api/admin/features         -> body {"photo_id_enabled": bool, "photo_id_reader_mode": "fast"|"accurate"} (any subset)

Backed by public.site_settings (supabase/migrations/20260903000000_create_site_settings.sql).
If the table is missing, reads fall back to defaults (feature off) so the
site keeps working before the migration runs.
"""

import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import database
from routes.admin.auth import require_role

logger = logging.getLogger(__name__)
router = APIRouter()

# photo_id_reader_mode: "fast" = base imprint model only (~1.5 s);
# "accurate" = base + large model on the best crops (~3 s, reads faint debosses).
READER_MODES = ("fast", "accurate")
DEFAULTS = {"photo_id_enabled": False, "photo_id_reader_mode": "accurate"}
FLAG_KEYS = tuple(DEFAULTS)


class FeatureUpdate(BaseModel):
    photo_id_enabled: bool | None = None
    photo_id_reader_mode: Literal["fast", "accurate"] | None = None


def _coerce(key: str, value):
    """Stored JSON -> typed setting; anything malformed falls back to the default."""
    default = DEFAULTS[key]
    if isinstance(default, bool):
        return bool(value)
    if key == "photo_id_reader_mode":
        return value if value in READER_MODES else default
    return value


_cache: dict = {"at": 0.0, "flags": None}
CACHE_S = 30.0


def read_flags() -> dict:
    """Flags for the public site; cached briefly since every page load asks."""
    import time

    now = time.time()
    if _cache["flags"] is not None and now - _cache["at"] < CACHE_S:
        return dict(_cache["flags"])
    flags = _read_flags_uncached()
    _cache["flags"], _cache["at"] = dict(flags), now
    return flags


def _read_flags_uncached() -> dict:
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
                try:
                    value = json.loads(value)
                except ValueError:
                    pass  # a bare string stored without JSON quoting
            flags[key] = _coerce(key, value)
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
    _cache["flags"] = None
    return read_flags()
