"""Generates pillseek_ocr_v2_colab.ipynb (round-3 imprint reader training, base + large in one run).

Run:  python ml/notebooks/make_ocr_v2_notebook.py
Kept as a script so the notebook source is reviewable in diffs.

Design goals (learned the hard way):
- Everything reusable lives in the Supabase bucket LLM_MODELS/training-cache (images zip, cut-outs zip,
  per-epoch checkpoints, finished zips) so a dead session never means a re-download or a restart.
- Both sizes train in one run; each epoch is checkpointed and resumed automatically.
- Phone-style synthesis without fake outline shadows (v2 read the outline as a "1").
"""
import json
import os

CELLS: list[tuple[str, str]] = []


def md(src):
    CELLS.append(("markdown", src))


def code(src):
    CELLS.append(("code", src))


# The production pill locator, copied verbatim into cell 10 so phone-photo tests match the reader.
_READER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "ml", "scripts", "ocr_service.py")
_src = open(_READER, encoding="utf-8").read()
LOCATOR = (_src[_src.index("def _integral("):_src.index("def _crop_pad(")].rstrip() + "\n"
           + _src[_src.index("def _crop_pad("):_src.index("def _views(")].rstrip() + "\n").replace('"""', '\"\"\"')

md("""# PillSeek — imprint reader v2 (phone-tolerant TrOCR, base + large in one run)
Runtime → Change runtime type → **A100 GPU**. Run cells top to bottom (or Runtime → Run all).

**Cache = your Supabase bucket `LLM_MODELS`** (folder `training-cache/`): images, cut-outs, checkpoints and
finished models are stored there, so a dropped session resumes at the last finished epoch and nothing is
downloaded twice. The v1 models are read straight from `LLM_MODELS/pill-reader/`.

**One-time setup:** click the key icon (Secrets) on the left → *Add new secret* → name `SUPABASE_SERVICE_KEY`,
value = the *service_role* key from Supabase → Project Settings → API → toggle *Notebook access* on.
Keep the laptop awake while it runs (~1 h base + ~2.5 h large).""")

code("""# 1) Install
!pip -q install transformers==4.46.3 "tokenizers<0.21" sentencepiece accelerate
import torch; print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE')""")

code("""# 2) Cache = Supabase storage bucket LLM_MODELS (service key from Colab Secrets, never in the notebook)
import os, shutil, zipfile, time, requests
from google.colab import userdata
SB_URL = 'https://uqdwcxizabmxwflkbfrb.supabase.co'
SB_KEY = userdata.get('SUPABASE_SERVICE_KEY')
BUCKET = 'LLM_MODELS'; CACHE = 'training-cache'
H = {'Authorization': f'Bearer {SB_KEY}', 'apikey': SB_KEY}
def sb_list(prefix):
    r = requests.post(f'{SB_URL}/storage/v1/object/list/{BUCKET}', headers=H, json={'prefix': prefix, 'limit': 1000}, timeout=60)
    r.raise_for_status(); return [o['name'] for o in r.json()]
def sb_exists(path): return os.path.basename(path) in sb_list(os.path.dirname(path))
PART = 80 * 2**20   # Supabase stalls on big single uploads; everything goes up/down in 80 MB parts
def sb_get(path, local):
    \"\"\"Download bucket object (stored as .partNNN pieces) -> local file. False if absent.\"\"\"
    folder, name = os.path.dirname(path), os.path.basename(path)
    names = sorted(n for n in sb_list(folder) if n == name or n.startswith(name + '.part'))
    if not names: return False
    t = time.time(); os.makedirs(os.path.dirname(local) or '.', exist_ok=True)
    with open(local + '.tmp', 'wb') as out:
        for n in names:
            with requests.get(f'{SB_URL}/storage/v1/object/{BUCKET}/{folder}/{n}', headers=H, stream=True, timeout=600) as r:
                r.raise_for_status()
                for chunk in r.iter_content(1 << 20): out.write(chunk)
    os.replace(local + '.tmp', local); print(f'  <- {path} ({os.path.getsize(local)//2**20} MB, {len(names)} parts, {time.time()-t:.0f}s)'); return True
def sb_put(local, path):
    \"\"\"Upload local file -> bucket as 80 MB parts (overwrites).\"\"\"
    t = time.time(); i = 0
    with open(local, 'rb') as f:
        while True:
            chunk = f.read(PART)
            if not chunk: break
            for attempt in range(3):
                r = requests.post(f'{SB_URL}/storage/v1/object/{BUCKET}/{path}.part{i:03d}', headers={**H, 'x-upsert': 'true', 'Content-Type': 'application/octet-stream'}, data=chunk, timeout=600)
                if r.status_code < 300: break
                time.sleep(3)
            if r.status_code >= 300: raise RuntimeError(f'upload {path} part {i} failed: {r.status_code} {r.text[:200]}')
            i += 1
    print(f'  -> {path} ({os.path.getsize(local)//2**20} MB, {i} parts, {time.time()-t:.0f}s)')
try:
    print('bucket ok; pill-reader/:', sb_list('pill-reader'))
except Exception as e:
    raise SystemExit(f'Supabase key rejected: add SUPABASE_SERVICE_KEY (service_role) in Secrets and enable notebook access. {e}')
print('cached so far:', sb_list(CACHE))""")

