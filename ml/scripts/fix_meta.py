"""Rewrite index_full.npz metadata: sanitized Colab folder labels -> real slugs.

The Colab index stored each image under a sanitized label (slug lowercased,
trailing -N stripped, odd chars replaced with _). Production needs the real
pillfinder slug so the backend can join names/images. pills.json still holds
the original slugs, so rebuild the mapping the same way Colab built labels.
"""

import json
import re

import numpy as np

rows = json.load(open("pills.json", encoding="utf-8-sig"))
if isinstance(rows, dict):
    rows = rows.get("value", rows)

label_to_slug: dict[str, str] = {}
for r in rows:
    slug = r["slug"]
    # Colab's regex had doubled backslashes, so the -N strip never applied
    # there; build both variants to be safe. First occurrence wins.
    for candidate in (slug[:150], re.sub(r"-\d+$", "", slug)[:150]):
        label = re.sub(r"[^a-z0-9-]", "_", candidate)
        label_to_slug.setdefault(label, slug)

import sys
IN = sys.argv[1] if len(sys.argv) > 1 else "index_full.npz"
OUT = sys.argv[2] if len(sys.argv) > 2 else "index_prod.npz"
data = np.load(IN)
meta = json.loads(str(data["meta"]))
fixed = missing = 0
for m in meta:
    real = label_to_slug.get(m["slug"])
    if real:
        m["slug"] = real
        fixed += 1
    else:
        missing += 1

np.savez_compressed(OUT, vectors=data["vectors"], meta=json.dumps(meta))
print(f"fixed {fixed}, unmatched {missing} -> {OUT}")
