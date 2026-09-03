"""PillSeek imprint reader service (in-house TrOCR fine-tune).

POST /read  (multipart: photo, optional photo2) -> {"tokens": [...], "reads": [...]}

Each photo is read at full frame and at a 60% center crop; the longer,
cleaner read wins. Tokens from both sides are pooled (order-insensitive),
matching how pillfinder stores two-sided imprints ("X;3;2").

Run (from pill_vision_poc, after unzipping pill_trocr.zip here):
    venv/Scripts/python -m uvicorn ocr_service:app --port 8002
"""

import io
import os
import re

import torch
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

MODEL_DIR = os.getenv("PILL_TROCR_DIR", "pill_trocr")
# Optional shared secret: when set, /read requires header X-Reader-Key to match.
READER_KEY = os.getenv("PILL_OCR_KEY", "")

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
print("Imprint reader ready")

app = FastAPI(title="PillSeek imprint reader")

_TOKEN_RE = re.compile(r"[^A-Z0-9./-]")


def _read(img: Image.Image) -> str:
    pv = processor(images=img, return_tensors="pt").pixel_values.to(DEVICE)
    with torch.no_grad():
        # min_new_tokens=1: greedy/small-beam otherwise sometimes stops before
        # emitting anything on faint imprints (seen on the Augmentin "3 2").
        ids = model.generate(pv, max_length=24, num_beams=NUM_BEAMS, min_new_tokens=1, use_cache=True)
    return processor.batch_decode(ids, skip_special_tokens=True)[0].strip().upper()


def _best_read(img: Image.Image) -> str:
    w, h = img.size
    s = int(min(w, h) * 0.6)
    crop = img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
    # Full frame first; only pay for the center-crop read if that came back empty.
    first = _read(img)
    if _TOKEN_RE.sub("", first):
        return first
    return _read(crop)


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "model": MODEL_DIR}


@app.post("/read")
async def read_imprint(
    photo: UploadFile = File(...),
    photo2: UploadFile | None = File(default=None),
    x_reader_key: str | None = Header(default=None),
):
    if READER_KEY and x_reader_key != READER_KEY:
        raise HTTPException(status_code=401, detail="bad reader key")
    reads = []
    for up in [photo] + ([photo2] if photo2 is not None else []):
        raw = await up.read()
        if not raw:
            continue
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        reads.append(_best_read(img))
    tokens, seen = [], set()
    for r in reads:
        for t in r.split():
            t = _TOKEN_RE.sub("", t)
            if t and t not in seen:
                seen.add(t)
                tokens.append(t)
    return {"tokens": tokens, "reads": reads}