code("""# 3) manifest.json (from ml/scripts/export_manifest.py). Uploaded once, then kept in the bucket.
import json, re
if not os.path.exists('manifest.json') and not sb_get(f'{CACHE}/manifest.json', 'manifest.json'):
    from google.colab import files
    up = files.upload(); assert 'manifest.json' in up
    sb_put('manifest.json', f'{CACHE}/manifest.json')
rows = json.load(open('manifest.json', encoding='utf-8-sig'))
def norm_imprint(s):
    return ' '.join(t for t in re.split(r'[;,\\s]+', s.upper()) if t)
for r in rows: r['text'] = norm_imprint(r['imprint'])      # '' = no imprint (kept on purpose)
rows = [r for r in rows if len(r['text']) <= 40]
print(f"{len(rows)} labeled images, {sum(1 for r in rows if not r['text'])} without imprint")""")

code("""# 4) Catalog images: local disk for speed, one zip in the bucket for persistence (downloaded ONCE).
import hashlib, requests
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
IMG_DIR = '/content/imgs'; IMG_ZIP = '/content/imgs.zip'
os.makedirs(IMG_DIR, exist_ok=True)
for r in rows: r['path'] = os.path.join(IMG_DIR, hashlib.md5(r['url'].encode()).hexdigest() + '.jpg')
if not os.listdir(IMG_DIR) and sb_get(f'{CACHE}/imgs.zip', IMG_ZIP):
    t = time.time(); zipfile.ZipFile(IMG_ZIP).extractall('/content'); print(f'restored images from the bucket in {time.time()-t:.0f}s')
def good_file(p):
    if not (os.path.exists(p) and os.path.getsize(p) > 1000): return False
    try: Image.open(p).verify(); return True
    except Exception: return False
def fetch(r):
    if good_file(r['path']): return 0
    for attempt in range(4):                       # storage rate-limits bursts: retry with backoff
        try:
            resp = requests.get(r['url'], timeout=30)
            if resp.status_code == 200 and resp.headers.get('content-type', '').startswith('image') and len(resp.content) > 1000:
                open(r['path'], 'wb').write(resp.content)
                if good_file(r['path']): return 1
            elif resp.status_code in (400, 404): return -1
        except Exception: pass
        time.sleep(1.5 * (attempt + 1))
    return -1
with ThreadPoolExecutor(8) as ex: res = list(ex.map(fetch, rows))
rows = [r for r in rows if good_file(r['path'])]
print(f'downloaded {res.count(1)}, cached {res.count(0)}, failed {res.count(-1)}; usable {len(rows)}')
if res.count(1) > 0 or not os.path.exists(IMG_ZIP):
    with zipfile.ZipFile(IMG_ZIP, 'w', zipfile.ZIP_STORED) as z:
        for r in rows: z.write(r['path'], os.path.relpath(r['path'], '/content'))
    sb_put(IMG_ZIP, f'{CACHE}/imgs.zip')""")

