"""Site feature flags: public read, superuser write.

GET  /api/features               -> {"photo_id_enabled": bool, "photo_id_reader_mode": "original"|"fast"|"accurate"}
PUT  /api/admin/features         -> body {"photo_id_enabled": bool, "photo_id_reader_mode": "original"|"fast"|"accurate"} (any subset)

Backed by public.site_settings (supabase/migrations/20260903000000_create_site_settings.sql).
If the table is missing, reads fall back to defaults (feature off) so the
site keeps working before the migration runs.
"""

import json
import logging
import threading
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import database
from routes.admin.auth import require_role

logger = logging.getLogger(__name__)
router = APIRouter()

# photo_id_reader_mode:
#   "original" = day-one behaviour: large model reads the full frame once per side;
#                base only fills in a side where large stays silent. No crops, no voting.
#   "fast"     = base model only, crops + voting (~1.5 s)
#   "accurate" = base crops + voting, large overrides when its crops agree (~3 s)
READER_MODES = ("original", "fast", "accurate")
DEFAULTS = {"photo_id_enabled": False, "photo_id_reader_mode": "accurate"}
FLAG_KEYS = tuple(DEFAULTS)


class FeatureUpdate(BaseModel):
    photo_id_enabled: bool | None = None
    photo_id_reader_mode: Literal["original", "fast", "accurate"] | None = None


def _coerce(key: str, value):
    """Stored JSON -> typed setting; anything malformed falls back to the default."""
    default = DEFAULTS[key]
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in ("true", "false"):
            return value.strip().lower() == "true"
        return default  # "no", "0", None, objects... -> default, never a surprise ON
    if key == "photo_id_reader_mode":
        return value if value in READER_MODES else default
    return value


_cache: dict = {"at": 0.0, "flags": None, "gen": 0}
_cache_lock = threading.Lock()
CACHE_S = 30.0


def read_flags() -> dict:
    """Flags for the public site; cached briefly since every page load asks.

    A generation counter makes invalidation race-free: a read that started
    before an admin write cannot repopulate the cache with the old values.
    """
    import time

    with _cache_lock:
        now = time.time()
        if _cache["flags"] is not None and now - _cache["at"] < CACHE_S:
            return dict(_cache["flags"])
        gen = _cache["gen"]
    flags = _read_flags_uncached()
    with _cache_lock:
        if gen == _cache["gen"]:  # nothing was written while we were reading
            _cache["flags"], _cache["at"] = dict(flags), time.time()
    return flags


def _invalidate_flags() -> None:
    with _cache_lock:
        _cache["gen"] += 1
        _cache["flags"] = None


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
    _invalidate_flags()
    return read_flags()
