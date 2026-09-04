"""PillSeek imprint reader service (in-house TrOCR fine-tune).

POST /read  (multipart: photo, optional photo2)
    -> {"tokens": [...], "reads": [...], "views": [[...], ...]}

Each photo is read from several *views* (tight crops around the pill located
in the frame, or full frame + centre crops when none is found) in one batched decode,
and the tokens are put to a vote: a token must show up in at least
PILL_TROCR_MIN_VOTES views to survive. The pill crop matters most on phone
photos: the model was trained on catalog shots where the pill fills the
frame, so a pill that is small in a big frame reads as a few blurry pixels. Phone photos
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

import numpy as np
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
# Views when no pill could be located (fallback): full frame, centre crops,
# half-turn. When a pill IS located, the views are crops around it at
# PILL_PADS (fractions of its box; negative = slightly inside the pill, which
# reads best because the imprint sits in the middle and the model was
# trained on pills that fill the frame) plus one half-turn of the middle crop.
VIEWS = list(dict.fromkeys(v.strip() for v in os.getenv("PILL_TROCR_VIEWS", "full,c75,c60,r180").split(",") if v.strip()))
PILL_PADS = [float(x) for x in os.getenv("PILL_TROCR_PILL_PADS", "-0.10,-0.05,0.03").split(",")]
PILL_PAD = 0.0  # box returned by _pill_box is the raw (unpadded) pill extent
MIN_VOTES = int(os.getenv("PILL_TROCR_MIN_VOTES", "2"))
# Per-request read logging is off by default (log volume / privacy); latency is always logged.
LOG_READS = os.getenv("PILL_TROCR_LOG_READS", "") == "1"
# Debugging aid: when set, every request's photos and the views actually read
# are written there (local disk only). Leave unset in normal operation.
DEBUG_DIR = os.getenv("PILL_TROCR_DEBUG_DIR", "")
# Abuse guards for direct callers (the API already bounds its uploads):
# refuse oversized bodies before decoding, refuse absurd pixel counts before
# decompressing, and normalise to MAX_SIDE so the 4 views are bounded work.
MAX_BYTES = int(os.getenv("PILL_TROCR_MAX_BYTES", str(20 * 1024 * 1024)))
MAX_PIXELS = 40_000_000
MAX_SIDE = 1600

# Device: Apple GPU (MPS) on Macs, CUDA on NVIDIA boxes, else CPU.
if torch.backends.mps.is_available():
    DEVICE = "mps"
elif torch.cuda.is_available():
    DEVICE = "cuda"
else:
    DEVICE = "cpu"
# Half precision on the GPU: same reads in our tests, half the memory, ~2x faster.
FP16 = os.getenv("PILL_TROCR_FP16", "1" if DEVICE != "cpu" else "0") == "1" and DEVICE != "cpu"
DTYPE = torch.float16 if FP16 else torch.float32


def _load_model(path: str):
    print("Loading imprint reader from", path)
    m = VisionEncoderDecoderModel.from_pretrained(path)
    m.eval()
    # Saved config had use_cache=False (training setting) — re-enable KV cache for fast decoding.
    m.config.use_cache = True
    m.generation_config.use_cache = True
    if os.getenv("PILL_TROCR_INT8", "1") == "1" and DEVICE == "cpu":
        # 8-bit weights for the linear layers: ~2-3x faster on CPU, tiny accuracy cost.
        m = torch.quantization.quantize_dynamic(m, {torch.nn.Linear}, dtype=torch.qint8)
    return m.to(DEVICE, dtype=DTYPE)


processor = TrOCRProcessor.from_pretrained(MODEL_DIR)
model = _load_model(MODEL_DIR)
print("Reader device:", DEVICE, "fp16" if FP16 else "fp32")
torch.set_num_threads(max(1, os.cpu_count() or 1))
# Optional second reader (the large fine-tune). It is slower but reads faint
# debossed imprints the base model cannot; and it *abstains* (emits nothing)
# when unsure instead of guessing. Per side, when its two crop reads agree it
# overrides the base model's vote; otherwise the base result stands.
MODEL2_DIR = os.getenv("PILL_TROCR_DIR2", "")
model2 = _load_model(MODEL2_DIR) if MODEL2_DIR else None
NUM_BEAMS2 = int(os.getenv("PILL_TROCR_BEAMS2", "2"))
NUM_BEAMS = int(os.getenv("PILL_TROCR_BEAMS", "2"))
if model2 is not None:
    print("Second reader:", MODEL2_DIR, "beams", NUM_BEAMS2)
if not READER_KEY:
    print("WARNING: PILL_OCR_KEY not set — /read accepts unauthenticated requests")
print("Imprint reader ready; views=%s min_votes=%d" % (VIEWS, MIN_VOTES))

app = FastAPI(title="PillSeek imprint reader")

_TOKEN_RE = re.compile(r"[^A-Z0-9./-]")


def _center(img: Image.Image, keep: float) -> Image.Image:
    w, h = img.size
    s = max(1, int(min(w, h) * keep))
    return img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))


def _integral(a):
    s = np.cumsum(np.cumsum(a, axis=0), axis=1)
    return np.pad(s, ((1, 0), (1, 0)))


def _box_sum(I, y0, x0, side):
    """Sum over [y0:y0+side, x0:x0+side] for arrays of y0/x0 (vectorized)."""
    return I[y0 + side, x0 + side] - I[y0, x0 + side] - I[y0 + side, x0] + I[y0, x0]


def _pill_box(img: Image.Image, thumb=192, scales=(0.12, 0.16, 0.2, 0.25, 0.3, 0.36, 0.44, 0.55), min_score=1.2):
    """Locate the pill: a smooth, compact blob that contrasts with a textured background.

    Scans square windows at several scales over a small thumbnail (integral
    images, ~30 ms): score = |brightness contrast, window centre vs ring| +
    texture contrast (ring rougher than centre). Wood grain, fabric and palm
    lines are rough; pills are smooth. The winning window is then grown to
    the pill's real extent by a colour split + flood fill (_refine). Returns
    a box in full-image coordinates, or None when nothing convincing is found.
    """
    W, H = img.size
    small = img.copy()
    small.thumbnail((thumb, thumb))
    g = np.asarray(small.convert("L"), dtype=np.float32) / 255.0
    h, w = g.shape
    # texture = local gradient magnitude (wood grain, fabric, palm lines are high; pills are low)
    gx = np.abs(np.diff(g, axis=1, prepend=g[:, :1]))
    gy = np.abs(np.diff(g, axis=0, prepend=g[:1, :]))
    tex = gx + gy
    Ib, It = _integral(g), _integral(tex)
    sb, st = g.std() + 1e-6, tex.std() + 1e-6
    best = (-1e9, None)
    for f in scales:
        side = int(min(h, w) * f)
        inner = max(4, int(side * 0.7))          # central part of the window: mostly pill if it fits
        off = (side - inner) // 2
        ring = int(side * 0.5)                   # margin around the window: background
        stride = max(1, side // 8)
        ys = np.arange(0, h - side + 1, stride)
        xs = np.arange(0, w - side + 1, stride)
        Y, X = np.meshgrid(ys, xs, indexing="ij")
        # inner stats
        b_in = _box_sum(Ib, Y + off, X + off, inner) / (inner * inner)
        t_in = _box_sum(It, Y + off, X + off, inner) / (inner * inner)
        # ring = expanded box minus window (clipped to image)
        y0 = np.clip(Y - ring, 0, h); x0 = np.clip(X - ring, 0, w)
        y1 = np.clip(Y + side + ring, 0, h); x1 = np.clip(X + side + ring, 0, w)
        big_area = (y1 - y0) * (x1 - x0)
        big_b = Ib[y1, x1] - Ib[y0, x1] - Ib[y1, x0] + Ib[y0, x0]
        big_t = It[y1, x1] - It[y0, x1] - It[y1, x0] + It[y0, x0]
        win_b = _box_sum(Ib, Y, X, side)
        win_t = _box_sum(It, Y, X, side)
        ring_area = np.maximum(big_area - side * side, 1)
        b_ring = (big_b - win_b) / ring_area
        t_ring = (big_t - win_t) / ring_area
        score = np.abs(b_in - b_ring) / sb + (t_ring - t_in) / st
        i = int(np.argmax(score))
        sc = float(score.ravel()[i])
        if sc > best[0]:
            yy, xx = int(Y.ravel()[i]), int(X.ravel()[i])
            best = (sc, (xx, yy, side))
    sc, hit = best
    if hit is None or sc < min_score:
        return None
    xx, yy, side = hit
    box = _refine(np.asarray(small, dtype=np.float32), (xx, yy, side))
    if box is None:
        return None
    sx, sy = W / w, H / h
    x0, y0, x1, y1 = box
    return (int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy))


def _refine(rgb, win):
    """Grow the detected window to the pill's real extent.

    Nearest-centroid colour split (pill colour = median of the window's
    centre, background = median of the ring around it), then a flood fill
    from the window centre over the 'pill' mask. Falls back to the window
    when the region looks implausible.
    """
    h, w = rgb.shape[:2]
    xx, yy, side = win
    inner = max(4, int(side * 0.6)); off = (side - inner) // 2
    core = rgb[yy + off:yy + off + inner, xx + off:xx + off + inner].reshape(-1, 3)
    ring = int(side * 0.5)
    y0, x0 = max(0, yy - ring), max(0, xx - ring)
    y1, x1 = min(h, yy + side + ring), min(w, xx + side + ring)
    big = rgb[y0:y1, x0:x1].copy()
    big[yy - y0:yy - y0 + side, xx - x0:xx - x0 + side] = np.nan
    ringpx = big.reshape(-1, 3); ringpx = ringpx[~np.isnan(ringpx[:, 0])]
    pill_c = np.median(core, axis=0); bg_c = np.median(ringpx, axis=0)
    if np.linalg.norm(pill_c - bg_c) < 20:
        return (xx, yy, xx + side, yy + side)
    d_pill = np.linalg.norm(rgb - pill_c, axis=-1)
    d_bg = np.linalg.norm(rgb - bg_c, axis=-1)
    mask = d_pill < d_bg
    # flood fill from the window centre (4-neighbour), bounded to a plausible area
    cy, cx = yy + side // 2, xx + side // 2
    if not mask[cy, cx]:
        return (xx, yy, xx + side, yy + side)
    seen = np.zeros_like(mask)
    stack = [(cy, cx)]; seen[cy, cx] = True
    ys, xs = [], []
    limit = h * w
    while stack and len(ys) < limit:
        y, x = stack.pop(); ys.append(y); xs.append(x)
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; stack.append((ny, nx))
    if len(ys) < side * side * 0.15:
        return (xx, yy, xx + side, yy + side)
    if len(ys) > 0.5 * h * w:
        # The "pill" is most of the frame: a close-up. Full-frame views are right.
        return None
    ys, xs = np.array(ys), np.array(xs)
    by0, by1 = np.percentile(ys, [0.5, 99.5]); bx0, bx1 = np.percentile(xs, [0.5, 99.5])
    # square it around the centre
    s = max(by1 - by0, bx1 - bx0) + 1
    cy2, cx2 = (by0 + by1) / 2, (bx0 + bx1) / 2
    return (int(max(0, cx2 - s / 2)), int(max(0, cy2 - s / 2)), int(min(w, cx2 + s / 2)), int(min(h, cy2 + s / 2)))


def _crop_pad(img: Image.Image, box: tuple[int, int, int, int], pad: float) -> Image.Image:
    l, t, r, b = box
    cx, cy = (l + r) / 2, (t + b) / 2
    s = max(r - l, b - t) * (1 + 2 * pad)
    return img.crop((int(max(0, cx - s / 2)), int(max(0, cy - s / 2)),
                     int(min(img.width, cx + s / 2)), int(min(img.height, cy + s / 2))))


def _views(img: Image.Image) -> list[Image.Image]:
    box = _pill_box(img)
    if LOG_READS:
        print("pill box:", box, "in", img.size)
    if box:
        crops = [_crop_pad(img, box, p) for p in PILL_PADS]
        return crops + [crops[len(crops) // 2].rotate(180)]
    out = []
    for v in VIEWS:
        if v == "full":
            out.append(img)
        elif v == "r180":
            out.append(img.rotate(180))
        elif v.startswith("c") and v[1:].isdigit():
            out.append(_center(img, int(v[1:]) / 100.0))
    return out or [img]


def _read_batch(imgs: list[Image.Image], m=None, beams: int | None = None) -> list[str]:
    """One batched decode for all views of all photos."""
    m = model if m is None else m
    beams = NUM_BEAMS if beams is None else beams
    pv = processor(images=imgs, return_tensors="pt").pixel_values.to(DEVICE, dtype=DTYPE)
    with torch.no_grad():
        # min_new_tokens=1: greedy/small-beam otherwise sometimes stops before
        # emitting anything on faint imprints (seen on the Augmentin "3 2").
        ids = m.generate(pv, max_length=24, num_beams=beams, min_new_tokens=1, use_cache=True)
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
    return {"status": "ok", "device": DEVICE, "model": MODEL_DIR, "model2": MODEL2_DIR or None, "fp16": FP16,
            "views": VIEWS, "pill_pads": PILL_PADS, "min_votes": MIN_VOTES}


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
    n_views = len(batch)
    if DEBUG_DIR:
        try:
            os.makedirs(DEBUG_DIR, exist_ok=True)
            stamp = time.strftime("%H%M%S")
            for i, im in enumerate(photos):
                im.save(os.path.join(DEBUG_DIR, f"{stamp}_photo{i + 1}.jpg"), quality=90)
            for i, im in enumerate(batch):
                im.save(os.path.join(DEBUG_DIR, f"{stamp}_view{i + 1}.jpg"), quality=90)
        except Exception as e:
            print("debug dump failed:", e)
    raw_reads = _read_batch(batch) if batch else []
    views = [raw_reads[a:b] for a, b in spans]
    per_side = [_vote(v) for v in views]
    views2: list[list[str]] = []
    if model2 is not None and batch:
        # Two middle views per photo (the tight pill crops when a pill was found).
        picks = [list(range(a, b))[1:3] if b - a >= 3 else list(range(a, b)) for a, b in spans]
        reads2 = _read_batch([batch[i] for idxs in picks for i in idxs], model2, NUM_BEAMS2)
        pos = 0
        for si, idxs in enumerate(picks):
            side_reads = reads2[pos:pos + len(idxs)]
            pos += len(idxs)
            views2.append(side_reads)
            toks = [_tokens(r) for r in side_reads if r.strip()]
            if len(toks) >= 2 and all(set(t) == set(toks[0]) for t in toks[1:]):
                per_side[si] = toks[0]
    tokens, seen = [], set()
    for side in per_side:
        for t in side:
            if t not in seen:
                seen.add(t)
                tokens.append(t)
    if LOG_READS:
        print("read %d photo(s), %d views in %.2fs -> %s | %s | large: %s" % (len(photos), n_views, time.time() - t0, tokens, views, views2))
    else:
        print("read %d photo(s), %d views in %.2fs" % (len(photos), n_views, time.time() - t0))
    return {"tokens": tokens, "reads": [" ".join(s) for s in per_side], "views": views, "views2": views2}