code("""# 5) Settings
SIZES = ['base', 'large']          # trained one after the other in this run
EPOCHS = {'base': 8, 'large': 5}
BATCH = {'base': 24, 'large': 12}
LR = 2e-5
# Start from the v1 fine-tunes (keeps catalog accuracy, converges faster).
INIT_ZIP = {'base': 'pill-reader-base-v1_2026-09-02_exact71.zip', 'large': 'pill-reader-large-v1_2026-09-02_exact73.zip'}
BASE_MODEL = {'base': 'microsoft/trocr-base-printed', 'large': 'microsoft/trocr-large-printed'}
P_PHONE, P_PLAIN, P_BLANK = 0.50, 0.47, 0.03   # per-sample: phone-style synth / v1-style aug / background-only ('' target)
SEED = 0""")

code("""# 6) v1 models: read from LLM_MODELS/pill-reader/ (uploaded there on 2026-09-02); browser upload only as a fallback.
INIT_DIR = {}
for size in SIZES:
    zlocal = f'/content/{INIT_ZIP[size]}'
    if not os.path.exists(zlocal) and not sb_get(f'pill-reader/{INIT_ZIP[size]}', zlocal):
        print(f'{INIT_ZIP[size]} is not in the bucket - upload it now:')
        from google.colab import files
        up = files.upload(); assert INIT_ZIP[size] in up, f'{INIT_ZIP[size]} not uploaded'
        sb_put(zlocal, f'pill-reader/{INIT_ZIP[size]}')
    dest = f'/content/init_{size}'
    if not os.path.exists(os.path.join(dest, 'config.json')):
        with zipfile.ZipFile(zlocal) as z:
            z.extractall(dest); names = z.namelist()
        top = sorted({n.split('/')[0] for n in names if '/' in n})
        if top and os.path.exists(os.path.join(dest, top[0], 'config.json')):
            for f in os.listdir(os.path.join(dest, top[0])): shutil.move(os.path.join(dest, top[0], f), dest)
    INIT_DIR[size] = dest
    print(size, '<-', INIT_ZIP[size], sorted(os.listdir(dest))[:4])""")

