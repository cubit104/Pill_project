"""Export a training manifest for the imprint reader (read-only DB query).

Writes manifest.json: one row per catalog image with its imprint text,
color and shape. Run from the Pill_project repo venv so DATABASE_URL and
the utils module are available:

    ..\\Pill_project\\venv\\Scripts\\python.exe export_manifest.py
"""

import json
import os
import sys

# repo root = three levels up from this file (ml/scripts/export_manifest.py)
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)
os.chdir(REPO)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(REPO, ".env"))

from sqlalchemy import text  # noqa: E402

import database  # noqa: E402
from utils import get_image_urls  # noqa: E402

database.connect_to_database()
with database.db_engine.connect() as conn:
    rows = conn.execute(
        text(
            "SELECT slug, splimprint, splcolor_text, splshape_text, image_filename, medicine_name "
            "FROM pillfinder WHERE deleted_at IS NULL AND published = true "
            "AND image_filename IS NOT NULL AND image_filename <> ''"
        )
    ).fetchall()

manifest = []
for slug, imprint, color, shape, image_filename, name in rows:
    for url in get_image_urls(image_filename):  # every catalog photo of the pill
        if "placeholder" in url:
            continue
        manifest.append(
            {
                "url": url,
                "slug": slug,
                "imprint": (imprint or "").strip(),  # "" = no imprint: teaches the reader to stay silent
                "color": (color or "").strip(),
                "shape": (shape or "").strip(),
                "name": (name or "").strip(),
            }
        )

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f)
print(f"{len(rows)} pills, {len(manifest)} labeled images -> manifest.json")
