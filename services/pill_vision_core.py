"""Portable pill-vision core: the encoder, the fingerprint index, and the
image maths around them.

Deliberately free of FastAPI, SQLAlchemy and anything else specific to the API
process, so the identical code runs everywhere we want it:

  * in-process inside the API (the default when PILL_MATCH_URL is unset),
  * the standalone matcher service (ml/scripts/vision_service.py),
  * a cloud GPU box later, with no code change at all.

Only the environment differs between those hosts:

    PILL_VISION_PROVIDERS  ONNX Runtime execution providers, comma separated.
                           Unset picks the best available: CUDA, then CoreML,
                           then CPU. This is the entire GPU story.
    PILL_VISION_THREADS    intra-op threads; 0 leaves it to the runtime.
    PILL_VISION_CPU_ARENA  "0" disables the CPU memory arena, trading a little
                           speed for a much smaller resident size. Worth it on
                           a memory-capped box, pointless on a GPU.
"""

from __future__ import annotations

import io
import json
import logging
import os

import numpy as np

logger = logging.getLogger(__name__)

# CLIP normalization constants
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

CATALOG_BG = (128, 128, 128)  # catalog photos sit on a neutral gray
MAX_IMAGE_PIXELS = 40_000_000  # ~6300x6300; phone photos are far below this

# How the two sides are weighted when a pill is photographed front and back.
PAIR_WEIGHT, SIDE_WEIGHT = 0.6, 0.2


class VisionInputError(ValueError):
    """The image cannot be used. Callers map this to their own 4xx."""


def providers() -> list[str]:
    """Execution providers, best first.

    Moving to a GPU host means setting PILL_VISION_PROVIDERS, or simply running
    somewhere CUDA is available and letting the auto-detection below find it.
    """
    want = [p.strip() for p in os.getenv("PILL_VISION_PROVIDERS", "").split(",") if p.strip()]
    if want:
        return want
    import onnxruntime as ort

    have = set(ort.get_available_providers())
    order = ["CUDAExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider"]
    return [p for p in order if p in have] or ["CPUExecutionProvider"]


class VisionIndex:
    """The loaded encoder plus everything derived from the fingerprint index."""

    __slots__ = ("session", "vectors", "meta", "prototype", "blanks", "attrs")

    def __init__(self, session, vectors, meta):
        self.session = session
        self.vectors = vectors
        self.meta = meta
        # "Pill-ness" prototype: the average catalog fingerprint, used to pick
        # the most pill-like crop of a user photo.
        proto = vectors.mean(axis=0)
        self.prototype = proto / (np.linalg.norm(proto) + 1e-12)
        # Embeddings of empty backgrounds: a crop that looks like these is
        # table, not pill, no matter how "catalog-like" it seems.
        self.blanks: list[np.ndarray] = []
        # Optional shape/color heads (linear classifiers over the fingerprint).
        self.attrs: dict | None = None

    def __len__(self) -> int:
        return len(self.vectors)


def load(model_path: str, index_path: str, attr_path: str | None = None) -> VisionIndex:
    """Build a VisionIndex from files already on disk."""
    import onnxruntime as ort
    from PIL import Image

    opts = ort.SessionOptions()
    if os.getenv("PILL_VISION_CPU_ARENA", "1") == "0":
        opts.enable_cpu_mem_arena = False
    threads = int(os.getenv("PILL_VISION_THREADS", "0"))
    if threads > 0:
        opts.intra_op_num_threads = threads
    session = ort.InferenceSession(model_path, sess_options=opts, providers=providers())

    data = np.load(index_path)
    index = VisionIndex(session, data["vectors"], json.loads(str(data["meta"])))
    index.blanks = [run_model(index, Image.new("RGB", (224, 224), (v, v, v))) for v in (128, 190, 235)]
    if attr_path and os.path.exists(attr_path):
        h = np.load(attr_path, allow_pickle=False)
        index.attrs = {
            k: (h[f"{k}_W"], h[f"{k}_b"], [str(c) for c in h[f"{k}_classes"]]) for k in ("shape", "color")
        }
    return index


def run_model(index: VisionIndex, img) -> np.ndarray:
    x = np.asarray(img, dtype=np.float32) / 255.0
    x = (x - MEAN) / STD
    x = x.transpose(2, 0, 1)[np.newaxis, ...]  # 1 x 3 x 224 x 224
    emb = index.session.run(None, {"image": x})[0][0]
    return emb / (np.linalg.norm(emb) + 1e-12)