code("""# 7) Phone-style synthesis (pill cut-out -> textured background -> lighting -> camera damage -> reader-style crop)
import random, io, math
import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageEnhance, ImageDraw
from scipy import ndimage

def _otsu(v):
    hist, edges = np.histogram(v, bins=64); mids = (edges[:-1] + edges[1:]) / 2
    p = hist.astype(np.float64) / max(hist.sum(), 1); w0 = np.cumsum(p); w1 = 1 - w0
    mu = np.cumsum(p * mids); between = (mu[-1] * w0 - mu) ** 2 / np.maximum(w0 * w1, 1e-9)
    return float(mids[int(np.argmax(between[:-1]))])

def segment_pill(img):
    \"\"\"Catalog photo -> RGBA cut-out of the pill(s) (both sides if the photo shows both), or None.\"\"\"
    a = np.asarray(img, dtype=np.float32); h, w = a.shape[:2]
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]); bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))
    mask = dist > max(_otsu(dist.ravel()), 18.0)
    mask = ndimage.binary_opening(mask, iterations=2)
    lab, n = ndimage.label(mask)
    if n == 0: return None
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.2 * sizes.max() and s >= 0.01 * h * w]
    mask = np.isin(lab, keep)
    mask = ndimage.binary_fill_holes(ndimage.binary_closing(mask, iterations=3))
    frac = mask.mean()
    if frac < 0.03 or frac > 0.9: return None
    ys, xs = np.nonzero(mask); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    alpha = ndimage.gaussian_filter(mask.astype(np.float32), 1.0)
    rgba = np.dstack([a, alpha[..., None] * 255]).astype(np.uint8)[y0:y1, x0:x1]
    return Image.fromarray(rgba, 'RGBA')

CUT_DIR = '/content/cutouts'; CUT_ZIP = '/content/cutouts.zip'
os.makedirs(CUT_DIR, exist_ok=True)
def cutout_path(r): return os.path.join(CUT_DIR, os.path.basename(r['path']).replace('.jpg', '.png'))
def build_cutout(r):
    \"\"\"Segment once, cache as PNG (empty file = segmentation failed -> v1 augmentation is used).\"\"\"
    out = cutout_path(r)
    if os.path.exists(out): return
    try: seg = segment_pill(Image.open(r['path']).convert('RGB'))
    except Exception: seg = None
    if seg is None: open(out, 'wb').close()
    else: seg.save(out)
def load_cutout(r):
    out = cutout_path(r)
    if not os.path.exists(out): build_cutout(r)
    if os.path.getsize(out) == 0: return None
    return Image.open(out).convert('RGBA')

def make_texture(w, h):
    # Textures are built at half size and upscaled: 4x cheaper, visually the same after camera blur.
    return _make_texture(max(8, w // 2), max(8, h // 2)).resize((w, h), Image.BILINEAR)

def _make_texture(w, h):
    kind = random.choice(['wood', 'wood', 'fabric', 'skin', 'paper', 'table', 'plain'])
    rng = np.random.default_rng(random.randrange(1 << 30))
    if kind == 'wood':
        base = np.array(random.choice([(120, 80, 45), (150, 105, 60), (90, 60, 35), (175, 130, 85), (60, 40, 30)]), np.float32)
        grain = ndimage.gaussian_filter(rng.normal(0, 1, (h, w)), (0.6, 12)) * 55
        streaks = ndimage.gaussian_filter(rng.normal(0, 1, (h, w)), (2, 40)) * 35
        img = base + (grain + streaks)[..., None] * np.array([1.0, 0.9, 0.7])
    elif kind == 'fabric':
        base = np.array([random.randint(40, 200) for _ in range(3)], np.float32)
        img = base + ndimage.gaussian_filter(rng.normal(0, 1, (h, w)), 0.7)[..., None] * 28
    elif kind == 'skin':
        base = np.array(random.choice([(225, 185, 160), (200, 150, 120), (160, 110, 80), (110, 75, 55), (240, 205, 185)]), np.float32)
        yy, xx = np.mgrid[0:h, 0:w]
        shade = np.sin(xx / w * math.pi * random.uniform(0.5, 2) + random.random() * 6) * 18
        lines = ndimage.gaussian_filter(rng.normal(0, 1, (h, w)), (1.5, 6)) * 10
        img = base + (shade + lines)[..., None]
    elif kind == 'paper':
        img = np.full((h, w, 3), random.randint(215, 250), np.float32) + rng.normal(0, 4, (h, w, 1))
    elif kind == 'table':
        img = np.full((h, w, 3), random.randint(15, 70), np.float32) + ndimage.gaussian_filter(rng.normal(0, 1, (h, w)), 3)[..., None] * 12
        specks = rng.random((h, w)) < 0.002
        img[specks] = 160
    else:
        img = np.full((h, w, 3), [random.randint(30, 230) for _ in range(3)], np.float32)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')

def side_light(img, strength):
    \"\"\"Directional lighting: a brightness ramp across the frame (no synthetic edge shadows:
    v2 learned the darkened pill outline as a stroke and read 1s that were not there).\"\"\"
    a = np.asarray(img, dtype=np.float32); h, w = a.shape[:2]
    ang = random.uniform(0, 2 * math.pi); yy, xx = np.mgrid[0:h, 0:w]
    ramp = (np.cos(ang) * (xx / w - 0.5) + np.sin(ang) * (yy / h - 0.5)) * strength * 255
    return Image.fromarray(np.clip(a + ramp[..., None], 0, 255).astype(np.uint8), 'RGB')

def deboss_shade(pill):
    \"\"\"Lit-from-the-side look for the imprint only: shift the pill's INNER edges (imprint strokes),
    masked well inside the pill so its outline is untouched.\"\"\"
    a = np.asarray(pill, dtype=np.float32); rgb, alpha = a[..., :3], a[..., 3] / 255.0
    inner = ndimage.binary_erosion(alpha > 0.5, iterations=max(2, int(min(pill.size) * 0.06)))
    lum = rgb.mean(-1)
    edges = np.abs(ndimage.laplace(ndimage.gaussian_filter(lum, 0.8))) * inner
    ang = random.uniform(0, 2 * math.pi); d = random.randint(1, 2)
    dx, dy = int(round(math.cos(ang) * d)), int(round(math.sin(ang) * d))
    shadow = np.roll(np.roll(edges, dy, 0), dx, 1) * random.uniform(0.4, 1.2)
    high = np.roll(np.roll(edges, -dy, 0), -dx, 1) * random.uniform(0.2, 0.6)
    rgb = np.clip(rgb - shadow[..., None] + high[..., None], 0, 255)
    return Image.fromarray(np.dstack([rgb, a[..., 3:]]).astype(np.uint8), 'RGBA')

def glare(img):
    w, h = img.size; layer = Image.new('L', (w, h), 0); d = ImageDraw.Draw(layer)
    r = int(min(w, h) * random.uniform(0.12, 0.4)); cx, cy = random.randint(0, w), random.randint(0, h)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=random.randint(120, 230))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.6))
    return Image.composite(Image.new('RGB', (w, h), (255, 255, 250)), img, layer)

def perspective(img, amount):
    w, h = img.size; j = lambda: random.uniform(-amount, amount)
    quad = [(j() * w, j() * h), (w + j() * w, j() * h), (w + j() * w, h + j() * h), (j() * w, h + j() * h)]
    return img.transform((w, h), Image.QUAD, sum(quad, ()), Image.BILINEAR, fillcolor=tuple(np.asarray(img).reshape(-1, 3)[0]))

def camera_damage(img):
    if random.random() < 0.6: img = perspective(img, random.uniform(0.02, 0.10))
    if random.random() < 0.6: img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.6)))
    if random.random() < 0.5:
        a = np.asarray(img, dtype=np.float32) + np.random.normal(0, random.uniform(2, 9), np.asarray(img).shape)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if random.random() < 0.6: img = ImageEnhance.Brightness(img).enhance(random.uniform(0.55, 1.35))
    if random.random() < 0.5: img = ImageEnhance.Contrast(img).enhance(random.uniform(0.6, 1.3))
    if random.random() < 0.3: img = ImageEnhance.Color(img).enhance(random.uniform(0.4, 1.2))
    if random.random() < 0.6:
        buf = io.BytesIO(); img.save(buf, 'JPEG', quality=random.randint(30, 85)); img = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    return img

def reader_crop(frame, box):
    \"\"\"Square crop like the production reader: pad from slightly inside the pill to loose.\"\"\"
    l, t, r, b = box; cx, cy = (l + r) / 2, (t + b) / 2
    s = max(max(r - l, b - t) * (1 + 2 * random.uniform(-0.12, 0.35)), 32)
    return frame.crop((int(max(0, cx - s / 2)), int(max(0, cy - s / 2)), int(min(frame.width, cx + s / 2)), int(min(frame.height, cy + s / 2))))

def phone_synth(img, r=None):
    \"\"\"Catalog photo -> phone-style photo of the same pill (label unchanged). None if the pill can't be cut out.\"\"\"
    pill = load_cutout(r) if r is not None else segment_pill(img)
    if pill is None: return None
    if random.random() < 0.5: pill = deboss_shade(pill)
    pill = pill.rotate(random.uniform(0, 360), expand=True, resample=Image.BICUBIC)
    F = 512
    scale = random.uniform(0.35, 0.95) * F / max(pill.size)
    pill = pill.resize((max(8, int(pill.width * scale)), max(8, int(pill.height * scale))), Image.BILINEAR)
    frame = make_texture(F, F)
    x = int((F - pill.width) / 2 + random.uniform(-0.1, 0.1) * F); y = int((F - pill.height) / 2 + random.uniform(-0.1, 0.1) * F)
    if random.random() < 0.6:  # soft contact shadow
        sh = Image.new('L', (F, F), 0); ImageDraw.Draw(sh).ellipse((x + 4, y + 6, x + pill.width + 6, y + pill.height + 10), fill=random.randint(60, 140))
        frame = Image.composite(Image.new('RGB', (F, F), (0, 0, 0)), frame, sh.filter(ImageFilter.GaussianBlur(6)))
    frame.paste(pill, (x, y), pill)
    if random.random() < 0.7: frame = side_light(frame, random.uniform(0.1, 0.4))
    if random.random() < 0.3: frame = glare(frame)
    frame = camera_damage(frame)
    if random.random() < 0.8: frame = reader_crop(frame, (x, y, x + pill.width, y + pill.height))
    return frame

def blank_sample():
    \"\"\"Background only (no pill): the reader must output nothing.\"\"\"
    F = 512; frame = camera_damage(make_texture(F, F))
    s = random.randint(120, 400); x, y = random.randint(0, F - s), random.randint(0, F - s)
    return frame.crop((x, y, x + s, y + s))

def phone_aug_v1(img):
    if random.random() < 0.5:
        w = random.randint(320, 700); img = img.resize((w, int(w * img.height / img.width)), Image.BILINEAR)
    if random.random() < 0.4: img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.5)))
    if random.random() < 0.5:
        buf = io.BytesIO(); img.save(buf, 'JPEG', quality=random.randint(35, 85)); img = Image.open(io.BytesIO(buf.getvalue())).convert('RGB')
    if random.random() < 0.5: img = img.rotate(random.uniform(-25, 25), fillcolor=(128, 128, 128), expand=False)
    if random.random() < 0.5: img = ImageOps.autocontrast(img, cutoff=random.randint(0, 5))
    if random.random() < 0.3: img = ImageEnhance.Brightness(img).enhance(random.uniform(0.6, 1.4))
    return img

def train_sample(r):
    \"\"\"-> (image, text) for one manifest row.\"\"\"
    u = random.random()
    if u < P_BLANK: return blank_sample(), ''
    img = Image.open(r['path']).convert('RGB')
    if u < P_BLANK + P_PHONE:
        out = phone_synth(img, r)
        if out is not None: return out, r['text']
    return phone_aug_v1(img), r['text']

# Cut every pill out once (cached in the bucket as one zip).
if not os.listdir(CUT_DIR) and sb_get(f'{CACHE}/cutouts.zip', CUT_ZIP):
    zipfile.ZipFile(CUT_ZIP).extractall('/content'); print('restored cut-outs from the bucket')
todo = [r for r in rows if not os.path.exists(cutout_path(r))]
if todo:
    print(f'building {len(todo)} cut-outs...'); t = time.time()
    with ThreadPoolExecutor(8) as ex: list(ex.map(build_cutout, todo))
    with zipfile.ZipFile(CUT_ZIP, 'w', zipfile.ZIP_STORED) as z:
        for r in rows: z.write(cutout_path(r), os.path.relpath(cutout_path(r), '/content'))
    print(f'done in {time.time()-t:.0f}s'); sb_put(CUT_ZIP, f'{CACHE}/cutouts.zip')
print('synthesis ready; segmentation failed on', sum(1 for r in rows if os.path.getsize(cutout_path(r)) == 0), 'images (they get v1 augmentation)')""")

