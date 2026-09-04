"""Debug helper: show where a target pill ranks for two phone photos and dump
the normalized crops/composite the matcher actually sees.

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

from routes import identify_photo as ip  # noqa: E402


def rank_of(sims, needle):
    order = np.argsort(-sims)
    seen = set()
    r = 0
    for i in order:
        s = ip._state["meta"][i]["slug"]
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
    ip._load()
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    pa, pb = ip._find_pill(a), ip._find_pill(b)
    ip._catalog_style_single(pa).save(os.path.join(out, "side_a.png"))
    ip._catalog_style_single(pb).save(os.path.join(out, "side_b.png"))
    comp = ip._catalog_style_pair(pa, pb)
    comp.save(os.path.join(out, "composite.png"))

    sa, _ = ip._side_sims(open(a_path, "rb").read())
    sb, _ = ip._side_sims(open(b_path, "rb").read())
    print("side A alone :", rank_of(sa, needle))
    print("side B alone :", rank_of(sb, needle))
    comps = []
    for x, y in ((pa, pb), (pb, pa)):
        comps += ip._rotations(ip._catalog_style_pair(x, y))
    pair = np.max(np.stack([ip._state["vectors"] @ ip._run_model(c) for c in comps]), axis=0)
    print("composite    :", rank_of(pair, needle))
    final = 0.6 * pair + 0.2 * sa + 0.2 * sb
    print("final blend  :", rank_of(final, needle))
    order = np.argsort(-final)[:5]
    print("top5 final   :", [ip._state["meta"][i]["slug"] for i in order])


if __name__ == "__main__":
    main()