def on_gray(pill, box: int):
    """Place a pill crop on a gray square canvas, catalog-style."""
    from PIL import Image

    canvas = Image.new("RGB", (box, box), CATALOG_BG)
    p = pill.copy()
    p.thumbnail((int(box * 0.9), int(box * 0.9)), Image.BICUBIC)
    canvas.paste(p, ((box - p.size[0]) // 2, (box - p.size[1]) // 2))
    return canvas


def catalog_style_single(pill):
    return on_gray(pill, 224)


def catalog_style_pair(pill_a, pill_b):
    """Place two sides side-by-side on gray, the NLM catalog photo layout
    (two pills left/right, filling most of the frame)."""
    from PIL import Image

    canvas = Image.new("RGB", (224, 224), CATALOG_BG)
    for i, p in enumerate((pill_a, pill_b)):
        cell = on_gray(p, 112)
        canvas.paste(cell, (i * 112, (224 - 112) // 2))
    return canvas


def rotations(img):
    # Training used random rotation, so two orientations are enough and halve CPU cost.
    return [img.rotate(angle, fillcolor=CATALOG_BG) for angle in (0, 180)]


def open_image(image_bytes: bytes):
    """Open an upload safely: reject absurd pixel counts before decoding."""
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(image_bytes))  # lazy: header only
    except Exception:
        raise VisionInputError("Not an image")
    w, h = img.size
    if w * h > MAX_IMAGE_PIXELS:
        raise VisionInputError("Image dimensions too large")
    if min(w, h) < 32:
        raise VisionInputError("Image too small to read")
    try:
        # Opening only read the header. This is where a truncated or corrupt
        # file actually fails, and it is still the caller's image being wrong,
        # not us being broken: it must not read as an outage upstream.
        return img.convert("RGB")
    except Exception:
        raise VisionInputError("Image data is incomplete or corrupt")


def find_pill_candidates(index: VisionIndex, img, keep: int = 2):
    """Top-N candidate crops ranked by pill-ness.

    Pill-ness = how strongly the crop resembles *some* catalog pill (best index
    similarity) minus how much it resembles an empty background. Zoom ambiguity
    is handled downstream by keeping several candidates.

    Kept deliberately small: every candidate is one model inference. Users are
    told to center the pill, so we probe the center at three zooms plus two
    near-center x-offsets at the medium zoom (5 total).
    """
    w, h = img.size
    base = min(w, h)
    vectors = index.vectors
    scored = []
    for frac in (1.0, 0.5, 0.3):
        side = min(base, max(48, int(base * frac)))
        offsets = [(0.5, 0.5)]
        if frac == 0.5:
            offsets += [(0.35, 0.5), (0.65, 0.5)]
        for fx, fy in offsets:
            cx, cy = int(w * fx), int(h * fy)
            left = min(max(0, cx - side // 2), w - side)
            top = min(max(0, cy - side // 2), h - side)
            crop = img.crop((left, top, left + side, top + side))
            emb = run_model(index, on_gray(crop, 224))
            blank_like = max(float(emb @ b) for b in index.blanks)
            score = float(np.max(vectors @ emb)) - blank_like
            scored.append((score, crop))
    scored.sort(key=lambda t: -t[0])
    return [c for _, c in scored[:keep]]


def side_sims(index: VisionIndex, image_bytes: bytes):
    """Per-index similarities for one photo, plus its normalized pill crop."""
    src = open_image(image_bytes)
    candidates = find_pill_candidates(index, src)
    variants = []
    for pill in candidates:
        variants += [run_model(index, v) for v in rotations(catalog_style_single(pill))]
    per_variant = np.stack([index.vectors @ v for v in variants])
    return per_variant.max(axis=0), candidates[0]


def pair_sims(index: VisionIndex, pill_a, pill_b):
    """Rebuild the catalog layout, both sides stacked on gray, from the two
    detected crops in both orders and rotations; each entry takes its best."""
    composites = []
    for a, b in ((pill_a, pill_b), (pill_b, pill_a)):
        composites += rotations(catalog_style_pair(a, b))
    return np.max(np.stack([index.vectors @ run_model(index, c) for c in composites]), axis=0)


def attr_probs(index: VisionIndex, emb: np.ndarray, kind: str) -> dict[str, float]:
    """Softmax probabilities over shape/color classes for one fingerprint."""
    if not index.attrs:
        return {}
    W, b, classes = index.attrs[kind]
    z = W @ emb + b
    z = np.exp(z - z.max())
    p = z / z.sum()
    return {c: float(v) for c, v in zip(classes, p)}


def attrs_for(index: VisionIndex, image_bytes: bytes) -> tuple[dict, dict]:
    """Shape and color probabilities for the pill in one photo."""
    src = open_image(image_bytes)
    crop = find_pill_candidates(index, src, keep=1)[0]
    emb = run_model(index, catalog_style_single(crop))
    return attr_probs(index, emb, "shape"), attr_probs(index, emb, "color")


def rank_slugs(index: VisionIndex, sims: np.ndarray, limit: int) -> list[tuple[str, float]]:
    """Ranked, slug-deduped hits, best first. One pill can appear in the index
    several times (several catalog photos); only its best score counts."""
    out: list[tuple[str, float]] = []
    seen: set[str] = set()
    for i in np.argsort(-sims):
        slug = index.meta[i]["slug"]
        if slug in seen:
            continue
        seen.add(slug)
        out.append((slug, float(sims[i])))
        if len(out) >= limit:
            break
    return out


def match(index: VisionIndex, raws: list[bytes], limit: int) -> list[tuple[str, float]]:
    """Rank the catalog against one or two photos of the same pill.

    With two photos each pill's score is the best of: either side alone, or the
    two sides composed into one catalog-style frame.
    """
    sides, pills = [], []
    for raw in raws:
        sims_one, crop = side_sims(index, raw)
        sides.append(sims_one)
        pills.append(crop)
    if len(sides) == 2:
        sims = (
            PAIR_WEIGHT * pair_sims(index, pills[0], pills[1])
            + SIDE_WEIGHT * sides[0]
            + SIDE_WEIGHT * sides[1]
        )
    else:
        sims = sides[0]
    return rank_slugs(index, sims, limit)
