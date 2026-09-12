"""PillSeek visual matcher service.

Runs the pill encoder and the fingerprint index outside the API process, so the
API box never holds a model. Same idea as the imprint reader (ocr_service.py),
and the two are meant to sit side by side on the same machine.

    GET  /health
    POST /match  (multipart: photo, optional photo2, mode=match|attrs,
                  optional limit; header X-Vision-Key when PILL_MATCH_KEY is set)

/match returns catalog slugs and scores only. The API joins them to the
database, so this service never needs database credentials.

Environment:
    PILL_VISION_DIR        where the assets live (default: pill_vision)
    PILL_MATCH_KEY         shared secret; when set, /match requires X-Vision-Key
    PILL_MATCH_WORKERS     concurrent identifications (default 2)
    PILL_MATCH_QUEUE       how many may wait before we start refusing with 503
                           (default: three times the worker count)
    PILL_VISION_PROVIDERS  ONNX providers; unset = CUDA, else CoreML, else CPU
    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  to self-provision the ~115 MB of
                           assets on first boot, exactly as the API does today

Run, from the repository root (the service lives under ml/scripts, and its own
sys.path fix only runs once Python has already imported it):
    uvicorn --app-dir ml/scripts vision_service:app --host 127.0.0.1 --port 8003
"""

import asyncio
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

# Run from anywhere: the repo root holds services/pill_vision_core.py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from services import pill_vision_core as core  # noqa: E402
from services.model_assets import ASSETS, ensure_pill_vision_assets  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("vision-service")

VISION_DIR = os.getenv("PILL_VISION_DIR", "pill_vision")
MODEL_PATH = os.getenv("PILL_VISION_MODEL", os.path.join(VISION_DIR, ASSETS[0]))
INDEX_PATH = os.getenv("PILL_VISION_INDEX", os.path.join(VISION_DIR, ASSETS[1]))
ATTR_PATH = os.getenv("PILL_VISION_ATTRS", os.path.join(VISION_DIR, ASSETS[2]))
MATCH_KEY = os.getenv("PILL_MATCH_KEY", "")
MAX_BYTES = int(os.getenv("PILL_MATCH_MAX_BYTES", str(20 * 1024 * 1024)))
DEFAULT_LIMIT = int(os.getenv("PILL_MATCH_LIMIT", "25"))
WORKERS = int(os.getenv("PILL_MATCH_WORKERS", "2"))
# Identifications run on their own small pool, so a burst queues instead of
# fighting over the GPU and blowing up resident memory.
_EXECUTOR = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="pill-match")
# A ThreadPoolExecutor queues without limit, and every waiting request is
# holding its uploads in memory. Unbounded, a burst would rebuild exactly the
# memory problem this service exists to remove, so admission is capped and the
# overflow is turned away before its photos are even read.
MAX_INFLIGHT = int(os.getenv("PILL_MATCH_QUEUE", str(WORKERS * 3)))
_slots = threading.BoundedSemaphore(MAX_INFLIGHT)


def _assets_ready() -> bool:
    """The files this process will actually open, which PILL_VISION_MODEL and
    friends can point outside PILL_VISION_DIR. The downloader only knows about
    that directory, so resolved paths are what decides whether to fetch."""
    return os.path.exists(MODEL_PATH) and os.path.exists(INDEX_PATH)


if not _assets_ready():
    ensure_pill_vision_assets(wait=True)
    if not _assets_ready():
        raise SystemExit(
            f"pill-vision assets missing ({MODEL_PATH}, {INDEX_PATH}) and could not be "
            "downloaded; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or copy the "
            "files in manually"
        )

_t0 = time.time()
INDEX = core.load(MODEL_PATH, INDEX_PATH, ATTR_PATH)
logger.info(
    "matcher ready: %d fingerprints, providers=%s, attrs=%s, in %.1fs",
    len(INDEX),
    core.providers(),
    bool(INDEX.attrs),
    time.time() - _t0,
)
if not MATCH_KEY:
    logger.warning("PILL_MATCH_KEY not set - /match accepts unauthenticated requests")

app = FastAPI(title="PillSeek visual matcher")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "providers": core.providers(),
        "fingerprints": len(INDEX),
        "attrs": bool(INDEX.attrs),
        "workers": WORKERS,
        "max_inflight": MAX_INFLIGHT,
        "model": MODEL_PATH,
    }


async def _read_bounded(up: UploadFile) -> bytes:
    chunks, total = [], 0
    while True:
        chunk = await up.read(1 << 20)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Photo too large")
        chunks.append(chunk)
    return b"".join(chunks)


def _match_sync(raws: list[bytes], mode: str, limit: int) -> dict:
    if mode == "attrs":
        shape_p, color_p = core.attrs_for(INDEX, raws[0])
        return {"matches": [], "shape": shape_p, "color": color_p}
    hits = core.match(INDEX, raws, limit)
    return {"matches": [{"slug": s, "score": v} for s, v in hits], "shape": {}, "color": {}}


@app.post("/match")
async def match(
    photo: UploadFile = File(...),
    photo2: UploadFile | None = File(default=None),
    mode: str = Form(default="match"),
    limit: int = Form(default=0),
    x_vision_key: str | None = Header(default=None),
):
    if MATCH_KEY and x_vision_key != MATCH_KEY:
        raise HTTPException(status_code=401, detail="bad vision key")
    mode = (mode or "match").strip().lower()
    if mode not in ("match", "attrs"):
        raise HTTPException(status_code=422, detail="mode must be 'match' or 'attrs'")

    # Claim a slot before reading anything: a request we are going to refuse
    # should not cost us 40 MB of buffered photos first.
    if not _slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Matcher is busy; please try again shortly")
    try:
        raws = []
        for up in [photo] + ([photo2] if photo2 is not None else []):
            raw = await _read_bounded(up)
            if raw:
                raws.append(raw)
        if not raws:
            raise HTTPException(status_code=422, detail="Empty upload")

        t0 = time.time()
        loop = asyncio.get_running_loop()
        try:
            out = await loop.run_in_executor(
                _EXECUTOR, _match_sync, raws, mode, limit if limit > 0 else DEFAULT_LIMIT
            )
        except core.VisionInputError as e:
            raise HTTPException(status_code=422, detail=str(e))
        logger.info("match %d photo(s), mode=%s in %.2fs", len(raws), mode, time.time() - t0)
        return out
    finally:
        _slots.release()