code("""# 8) Look at what the model will see (re-run for more)
random.seed(); import matplotlib.pyplot as plt
fig, axes = plt.subplots(3, 6, figsize=(18, 9))
for ax in axes.ravel():
    r = random.choice(rows); im, t = train_sample(r)
    ax.imshow(im); ax.set_title(t or '(blank)', fontsize=9); ax.axis('off')
plt.tight_layout(); plt.show()""")

code("""# 9) Train both sizes, one after the other. Each epoch is checkpointed to the bucket and resumed automatically.
from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from torch.utils.data import Dataset, DataLoader

random.seed(SEED); random.shuffle(rows)
slugs = sorted({r['slug'] for r in rows}); random.shuffle(slugs)
held = set(slugs[: max(200, len(slugs) // 20)])       # whole pills held out
train_rows = [r for r in rows if r['slug'] not in held]
val_rows = [r for r in rows if r['slug'] in held]
print(f'train {len(train_rows)}  val {len(val_rows)} (held-out pills: {len(held)})')
eval_sample = [r for r in val_rows if r['text']][:600]
random.seed(123); eval_phone = []
for r in eval_sample:
    im = phone_synth(Image.open(r['path']).convert('RGB'), r)
    if im is not None: eval_phone.append((im, r['text']))
eval_catalog = [(Image.open(r['path']).convert('RGB'), r['text']) for r in eval_sample]
random.seed(7); eval_blanks = [blank_sample() for _ in range(100)]

def read(model, processor, imgs):
    pv = processor(images=imgs, return_tensors='pt').pixel_values.cuda()
    with torch.no_grad(): ids = model.generate(pv, max_length=24, num_beams=2, use_cache=True)
    return [t.strip().upper() for t in processor.batch_decode(ids, skip_special_tokens=True)]
def score(model, processor, pairs, label):
    exact = hits = total = 0
    for i in range(0, len(pairs), 32):
        chunk = pairs[i:i+32]; preds = read(model, processor, [im for im, _ in chunk])
        for (im, t), p in zip(chunk, preds):
            exact += (p == t); gt, pr = set(t.split()), set(p.split()); hits += len(gt & pr); total += len(gt)
    line = f'{label:<36} exact {100*exact/len(pairs):.1f}%   token recall {100*hits/max(total,1):.1f}%   (n={len(pairs)})'
    print(line); return line

class DS(Dataset):
    def __init__(self, rs, processor): self.rs, self.processor = rs, processor
    def __len__(self): return len(self.rs)
    def __getitem__(self, i):
        random.seed(); np.random.seed()
        img, text = train_sample(self.rs[i])
        pv = self.processor(images=img, return_tensors='pt').pixel_values[0]
        labels = self.processor.tokenizer(text, padding='max_length', max_length=24, truncation=True).input_ids
        labels = [l if l != self.processor.tokenizer.pad_token_id else -100 for l in labels]
        return pv, torch.tensor(labels)

REPORT = {}
for SIZE in SIZES:
    CKPT = f'/content/ckpt_{SIZE}'; OUT = f'/content/pill_trocr_{SIZE}_v2'; FINAL_ZIP = f'/content/pill_trocr_{SIZE}_v2.zip'
    processor = TrOCRProcessor.from_pretrained(BASE_MODEL[SIZE])     # tokenizer identical to Microsoft's
    if sb_get(f'{CACHE}/pill_trocr_{SIZE}_v2.zip', FINAL_ZIP):
        print(f'{SIZE}: already finished earlier (zip in bucket) - skipping'); zipfile.ZipFile(FINAL_ZIP).extractall('/content'); continue
    if not os.path.exists(os.path.join(CKPT, 'epochs_done')) and sb_get(f'{CACHE}/ckpt_{SIZE}.zip', CKPT + '.zip'):
        zipfile.ZipFile(CKPT + '.zip').extractall('/content'); print(f'{SIZE}: resumed checkpoint from the bucket')
    done = int(open(os.path.join(CKPT, 'epochs_done')).read()) if os.path.exists(os.path.join(CKPT, 'epochs_done')) else 0
    src = CKPT if done else INIT_DIR[SIZE]
    model = VisionEncoderDecoderModel.from_pretrained(src).cuda()
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.eos_token_id = processor.tokenizer.sep_token_id
    model.config.use_cache = True; model.generation_config.max_length = 24; model.generation_config.num_beams = 2
    print(f'\\n===== {SIZE}: starting from {src} (epochs done: {done}/{EPOCHS[SIZE]}) =====')
    if done == 0:
        model.eval()
        REPORT[f'{SIZE} BEFORE catalog'] = score(model, processor, eval_catalog, f'{SIZE} BEFORE training: catalog')
        REPORT[f'{SIZE} BEFORE phone'] = score(model, processor, eval_phone, f'{SIZE} BEFORE training: phone-style')
    if done < EPOCHS[SIZE]:
        dl = DataLoader(DS(train_rows, processor), batch_size=BATCH[SIZE], shuffle=True, num_workers=8, drop_last=True, persistent_workers=True)
        remaining = EPOCHS[SIZE] - done
        opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=LR, total_steps=remaining * len(dl), pct_start=0.1 if done == 0 else 0.02)
        for ep in range(done, EPOCHS[SIZE]):
            model.train(); tot = 0.0; t0 = time.time()
            for step, (pv, labels) in enumerate(dl):
                with torch.amp.autocast('cuda', dtype=torch.bfloat16):
                    loss = model(pixel_values=pv.cuda(), labels=labels.cuda()).loss
                opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step()
                tot += loss.item()
                if (step + 1) % 100 == 0: print(f'{SIZE} epoch {ep+1} step {step+1}/{len(dl)} loss {tot/(step+1):.3f}')
            print(f'=== {SIZE} epoch {ep+1}/{EPOCHS[SIZE]} avg loss {tot/len(dl):.3f} ({(time.time()-t0)/60:.0f} min) ===')
            model.save_pretrained(CKPT); open(os.path.join(CKPT, 'epochs_done'), 'w').write(str(ep + 1))   # resume point
            shutil.make_archive(CKPT, 'zip', '/content', f'ckpt_{SIZE}'); sb_put(CKPT + '.zip', f'{CACHE}/ckpt_{SIZE}.zip')
        del dl
    model.eval()
    REPORT[f'{SIZE} AFTER catalog'] = score(model, processor, eval_catalog, f'{SIZE} AFTER training: catalog')
    REPORT[f'{SIZE} AFTER phone'] = score(model, processor, eval_phone, f'{SIZE} AFTER training: phone-style')
    blanks = read(model, processor, eval_blanks)
    REPORT[f'{SIZE} blanks'] = f'{SIZE}: stays silent on {100*sum(1 for b in blanks if not b)/len(blanks):.0f}% of blank backgrounds'; print(REPORT[f'{SIZE} blanks'])
    model.save_pretrained(OUT); processor.save_pretrained(OUT)
    open(f'{OUT}/REPORT.txt', 'w').write('\\n'.join(v for k, v in REPORT.items() if k.startswith(SIZE)))
    shutil.make_archive(OUT, 'zip', '/content', f'pill_trocr_{SIZE}_v2'); sb_put(FINAL_ZIP, f'{CACHE}/pill_trocr_{SIZE}_v2.zip')
    print(f'{SIZE} finished -> bucket {CACHE}/pill_trocr_{SIZE}_v2.zip')
    del model; torch.cuda.empty_cache()
print('\\n'.join(REPORT.values()))""")

