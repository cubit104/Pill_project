"""Visual pill identification from a photo.

POST /api/identify/photo accepts an image, embeds it with a fine-tuned CLIP
encoder (quantized ONNX, no torch dependency), and matches it against a
precomputed fingerprint index of the pill photo library. The photo is
processed in memory only — never written to disk or stored.

Model/index files are configured via env:
    PILL_VISION_MODEL  (default: pill_vision/pill_encoder_int8.onnx)
    PILL_VISION_INDEX  (default: pill_vision/index_prod.npz)
If the files are absent the endpoint returns 503 and the rest of the API is
unaffected.
"""

import asyncio
import io
import itertools
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import text

import database
from routes.identify import IdentifyRequest, identify_pill
from routes.identify_feedback import record_capture
from routes.site_settings import read_flags
from utils import process_image_filenames

logger = logging.getLogger(__name__)

router = APIRouter()

VISION_DIR = os.getenv("PILL_VISION_DIR", "pill_vision")
MODEL_PATH = os.getenv("PILL_VISION_MODEL", os.path.join(VISION_DIR, "pill_encoder_int8.onnx"))
INDEX_PATH = os.getenv("PILL_VISION_INDEX", os.path.join(VISION_DIR, "index_prod.npz"))
ATTR_PATH = os.getenv("PILL_VISION_ATTRS", os.path.join(VISION_DIR, "pill_attr_heads.npz"))
# In-house imprint reader (TrOCR fine-tune) service; unset/empty = disabled
# (the endpoint then returns visual matches only).
OCR_URL = os.getenv("PILL_OCR_URL", "")
OCR_TIMEOUT = float(os.getenv("PILL_OCR_TIMEOUT", "60"))
OCR_KEY = os.getenv("PILL_OCR_KEY", "")  # shared secret expected by the reader service
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
TOP_K = 6
# Per-client rate limit for photo identification (each call costs reader + model time).
RATE_LIMIT_PER_HOUR = int(os.getenv("PILL_PHOTO_RATE_LIMIT_PER_HOUR", "30"))
_rate_lock = threading.Lock()
_rate_hits: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    """Best-effort client address for rate limiting.

    Cloudflare sets CF-Connecting-IP (trusted). Otherwise use the LAST
    X-Forwarded-For hop — appended by our own proxy — since earlier entries
    are client-controlled and trivially spoofable.
    """
    cf = request.headers.get("cf-connecting-ip", "").strip()
    if cf:
        return cf
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(ip: str) -> None:
    import time

    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_hits.get(ip, []) if now - t < 3600]
        if len(hits) >= RATE_LIMIT_PER_HOUR:
            raise HTTPException(status_code=429, detail="Too many identifications; please try again later.")
        hits.append(now)
        _rate_hits[ip] = hits
        if len(_rate_hits) > 10000:  # keep the table bounded
            for k in [k for k, v in _rate_hits.items() if not v or now - v[-1] > 3600]:
                _rate_hits.pop(k, None)

# CLIP normalization constants
_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

_lock = threading.Lock()
_state: dict = {"loaded": False, "session": None, "vectors": None, "meta": None}
# Identifications run on their own small pool so they can never starve the
# default executor (used by /health and the rest of the API). Extra requests
# queue here instead of piling onto shared workers.
_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.getenv("PILL_PHOTO_WORKERS", "2")), thread_name_prefix="pill-id")

_DISCLAIMER = (
    "Visual matches are informational only and not a medical identification. "
    "Always confirm with a pharmacist before taking any medication."
)


