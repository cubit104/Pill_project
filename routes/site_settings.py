"""Site feature flags: public read, superuser write.

GET  /api/features               -> {"photo_id_enabled": bool, "photo_id_reader_mode": "original"|"fast"|"accurate"}
GET  /api/admin/features         -> the public flags plus the second-reader settings (superuser)
PUT  /api/admin/features         -> any subset of: photo_id_enabled, photo_id_reader_mode,
                                    reader_trust_base, ai_reader_mode ("off"|"fallback"|"always"),
                                    ai_reader_model, ai_reader_daily_cap

Backed by public.site_settings (supabase/migrations/20260903000000_create_site_settings.sql).
If the table is missing, reads fall back to defaults (feature off) so the
site keeps working before the migration runs.
"""

import json
import logging
import threading
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import database
from routes.admin.auth import require_role
from services import ai_reader

logger = logging.getLogger(__name__)
router = APIRouter()

# photo_id_reader_mode:
#   "original" = day-one behaviour: large model reads the full frame once per side;
#                base only fills in a side where large stays silent. No crops, no voting.
#   "fast"     = base model only, crops + voting (~1.5 s)
#   "accurate" = base crops + voting, large overrides when its crops agree (~3 s)
READER_MODES = ("original", "fast", "accurate")
# ai_reader_*: the second imprint reader (services/ai_reader.py). Off until a superuser turns it on,
# and inert without GEMINI_API_KEY whatever these say.
# reader_trust_base: our large model stays silent rather than guess, and the small (base) model
# then fills in — sometimes inventing an imprint it memorised in training ("PLIVA 448"), which can
# score as an exact match and show a confident wrong pill. False keeps base out of the answer path:
# its read is still recorded, but only the second reader or the photo itself can settle those.
DEFAULTS = {
    "photo_id_enabled": False,
    "photo_id_reader_mode": "accurate",
    "reader_trust_base": False,
    "ai_reader_mode": "off",
    "ai_reader_model": ai_reader.DEFAULT_MODEL,
    "ai_reader_daily_cap": ai_reader.DEFAULT_DAILY_CAP,
}
FLAG_KEYS = tuple(DEFAULTS)
# What the public site and the app may see; the rest is for the admin only.
PUBLIC_KEYS = ("photo_id_enabled", "photo_id_reader_mode")


class FeatureUpdate(BaseModel):
    photo_id_enabled: bool | None = None
    photo_id_reader_mode: Literal["original", "fast", "accurate"] | None = None
    reader_trust_base: bool | None = None
    ai_reader_mode: Literal["off", "fallback", "always"] | None = None
    ai_reader_model: str | None = Field(default=None, max_length=60)
    ai_reader_daily_cap: int | None = Field(default=None, ge=0, le=ai_reader.MAX_DAILY_CAP)


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
    if key == "ai_reader_mode":
        return value if value in ai_reader.MODES else default
    if key == "ai_reader_model":
        return value if value in ai_reader.MODELS else default
    if key == "ai_reader_daily_cap":
        ok = isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= ai_reader.MAX_DAILY_CAP
        return value if ok else default
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
    flags = read_flags()
    return {k: flags[k] for k in PUBLIC_KEYS}


def _admin_view(flags: dict) -> dict:
    """Everything the Settings page needs, including whether the provider key is configured."""
    return {
        **flags,
        "ai_reader_key_present": bool(ai_reader.api_key()),
        "ai_reader_models": list(ai_reader.MODELS),
    }


@router.get("/api/admin/features")
def get_admin_features(admin: dict = Depends(require_role("superuser"))):
    return _admin_view(_read_flags_uncached())


@router.put("/api/admin/features")
def update_features(payload: FeatureUpdate, admin: dict = Depends(require_role("superuser"))):
    if not database.db_engine and not database.connect_to_database():
        raise HTTPException(status_code=500, detail="Database connection not available")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None and k in FLAG_KEYS}
    if not updates:
        raise HTTPException(status_code=422, detail="No settings provided")
    if "ai_reader_model" in updates and updates["ai_reader_model"] not in ai_reader.MODELS:
        raise HTTPException(status_code=422, detail=f"Unknown model. Allowed: {', '.join(ai_reader.MODELS)}")
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
    return _admin_view(read_flags())
