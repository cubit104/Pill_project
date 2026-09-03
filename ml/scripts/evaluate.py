"""Leave-one-out accuracy test for the pill fingerprint index.

For every pill that has 2+ images in index.npz: take one image as the "user
photo", search the rest of the index, and check whether the same pill (same
slug, or same medicine name) appears in the top-1 / top-5 results.

Usage:
    python evaluate.py
"""

import json

import numpy as np


def main() -> None:
    data = np.load("index.npz")
    vectors = data["vectors"]
    meta = json.loads(str(data["meta"]))
    slugs = [m["slug"] for m in meta]
    names = [(m["name"] or "").strip().lower() for m in meta]

    by_slug: dict[str, list[int]] = {}
    for i, s in enumerate(slugs):
        by_slug.setdefault(s, []).append(i)

    eval_indices = [idx for ids in by_slug.values() if len(ids) >= 2 for idx in ids]
    print(f"{len(vectors)} images, {len(by_slug)} pills, "
          f"{len(eval_indices)} query images (from pills with 2+ images)")

    top1 = top5 = 0
    misses = []
    for qi in eval_indices:
        sims = vectors @ vectors[qi]
        sims[qi] = -1.0  # exclude the query image itself
        ranked = np.argsort(-sims)[:5]
        hit_ranks = [
            r for r, i in enumerate(ranked)
            if slugs[i] == slugs[qi] or (names[qi] and names[i] == names[qi])
        ]
        if hit_ranks:
            top5 += 1
            if hit_ranks[0] == 0:
                top1 += 1
        else:
            misses.append((meta[qi]["name"], meta[qi]["file"], meta[ranked[0]]["name"]))

    n = len(eval_indices)
    print(f"\nTop-1 accuracy: {top1}/{n} = {100 * top1 / n:.1f}%")
    print(f"Top-5 accuracy: {top5}/{n} = {100 * top5 / n:.1f}%")
    if misses:
        print("\nSample misses (actual → predicted):")
        for name, f, pred in misses[:10]:
            print(f"  {name} [{f}] → {pred}")


if __name__ == "__main__":
    main()