def _load():
    """Lazy-load the ONNX session and index on first request."""
    with _lock:
        if _state["loaded"]:
            return
        from services.model_assets import assets_present, ensure_pill_vision_assets

        if not assets_present():
            # Don't block a user request on a 115 MB download: the startup
            # prefetch handles it; until then answer quickly.
            if not ensure_pill_vision_assets(wait=False):
                raise HTTPException(
                    status_code=503,
                    detail="Visual identification is warming up; please try again in a minute.",
                )
        if not (os.path.exists(MODEL_PATH) and os.path.exists(INDEX_PATH)):
            raise HTTPException(
                status_code=503,
                detail="Visual identification is not available on this deployment.",
            )
        import onnxruntime as ort

        _state["session"] = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        data = np.load(INDEX_PATH)
        _state["vectors"] = data["vectors"]
        _state["meta"] = json.loads(str(data["meta"]))
        # "Pill-ness" prototype: the average catalog fingerprint, used to
        # pick the most pill-like crop of a user photo.
        proto = _state["vectors"].mean(axis=0)
        _state["prototype"] = proto / (np.linalg.norm(proto) + 1e-12)
        # Embeddings of empty backgrounds: a crop that looks like these is
        # table, not pill, no matter how "catalog-like" it seems.
        from PIL import Image

        _state["blanks"] = [
            _run_model(Image.new("RGB", (224, 224), (v, v, v))) for v in (128, 190, 235)
        ]
        # Optional shape/color heads (linear classifiers over the fingerprint).
        _state["attrs"] = None
        if os.path.exists(ATTR_PATH):
            h = np.load(ATTR_PATH, allow_pickle=False)
            _state["attrs"] = {
                k: (h[f"{k}_W"], h[f"{k}_b"], [str(c) for c in h[f"{k}_classes"]]) for k in ("shape", "color")
            }
        _state["loaded"] = True
        logger.info(
            "pill-vision loaded: %d fingerprints, model=%s", len(_state["vectors"]), MODEL_PATH
        )


def _run_model(img) -> np.ndarray:
    x = np.asarray(img, dtype=np.float32) / 255.0
    x = (x - _MEAN) / _STD
    x = x.transpose(2, 0, 1)[np.newaxis, ...]  # 1 x 3 x 224 x 224
    emb = _state["session"].run(None, {"image": x})[0][0]
    return emb / (np.linalg.norm(emb) + 1e-12)


_CATALOG_BG = (128, 128, 128)  # catalog photos sit on a neutral gray


def _find_pill(img):
    """Locate the pill in a phone photo and return a tight square crop.

    Uses the embedding model as a detector: candidate crops at several scales
    and positions are scored by similarity to the average catalog fingerprint
    ("pill-ness"), and the most pill-like crop wins. Robust to low-contrast
    pills on similar-colored tables where background subtraction fails.
    """
    from PIL import Image

    return _find_pill_candidates(img)[0]


