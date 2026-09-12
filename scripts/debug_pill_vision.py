"""Debug helper: show where a target pill ranks for two phone photos and dump
the normalized crops/composite the matcher actually sees.

Runs the matching maths directly, from local files, whatever PILL_MATCH_URL is
set to; this is about inspecting the model, not the deployment.

Usage (from repo root, venv active):
    python scripts/debug_pill_vision.py photoA.jpg photoB.jpg target-slug-substring out_dir
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from services import pill_vision_core as core  # noqa: E402

VISION_DIR = os.getenv("PILL_VISION_DIR", "pill_vision")
MODEL_PATH = os.getenv("PILL_VISION_MODEL", os.path.join(VISION_DIR, "pill_encoder_int8.onnx"))
INDEX_PATH = os.getenv("PILL_VISION_INDEX", os.path.join(VISION_DIR, "index_prod.npz"))
ATTR_PATH = os.getenv("PILL_VISION_ATTRS", os.path.join(VISION_DIR, "pill_attr_heads.npz"))


def rank_of(index, sims, needle):
    seen = set()
    r = 0
    for i in np.argsort(-sims):
        s = index.meta[i]["slug"]
        if s in seen:
            continue
        seen.add(s)
        r += 1
        if needle in s:
            return r, s, float(sims[i])
    return None, None, None


def main():
    a_path, b_path, needle, out = sys.argv[1:5]
    os.makedirs(out, exist_ok=True)
    index = core.load(MODEL_PATH, INDEX_PATH, ATTR_PATH)
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    pa = core.find_pill_candidates(index, a)[0]
    pb = core.find_pill_candidates(index, b)[0]
    core.catalog_style_single(pa).save(os.path.join(out, "side_a.png"))
    core.catalog_style_single(pb).save(os.path.join(out, "side_b.png"))
    core.catalog_style_pair(pa, pb).save(os.path.join(out, "composite.png"))

    sa, _ = core.side_sims(index, open(a_path, "rb").read())
    sb, _ = core.side_sims(index, open(b_path, "rb").read())
    print("side A alone :", rank_of(index, sa, needle))
    print("side B alone :", rank_of(index, sb, needle))
    pair = core.pair_sims(index, pa, pb)
    print("composite    :", rank_of(index, pair, needle))
    final = core.PAIR_WEIGHT * pair + core.SIDE_WEIGHT * sa + core.SIDE_WEIGHT * sb
    print("final blend  :", rank_of(index, final, needle))
    print("top5 final   :", [s for s, _ in core.rank_slugs(index, final, 5)])


if __name__ == "__main__":
    main()
