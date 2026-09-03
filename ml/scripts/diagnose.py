"""Diagnose why a phone photo misses its pill: rank the target per zoom crop."""

import json
import sys

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import open_clip

TARGETS = ("jardiance-s-10", "empagliflozin-10-mg")

import os
INDEX = os.getenv("PV_INDEX", "index_prod.npz")
WEIGHTS = os.getenv("PV_WEIGHTS", "pill_clip_finetuned.pt")
print(f"index={INDEX} weights={WEIGHTS}")
data = np.load(INDEX)
V = data["vectors"]
meta = json.loads(str(data["meta"]))
slugs = [m["slug"] for m in meta]

model, _, _ = open_clip.create_model_and_transforms("ViT-B-32", pretrained=None)
model.load_state_dict(torch.load(WEIGHTS, map_location="cpu", weights_only=True))
model.eval()

MEAN = torch.tensor([0.48145466, 0.4578275, 0.40821073]).view(3, 1, 1)
STD = torch.tensor([0.26862954, 0.26130258, 0.27577711]).view(3, 1, 1)


def embed(img: Image.Image) -> np.ndarray:
    x = torch.from_numpy(np.asarray(img.resize((224, 224), Image.BICUBIC), dtype=np.float32) / 255.0)
    x = ((x.permute(2, 0, 1) - MEAN) / STD).unsqueeze(0)
    with torch.no_grad():
        z = F.normalize(model.encode_image(x), dim=-1)[0].numpy()
    return z


def report(path: str) -> None:
    src = Image.open(path).convert("RGB")
    w, h = src.size
    print(f"\n=== {path} ({w}x{h}) ===")
    for frac in (1.0, 0.6, 0.35, 0.25):
        side = round(min(w, h) * frac)
        left, top = (w - side) // 2, (h - side) // 2
        z = embed(src.crop((left, top, left + side, top + side)))
        sims = V @ z
        order = np.argsort(-sims)
        target_rank = next(
            (r + 1 for r, i in enumerate(order) if slugs[i] in TARGETS), None
        )
        top3 = [f"{slugs[i]}({sims[i]:.2f})" for i in order[:3]]
        print(f"crop {frac:>4}: target rank={target_rank}  top3: {', '.join(top3)}")


for p in sys.argv[1:]:
    report(p)