code("""# 10) Optional: your own phone photos (upload any number). Same pill finder + crops as the production reader.
from google.colab import files
""" + LOCATOR + """
TEST_SIZE = 'base'
processor = TrOCRProcessor.from_pretrained(BASE_MODEL[TEST_SIZE]); model = VisionEncoderDecoderModel.from_pretrained(f'/content/pill_trocr_{TEST_SIZE}_v2').cuda().eval()
ups = files.upload()
for name in ups:
    img = Image.open(name).convert('RGB'); img.thumbnail((1600, 1600)); box = _pill_box(img)
    views = [_crop_pad(img, box, p) for p in (-0.10, -0.05, 0.03)] if box else [img, img.rotate(180)]
    print(f'{name}: box={box} reads={read(model, processor, views)}')""")

code("""# 11) Results. The finished models are already in the bucket (LLM_MODELS/training-cache/); nothing to download.
print('\\n'.join(REPORT.values()))
print('models in bucket:', [f'{CACHE}/pill_trocr_{SIZE}_v2.zip' for SIZE in SIZES])""")

nb = {
    "cells": [
        {"cell_type": t, "metadata": {}, "source": s.splitlines(keepends=True), **({"outputs": [], "execution_count": None} if t == "code" else {})}
        for t, s in CELLS
    ],
    "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "A100"}, "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
    "nbformat": 4,
    "nbformat_minor": 0,
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pillseek_ocr_v2_colab.ipynb")
json.dump(nb, open(out, "w", encoding="utf-8"), indent=1)
print("wrote", out, f"({len(CELLS)} cells)")