def _find_pill_candidates(img, keep: int = 2):
    """Top-N candidate crops ranked by pill-ness.

    Pill-ness = how strongly the crop resembles *some* catalog pill (best
    index similarity) minus how much it resembles an empty background. Zoom
    ambiguity is handled downstream by keeping several candidates.

    Kept deliberately small — every candidate is one model inference on CPU.
    Users are told to center the pill, so we probe the center at three zooms
    plus two near-center x-offsets at the medium zoom (5 total).
    """
    w, h = img.size
    base = min(w, h)
    vectors = _state["vectors"]
    scored = []
    for frac in (1.0, 0.5, 0.3):
        side = max(48, int(base * frac))
        offsets = [(0.5, 0.5)]
        if frac == 0.5:
            offsets += [(0.35, 0.5), (0.65, 0.5)]
        for fx, fy in offsets:
            cx, cy = int(w * fx), int(h * fy)
            left = min(max(0, cx - side // 2), w - side)
            top = min(max(0, cy - side // 2), h - side)
            crop = img.crop((left, top, left + side, top + side))
            emb = _run_model(_on_gray(crop, 224))
            blank_like = max(float(emb @ b) for b in _state["blanks"])
            score = float(np.max(vectors @ emb)) - blank_like
            scored.append((score, crop))
    scored.sort(key=lambda t: -t[0])
    return [c for _, c in scored[:keep]]


def _on_gray(pill, box: int) -> "Image":
    """Place a pill crop on a gray square canvas, catalog-style."""
    from PIL import Image

    canvas = Image.new("RGB", (box, box), _CATALOG_BG)
    p = pill.copy()
    p.thumbnail((int(box * 0.9), int(box * 0.9)), Image.BICUBIC)
    canvas.paste(p, ((box - p.size[0]) // 2, (box - p.size[1]) // 2))
    return canvas


def _catalog_style_single(pill) -> "Image":
    return _on_gray(pill, 224)


def _catalog_style_pair(pill_a, pill_b) -> "Image":
    """Place two sides side-by-side on gray — the NLM catalog photo layout
    (two pills left/right, filling most of the frame)."""
    from PIL import Image

    canvas = Image.new("RGB", (224, 224), _CATALOG_BG)
    for i, p in enumerate((pill_a, pill_b)):
        cell = _on_gray(p, 112)
        canvas.paste(cell, (i * 112, (224 - 112) // 2))
    return canvas


def _rotations(img):
    # Training used random rotation, so two orientations are enough and halve CPU cost.
    return [img.rotate(angle, fillcolor=_CATALOG_BG) for angle in (0, 180)]


MAX_IMAGE_PIXELS = 40_000_000  # ~6300x6300; phone photos are far below this


def _open_image(image_bytes: bytes):
    """Open an upload safely: reject absurd pixel counts before decoding."""
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))  # lazy: header only
    w, h = img.size
    if w * h > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=422, detail="Image dimensions too large")
    return img.convert("RGB")


def _side_sims(image_bytes: bytes) -> tuple[np.ndarray, "Image"]:
    """Per-index similarities for one photo plus its normalized pill crop."""
    src = _open_image(image_bytes)
    candidates = _find_pill_candidates(src)
    variants = []
    for pill in candidates:
        variants += [_run_model(v) for v in _rotations(_catalog_style_single(pill))]
    per_variant = np.stack([_state["vectors"] @ v for v in variants])
    return per_variant.max(axis=0), candidates[0]


# Scores from leave-one-out variants are scaled by this, so a pill that only
# matches after discarding a read token can never reach the 0.85 exact-hit
# shortcut: the visual stage still runs and must confirm it.
_LOO_WEIGHT = 0.8
_MAX_VARIANTS = 16
# A leave-one-out imprint hit counts as visually confirmed when its pill is
# within this many places of the visual ranking.
_VISUAL_CONFIRM_RANK = 25
# Variant lookups are independent SQL queries; run them side by side on their
# own pool (never on _EXECUTOR: an identification already occupies one of
# those workers and would deadlock waiting on itself).
_VARIANT_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.getenv("PILL_VARIANT_WORKERS", "6")), thread_name_prefix="pill-var")


def _token_variants(tokens: list[str], side_reads: list[str] | None = None) -> list[tuple[list[str], float]]:
    """Ways the reader's text may map onto catalog tokenization, with a weight.

    Catalog stores "S;10" while the reader may say "S10"; a logo side may be
    misread as a plausible code ("A-011"). So we try: the combined read, each
    side alone, and for each of those the letter/digit-split and fully-merged
    forms. The best score per pill across variants wins downstream.
    """
    import re as _re

    def norm(ts: list[str]) -> list[str]:
        return [t for t in ts if t]

    def split(ts: list[str]) -> list[str]:
        out: list[str] = []
        for t in ts:
            out += [p for p in _re.findall(r"[A-Z]+|[0-9]+", t) if p]
        return out

    bases: list[list[str]] = [norm(tokens)]
    for read in side_reads or []:
        side = norm(_re.split(r"[;,\s]+", read.upper()))
        if side and side not in bases:
            bases.append(side)

    variants: list[tuple[list[str], float]] = []
    seen: list[list[str]] = []

    def add(v, weight):
        if v and v not in seen:
            seen.append(v)
            variants.append((v, weight))

    for b in bases:
        for v in (b, split(b), ["".join(b)] if len(b) > 1 else None):
            add(v, 1.0)
    # Leave-one-out: a phone read often carries one phantom fragment
    # ("BX DX 2" for a "BX 2" pill). Dropping each token in turn lets the true
    # pill surface, but down-weighted (_LOO_WEIGHT) so it is never treated as
    # an exact hit: the visual stage must confirm it. Interleaved across bases
    # (combined read, side 1, side 2) so the cap never starves a later side.
    loo_lists = [[b[:i] + b[i + 1:] for i in range(len(b))] for b in bases if 3 <= len(b) <= 5]
    for round_ in itertools.zip_longest(*loo_lists):
        for v in round_:
            if v:
                add(v, _LOO_WEIGHT)
    return variants[:_MAX_VARIANTS]


def _attr_probs(emb: np.ndarray, kind: str) -> dict[str, float]:
    """Softmax probabilities over shape/color classes for one fingerprint."""
    heads = _state.get("attrs")
    if not heads:
        return {}
    W, b, classes = heads[kind]
    z = W @ emb + b
    z = np.exp(z - z.max())
    p = z / z.sum()
    return {c: float(v) for c, v in zip(classes, p)}


def _base_word(label: str) -> str:
    return (label or "").upper().split(",")[0].split("(")[0].split("/")[0].strip().split(" ")[0]


def _rerank_by_attrs(matches: list[dict], shape_p: dict, color_p: dict) -> list[dict]:
    """Let the photo's predicted shape/color break ties between imprint hits."""
    if not matches or not (shape_p or color_p):
        return matches
    by_shape = {}
    for c, v in shape_p.items():
        by_shape[_base_word(c)] = max(by_shape.get(_base_word(c), 0.0), v)
    by_color = {}
    for c, v in color_p.items():
        by_color[_base_word(c)] = max(by_color.get(_base_word(c), 0.0), v)
    for m in matches:
        ps = by_shape.get(_base_word(m.get("shape", "")), 0.0)
        pc = by_color.get(_base_word(m.get("color", "")), 0.0)
        m["similarity"] = round(m["similarity"] * (0.75 + 0.15 * ps + 0.10 * pc), 3)
        m["attr_fit"] = round(0.6 * ps + 0.4 * pc, 2)
    matches.sort(key=lambda m: -m["similarity"])
    return matches


@router.post("/api/identify/photo")
async def identify_photo(
    request: Request,
    photo: UploadFile = File(...),
    photo2: UploadFile | None = File(default=None),
    consent: str | None = Form(default=None),
):
    _check_rate_limit(_client_ip(request))
    """Match one or two photos (front/back). With two, each pill's score is the
    best of: either side alone, or the averaged two-side embedding."""
    # The beta switch (Admin → Settings) gates the API too, not just the UI.
    if not (await asyncio.to_thread(read_flags)).get("photo_id_enabled"):
        raise HTTPException(status_code=404, detail="Photo identification is not enabled")

    uploads = [photo] + ([photo2] if photo2 is not None else [])
    raws: list[bytes] = []
    for up in uploads:
        raw = await _read_bounded(up)
        if raw:
            raws.append(raw)
    if not raws:
        raise HTTPException(status_code=422, detail="Empty upload")

    # Everything below is CPU-bound (ONNX, DB); keep it off the event loop
    # and off the shared default executor.
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(_EXECUTOR, _identify_sync, raws)

    # Learning loop: log the identification (photos kept only with explicit consent).
    keep_photos = str(consent or "").lower() in ("1", "true", "yes", "on")
    result["capture_id"] = await asyncio.to_thread(
        record_capture,
        result.get("imprint_read", ""),
        (result.get("imprint_read") or "").split(),
        result.get("attrs_guess") or {},
        [m["slug"] for m in result.get("matches", [])],
        keep_photos,
        raws if keep_photos else [],
    )
    return result


async def _read_bounded(up: UploadFile) -> bytes:
    """Read an upload in chunks, rejecting it as soon as it exceeds the limit."""
    chunks, total = [], 0
    while True:
        chunk = await up.read(1 << 20)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Photo too large (max 20MB)")
        chunks.append(chunk)
    return b"".join(chunks)


def _identify_sync(raws: list[bytes]) -> dict:

    # 1) Imprint reader first — it is the primary signal.
    imprint_read = ""
    imprint_matches: list[dict] = []
    tokens, side_reads = asyncio.run(_read_imprint(raws))
    if tokens:
        imprint_read = " ".join(tokens)
        try:
            best: dict[str, tuple[float, object, float]] = {}
            variants = _token_variants(tokens, side_reads)
            results = list(_VARIANT_EXECUTOR.map(
                lambda vw: identify_pill(IdentifyRequest(imprint_tokens=vw[0], limit=TOP_K)), variants))
            for (variant, weight), text_result in zip(variants, results):
                for c in text_result.candidates:
                    if c.score < 0.5:  # inclusion is judged on the raw text score
                        continue
                    score = c.score * weight  # ranking / shortcut use the weighted one
                    if c.slug not in best or score > best[c.slug][0]:
                        best[c.slug] = (score, c, weight)
            for score, c, weight in sorted(best.values(), key=lambda sc: -sc[0]):
                imprint_matches.append(
                    {
                        "slug": c.slug,
                        "similarity": score,
                        "lossy": weight < 1.0,
                        "medicine_name": c.medicine_name,
                        "splimprint": c.splimprint,
                        "color": c.color,
                        "shape": c.shape,
                        "strength": c.strength,
                        "image_urls": c.image_urls,
                        "source": "imprint",
                    }
                )
        except Exception:
            logger.warning("imprint text match failed", exc_info=True)

    # 1b) Let the photo vote on shape/color to order imprint ties
    #     (e.g. "119" on a round pill vs. "119" on an oblong one).
    attrs_guess = {}
    if imprint_matches and len(imprint_matches) > 1:
        try:
            _load()
            from PIL import Image

            src = _open_image(raws[0])
            crop = _find_pill_candidates(src, keep=1)[0]
            emb = _run_model(_catalog_style_single(crop))
            shape_p, color_p = _attr_probs(emb, "shape"), _attr_probs(emb, "color")
            imprint_matches = _rerank_by_attrs(imprint_matches, shape_p, color_p)
            top_shape = max(shape_p, key=shape_p.get) if shape_p else ""
            top_color = max(color_p, key=color_p.get) if color_p else ""
            attrs_guess = {"shape": top_shape, "color": top_color}
        except Exception:
            logger.warning("attribute re-rank failed", exc_info=True)

    # 2) Exact imprint hit → done; skip the (slow) visual matching entirely.
    #    (Leave-one-out hits are capped at _LOO_WEIGHT and can't get here.)
    if imprint_matches and imprint_matches[0]["similarity"] >= 0.85:
        return {"matches": _public(imprint_matches[:TOP_K]), "imprint_read": imprint_read, "attrs_guess": attrs_guess, "disclaimer": _DISCLAIMER}

    # 3) Otherwise visual matching fills in / breaks ties. If the visual
    #    stage is unavailable, still return whatever the imprint gave us.
    side_sims = []
    pills = []
    try:
        _load()
    except HTTPException:
        if imprint_matches:
            # No visual confirmation possible: full-read hits before any
            # leave-one-out guess, whatever their scores.
            ordered = sorted(imprint_matches, key=lambda m: (m["lossy"], -m["similarity"]))
            return {"matches": _public(ordered[:TOP_K]), "imprint_read": imprint_read,
                    "attrs_guess": attrs_guess, "disclaimer": _DISCLAIMER}
        raise
    for raw in raws:
        try:
            sims_one, pill_crop = _side_sims(raw)
            side_sims.append(sims_one)
            pills.append(pill_crop)
        except HTTPException:
            raise
        except Exception:
            logger.warning("pill-vision embed failed", exc_info=True)
            raise HTTPException(status_code=422, detail="Could not read that image")

    if len(side_sims) == 2:
        # Rebuild the catalog layout — both sides stacked on gray — from the
        # two detected pill crops, in both orders and rotations, and let each
        # index entry take its best score. Single-side scores assist.
        composites = []
        for a, b in ((pills[0], pills[1]), (pills[1], pills[0])):
            composites += _rotations(_catalog_style_pair(a, b))
        pair_sims = np.max(np.stack([_state["vectors"] @ _run_model(c) for c in composites]), axis=0)
        sims = 0.6 * pair_sims + 0.2 * side_sims[0] + 0.2 * side_sims[1]
    else:
        sims = side_sims[0]
    ranked = np.argsort(-sims)

    top: list[tuple[str, float]] = []
    seen = set()
    for i in ranked:
        slug = _state["meta"][i]["slug"]
        if slug in seen:
            continue
        seen.add(slug)
        top.append((slug, float(sims[i])))
        if len(top) >= TOP_K:
            break

    # Join pill details so the frontend can render proper cards.
    details = {}
    if not database.db_engine:
        database.connect_to_database()
    if database.db_engine and top:
        try:
            with database.db_engine.connect() as conn:
                rows = conn.execute(
                    text(
                        "SELECT slug, medicine_name, splimprint, splcolor_text, "
                        "splshape_text, spl_strength, image_filename "
                        "FROM pillfinder WHERE deleted_at IS NULL AND published = true "
                        "AND slug = ANY(:slugs)"
                    ),
                    {"slugs": [s for s, _ in top]},
                ).fetchall()
            details = {r[0]: r for r in rows}
        except Exception:
            logger.warning("pill-vision detail join failed", exc_info=True)

    matches = []
    for slug, sim in top:
        row = details.get(slug)
        if row is None:
            # Not in the live published set (unpublished/deleted since the
            # index was built) — never surface a link that would 404.
            continue
        matches.append(
            {
                "slug": slug,
                "similarity": round(sim, 3),
                "medicine_name": row[1] if row else slug.replace("-", " "),
                "splimprint": (row[2] or "") if row else "",
                "color": (row[3] or "") if row else "",
                "shape": (row[4] or "") if row else "",
                "strength": (row[5] or "") if row else "",
                "image_urls": process_image_filenames(row[6] or "")["image_urls"] if row else [],
            }
        )

    for m in matches:
        m["source"] = "visual"

    # Leave-one-out imprint hits are only guesses: keep them ahead of the
    # visual results when the photo itself ranks that pill near the top,
    # otherwise push them behind the visual matches.
    visual_rank: dict[str, int] = {}
    for i in ranked:
        slug = _state["meta"][i]["slug"]
        if slug not in visual_rank:
            visual_rank[slug] = len(visual_rank)
            if len(visual_rank) >= _VISUAL_CONFIRM_RANK:
                break
    confirmed = [m for m in imprint_matches if not m["lossy"] or m["slug"] in visual_rank]
    unconfirmed = [m for m in imprint_matches if m["lossy"] and m["slug"] not in visual_rank]
    seen_slugs = {m["slug"] for m in imprint_matches}
    fused = confirmed + [m for m in matches if m["slug"] not in seen_slugs] + unconfirmed
    return {"matches": _public(fused[:TOP_K + 2]), "imprint_read": imprint_read, "attrs_guess": attrs_guess, "disclaimer": _DISCLAIMER}


def _public(matches: list[dict]) -> list[dict]:
    """Drop internal bookkeeping before the matches leave the API."""
    return [{k: v for k, v in m.items() if k != "lossy"} for m in matches]


async def _read_imprint(raws: list[bytes]) -> tuple[list[str], list[str]]:
    """Ask the imprint-reader service for tokens; [] if disabled/unavailable."""
    if not OCR_URL or not raws:
        return [], []
    files = {"photo": ("a.jpg", raws[0], "image/jpeg")}
    if len(raws) > 1:
        files["photo2"] = ("b.jpg", raws[1], "image/jpeg")
    try:
        headers = {"User-Agent": "PillSeek-API/1.0 (+https://pillseek.com)"}
        if OCR_KEY:
            headers["X-Reader-Key"] = OCR_KEY
        async with httpx.AsyncClient(timeout=OCR_TIMEOUT) as client:
            r = await client.post(OCR_URL, files=files, headers=headers)
        r.raise_for_status()
        j = r.json()
        tokens = [t for t in j.get("tokens", []) if t][:12]
        reads = [str(x).strip() for x in j.get("reads", []) if str(x).strip()]
        return tokens, reads
    except Exception as e:
        logger.warning("imprint reader unavailable: %s", e)
        return [], []
