"""Benchmark a fine-tuned TrOCR pill reader on a few photos.

Usage:
    python ml/scripts/bench_reader.py --model pill_trocr_base photo1.jpg photo2.jpg ...
"""

import argparse
import os
import time

import torch
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.getenv("PILL_TROCR_DIR", "pill_trocr_base"))
    ap.add_argument("--beams", type=int, nargs="+", default=[1, 2])
    ap.add_argument("photos", nargs="+")
    args = ap.parse_args()

    torch.set_num_threads(os.cpu_count() or 4)
    proc = TrOCRProcessor.from_pretrained(args.model)
    model = VisionEncoderDecoderModel.from_pretrained(args.model).eval()
    model.config.use_cache = True
    model.generation_config.use_cache = True
    imgs = {os.path.basename(p): Image.open(p).convert("RGB") for p in args.photos}

    def read(img, beams):
        pv = proc(images=img, return_tensors="pt").pixel_values
        with torch.no_grad():
            ids = model.generate(pv, max_length=24, num_beams=beams, min_new_tokens=1, use_cache=True)
        return proc.batch_decode(ids, skip_special_tokens=True)[0].strip().upper()

    for beams in args.beams:
        t = time.time()
        out = {k: read(v, beams) for k, v in imgs.items()}
        print(f"beams={beams}: {out}  ({(time.time() - t) / len(imgs):.1f}s per photo)", flush=True)


if __name__ == "__main__":
    main()
