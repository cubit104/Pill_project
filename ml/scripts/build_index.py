"""Build a visual fingerprint index from PillSeek pill images.

Reads pill slugs + image URLs from the locally running backend
(http://localhost:8000/api/slugs/images), downloads each image into memory
one at a time, computes a CLIP embedding, and saves everything to index.npz.
No files are written except the index; no changes are made to Supabase.

Usage:
    python build_index.py --max-pills 150
"""

import argparse
import io
import json
import sys
import time

import numpy as np
import requests
from PIL import Image
from sentence_transformers import SentenceTransformer

API = "http://localhost:8000"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-pills", type=int, default=150)
    parser.add_argument("--out", default="index.npz")
    args = parser.parse_args()

    print("Loading CLIP model (first run downloads ~600MB)...")
    model = SentenceTransformer("clip-ViT-B-32")

    print("Fetching pill list from local backend...")
    rows = requests.get(f"{API}/api/slugs/images", timeout=120).json()

    # Random sample (fixed seed) — the catalog is alphabetical, so taking the
    # head over-samples near-identical birth-control pills.
    import random
    random.Random(42).shuffle(rows)
    # Prefer pills with 2+ images so the evaluation can do leave-one-out.
    multi = [r for r in rows if len(r.get("images", [])) >= 2]
    single = [r for r in rows if len(r.get("images", [])) == 1]
    picked = (multi + single)[: args.max_pills]
    print(f"{len(rows)} pills available; indexing {len(picked)} "
          f"({sum(1 for r in picked if len(r['images']) >= 2)} with 2+ images)")

    vectors, filenames, slugs, names = [], [], [], []
    seen_files = set()
    t0 = time.time()
    for i, row in enumerate(picked):
        # Group name: slug minus any trailing duplicate suffix like "-1"/"-2",
        # so near-duplicate pill entries count as the same medicine in evaluation.
        import re
        group = re.sub(r"-\d+$", "", row["slug"])
        for url in row["images"][:6]:
            fname = url.rsplit("/", 1)[-1]
            if fname in seen_files or "placeholder" in fname:
                continue
            try:
                resp = requests.get(url, timeout=30)
                resp.raise_for_status()
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
            except Exception as e:
                print(f"  skip {fname}: {e}")
                continue
            vec = model.encode(img, normalize_embeddings=True)
            vectors.append(vec)
            filenames.append(fname)
            slugs.append(row["slug"])
            names.append(group)
            seen_files.add(fname)
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(picked)} pills, {len(vectors)} images, "
                  f"{time.time() - t0:.0f}s elapsed")

    if not vectors:
        sys.exit("No images indexed — is the backend running on :8000?")

    np.savez_compressed(
        args.out,
        vectors=np.array(vectors, dtype=np.float32),
        meta=json.dumps(
            [{"file": f, "slug": s, "name": n} for f, s, n in zip(filenames, slugs, names)]
        ),
    )
    print(f"Done: {len(vectors)} image fingerprints from {len(picked)} pills → {args.out} "
          f"({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
