# PillSeek ML models — what exists, how good, where it lives

All models are trained on PillSeek's own catalog (pill photos + `pillfinder.splimprint`
labels). Nothing here calls a third-party AI API. Backups live in the private Supabase
Storage bucket **`LLM_MODELS`**.

| Model | Purpose | Base | Trained on | Held-out result | File(s) in `LLM_MODELS` | Status |
|---|---|---|---|---|---|---|
| **pill-reader-base v1** (2026-09-02) | Reads the imprint text from a pill photo | `microsoft/trocr-base-printed` | 12.4K catalog images, 5 epochs, phone-style augmentation | **71.3% exact imprint, 84.4% token recall** (600 imgs from 687 pills never seen in training) | `pill-reader/pill-reader-base-v1_2026-09-02_exact71.zip` (1.15 GB) | **In production** on the iMac reader (`reader.pillseek.com`), Apple GPU, ~1 s per 2-photo read |
| pill-reader-large v1 (2026-09-02) | Same, larger | `microsoft/trocr-large-printed` | 15.2K images, 4 epochs | 73.2% exact, 81.2% token recall | `pill-reader/pill-reader-large-v1_2026-09-02_exact73.zip` (2.05 GB) | Reference/backup. Needs a GPU for acceptable speed |
| pill-reader-small v1 | Same, smallest | `microsoft/trocr-small-printed` | 12.4K images, 6 epochs | 50.7% exact, 65.3% token recall | not kept | Rejected (too weak) |
| **pill-vision encoder v1** (2026-09-01) | Visual fingerprint of a pill photo (similarity search, shape/color) | CLIP ViT-B/32 fine-tuned on 889 pills with 2+ images | — | leave-one-out top-5 48.6% over 14K images (helper signal only) | `pill-vision/pill_encoder_int8.onnx` (89 MB) | In production (API loads it) |
| pill-vision index v1 | 13,970 catalog fingerprints with real slugs | — | — | — | `pill-vision/index_prod.npz` (26 MB) | In production |
| shape/color heads v1 (2026-09-02) | Predict shape & color from a fingerprint | logistic regression on the index | 13,939 fingerprints | shape 92.0%, color 85.7% | `pill-vision/pill_attr_heads.npz` (0.1 MB) | In production (re-ranks imprint ties) |

## How the pieces fit (POST /api/identify/photo)

1. Both pill sides → **imprint reader** (`PILL_OCR_URL`) → tokens (e.g. `S10`, `3 2 X`)
2. Tokens (as read, per side, split/merged variants) → **text matcher** (`/api/identify`, exact against `pillfinder.splimprint`)
3. Photo fingerprint → **shape/color heads** re-rank ties; if no exact imprint hit, **visual similarity** fills in
4. Response lists `source: imprint | visual` per match, plus `imprint_read` and `attrs_guess`

## Retraining (Google Colab, A100, ~1 h, ~15–25 compute units)

1. `python ml/scripts/export_manifest.py` (from the repo root, venv active) → `manifest.json` (image → imprint/color/shape)
2. Upload `ml/notebooks/pillseek_ocr_small_base_colab.ipynb` (or `pillseek_ocr_colab.ipynb` for large) → run top to bottom
3. Cell 5 prints held-out accuracy; cell 6 reads uploaded phone photos; cell 7 downloads the model zip
4. Upload the zip to `LLM_MODELS/pill-reader/` with the naming pattern `pill-reader-<size>-v<N>_<date>_exact<NN>.zip`
5. On the reader box: unzip into `~/pillseek-reader/`, point `PILL_TROCR_DIR` at it, restart `com.pillseek.reader`

Ideas queued for v2: full 0–360° rotation augmentation, the ~5K new catalog photos, opt-in user photos
(real phone conditions), more epochs on base.

## Reader box (production)

iMac M1 8 GB at home → `~/pillseek-reader/ocr_service.py` (this repo: `ml/scripts/ocr_service.py`),
LaunchAgents `com.pillseek.reader` (uvicorn :8002, `PYTORCH_ENABLE_MPS_FALLBACK=1`, `PILL_TROCR_DIR=pill_trocr_base`,
`PILL_TROCR_BEAMS=1`) and `com.pillseek.tunnel` (Cloudflare Tunnel `pillseek-reader` → `https://reader.pillseek.com`).
Sleep disabled (`pmset sleep 0`). Moving the reader elsewhere = run the same service there and change `PILL_OCR_URL`.
