"""PillSeek imprint reader service (in-house TrOCR fine-tune).

POST /read  (multipart: photo, optional photo2)
    -> {"tokens": [...], "reads": [...], "views": [[...], ...]}

Each photo is read from several *views* (full frame, centre crops, 180°
rotation) in one batched decode, and the tokens are put to a vote: a token
must show up in at least PILL_TROCR_MIN_VOTES views to survive. Phone photos
(glare, blur, odd angles) make a single read hallucinate extra fragments
("BX DX 2 M" for a "BX 2" pill); phantoms rarely repeat across views, real
imprints do. Tokens from both sides are pooled (order-insensitive), matching
how pillfinder stores two-sided imprints ("X;3;2").

Run (from pill_vision_poc, after unzipping pill_trocr.zip here):
    venv/Scripts/python -m uvicorn ocr_service:app --port 8002
"""

import io
import os
import re
import time
from collections import Counter

import torch
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

MODEL_DIR = os.getenv("PILL_TROCR_DIR", "pill_trocr")
# Optional shared secret: when set, /read requires header X-Reader-Key to match.
READER_KEY = os.getenv("PILL_OCR_KEY", "")
# Views read per photo, in priority order. c75 = centre crop keeping 75% of the
# short side; r180 = full frame rotated half a turn (the model was trained on
# upright catalog shots, so an upside-down pill often reads better this way).
VIEWS = list(dict.fromkeys(v.strip() for v in os.getenv("PILL_TROCR_VIEWS", "full,c75,c60,r180").split(",") if v.strip()))
# Per-request read logging is off by default (log volume / privacy); latency is always logged.
LOG_READS = os.getenv("PILL_TROCR_LOG_READS", "") == "1"
MIN_VOTES = int(os.getenv("PILL_TROCR_MIN_VOTES", "2"))
# Abuse guards for direct callers (the API already bounds its uploads):
# refuse oversized bodies before decoding, refuse absurd pixel counts before
# decompressing, and normalise to MAX_SIDE so the 4 views are bounded work.
MAX_BYTES = int(os.getenv("PILL_TROCR_MAX_BYTES", str(20 * 1024 * 1024)))
MAX_PIXELS = 40_000_000
MAX_SIDE = 1600

print("Loading imprint reader from", MODEL_DIR)
processor = TrOCRProcessor.from_pretrained(MODEL_DIR)
model = VisionEncoderDecoderModel.from_pretrained(MODEL_DIR)
model.eval()
# Device: Apple GPU (MPS) on Macs, CUDA on NVIDIA boxes, else CPU.
if torch.backends.mps.is_available():
    DEVICE = "mps"
elif torch.cuda.is_available():
    DEVICE = "cuda"
else:
    DEVICE = "cpu"
model = model.to(DEVICE)
print("Reader device:", DEVICE)
# Saved config had use_cache=False (training setting) — re-enable KV cache for fast decoding.
model.config.use_cache = True
model.generation_config.use_cache = True
torch.set_num_threads(max(1, os.cpu_count() or 1))
if os.getenv("PILL_TROCR_INT8", "1") == "1":
    # 8-bit weights for the linear layers: ~2-3x faster on CPU, tiny accuracy cost.
    model = torch.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
NUM_BEAMS = int(os.getenv("PILL_TROCR_BEAMS", "2"))
if not READER_KEY:
    print("WARNING: PILL_OCR_KEY not set — /read accepts unauthenticated requests")
print("Imprint reader ready; views=%s min_votes=%d" % (VIEWS, MIN_VOTES))

app = FastAPI(title="PillSeek imprint reader")

_TOKEN_RE = re.compile(r"[^A-Z0-9./-]")


def _center(img: Image.Image, keep: float) -> Image.Image:
    w, h = img.size
    s = max(1, int(min(w, h) * keep))
    return img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))


def _views(img: Image.Image) -> list[Image.Image]:
    out = []
    for v in VIEWS:
        if v == "full":
            out.append(img)
        elif v == "r180":
            out.append(img.rotate(180))
        elif v.startswith("c") and v[1:].isdigit():
            out.append(_center(img, int(v[1:]) / 100.0))
    return out or [img]


def _read_batch(imgs: list[Image.Image]) -> list[str]:
    """One batched decode for all views of all photos."""
    pv = processor(images=imgs, return_tensors="pt").pixel_values.to(DEVICE)
    with torch.no_grad():
        # min_new_tokens=1: greedy/small-beam otherwise sometimes stops before
        # emitting anything on faint imprints (seen on the Augmentin "3 2").
        ids = model.generate(pv, max_length=24, num_beams=NUM_BEAMS, min_new_tokens=1, use_cache=True)
    return [t.strip().upper() for t in processor.batch_decode(ids, skip_special_tokens=True)]


def _tokens(read: str) -> list[str]:
    out, seen = [], set()
    for t in read.split():
        t = _TOKEN_RE.sub("", t)
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _vote(view_reads: list[str]) -> list[str]:
    """Tokens seen in >= MIN_VOTES views, most-agreed first.

    Falls back to the single longest clean read when nothing reaches the
    threshold (e.g. only one view managed to read the pill at all).
    """
    counts: Counter = Counter()
    first: dict[str, int] = {}
    per_view = [_tokens(r) for r in view_reads]
    for i, toks in enumerate(per_view):
        for t in toks:
            counts[t] += 1
            first.setdefault(t, i)
    agreed = [t for t, n in counts.items() if n >= MIN_VOTES]
    if agreed:
        return sorted(agreed, key=lambda t: (-counts[t], first[t]))
    best = max(per_view, key=lambda toks: len("".join(toks)), default=[])
    return best


async def _read_bounded(up: UploadFile) -> bytes:
    chunks, total = [], 0
    while True:
        chunk = await up.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Photo too large")
        chunks.append(chunk)
    return b"".join(chunks)


def _open_bounded(raw: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(raw))  # lazy: header only
    except Exception:
        raise HTTPException(status_code=422, detail="Not an image")
    if img.size[0] * img.size[1] > MAX_PIXELS:
        raise HTTPException(status_code=422, detail="Image dimensions too large")
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    return img


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "model": MODEL_DIR, "views": VIEWS, "min_votes": MIN_VOTES}


@app.post("/read")
async def read_imprint(
    photo: UploadFile = File(...),
    photo2: UploadFile | None = File(default=None),
    x_reader_key: str | None = Header(default=None),
):
    if READER_KEY and x_reader_key != READER_KEY:
        raise HTTPException(status_code=401, detail="bad reader key")
    t0 = time.time()
    photos: list[Image.Image] = []
    for up in [photo] + ([photo2] if photo2 is not None else []):
        raw = await _read_bounded(up)
        if raw:
            photos.append(_open_bounded(raw))
    batch: list[Image.Image] = []
    spans: list[tuple[int, int]] = []
    for img in photos:
        vs = _views(img)
        spans.append((len(batch), len(batch) + len(vs)))
        batch.extend(vs)
    raw_reads = _read_batch(batch) if batch else []
    views = [raw_reads[a:b] for a, b in spans]
    per_side = [_vote(v) for v in views]
    tokens, seen = [], set()
    for side in per_side:
        for t in side:
            if t not in seen:
                seen.add(t)
                tokens.append(t)
    if LOG_READS:
        print("read %d photo(s) x %d views in %.2fs -> %s | %s" % (len(photos), len(VIEWS), time.time() - t0, tokens, views))
    else:
        print("read %d photo(s) x %d views in %.2fs" % (len(photos), len(VIEWS), time.time() - t0))
    return {"tokens": tokens, "reads": [" ".join(s) for s in per_side], "views": views}
