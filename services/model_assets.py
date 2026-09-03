"""Fetch pill-vision model assets from Supabase Storage at startup.

The visual encoder, fingerprint index and shape/color heads (~115 MB) are
too big for git, so production downloads them from the private storage
bucket (default `LLM_MODELS`, folder `pill-vision/`) into `pill_vision/`.
Local development already has the files, so the download is skipped.

Env:
    SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)  e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY                   server-side key (never exposed)
    PILL_MODELS_BUCKET                          default LLM_MODELS
    PILL_VISION_DIR                             default pill_vision
"""

import logging
import os
import threading

import requests

logger = logging.getLogger(__name__)

ASSETS = ("pill_encoder_int8.onnx", "index_prod.npz", "pill_attr_heads.npz")
_lock = threading.Lock()
_done = False


def _target_dir() -> str:
    return os.getenv("PILL_VISION_DIR", "pill_vision")


def assets_present() -> bool:
    d = _target_dir()
    return all(os.path.exists(os.path.join(d, name)) for name in ASSETS)


def ensure_pill_vision_assets() -> bool:
    """Download any missing asset. Returns True when all assets are present."""
    global _done
    with _lock:
        if _done or assets_present():
            _done = True
            return True

        base = (os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        bucket = os.getenv("PILL_MODELS_BUCKET", "LLM_MODELS")
        if not base or not key:
            logger.warning("pill-vision assets missing and SUPABASE_URL/SERVICE_ROLE_KEY not set; visual matching disabled")
            return False

        d = _target_dir()
        os.makedirs(d, exist_ok=True)
        headers = {"Authorization": f"Bearer {key}", "apikey": key}
        for name in ASSETS:
            dest = os.path.join(d, name)
            if os.path.exists(dest):
                continue
            url = f"{base}/storage/v1/object/{bucket}/pill-vision/{name}"
            tmp = dest + ".part"
            try:
                with requests.get(url, headers=headers, stream=True, timeout=300) as r:
                    r.raise_for_status()
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_content(chunk_size=1 << 20):
                            f.write(chunk)
                os.replace(tmp, dest)
                logger.info("downloaded pill-vision asset %s (%.1f MB)", name, os.path.getsize(dest) / 1e6)
            except Exception:
                logger.error("failed to download pill-vision asset %s from %s", name, url, exc_info=True)
                if os.path.exists(tmp):
                    os.remove(tmp)
                return False
        _done = assets_present()
        return _done


def prefetch_in_background() -> None:
    """Kick off the download without blocking app startup."""
    threading.Thread(target=ensure_pill_vision_assets, name="pill-vision-prefetch", daemon=True).start()
