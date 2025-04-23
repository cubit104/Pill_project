"""
Supabase-backed FastAPI Application

Replaces CSV data load with direct Supabase table queries (
using table: "pillfinder") and uses Supabase Storage for images.

.env configuration:
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_KEY=<your-anon-or-service-role-key>
SUPABASE_TABLE=pillfinder
STORAGE_BUCKET=images
"""

import os
import re
import logging
import psycopg2
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Query, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from supabase import create_client, Client
from dotenv import load_dotenv

# ----------------------------------------------------------------------------
# Connection Details
# ----------------------------------------------------------------------------
# Public Supabase Storage base URL for images
IMAGE_BASE = "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images"

# Direct Postgres connection (optional, for raw SQL needs)
DATABASE_URL = (
    "postgresql://postgres.uqdwcxizabmxwflkbfrb:Potato6200$"
    "supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
)

def get_db_connection():
    """Get a raw psycopg2 connection to the Postgres database."""
    return psycopg2.connect(DATABASE_URL)

# ----------------------------------------------------------------------------
# Environment & Supabase Client Initialization
# ----------------------------------------------------------------------------
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_TABLE = os.getenv("SUPABASE_TABLE", "pillfinder")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "images")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials (SUPABASE_URL & SUPABASE_KEY) must be set in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ----------------------------------------------------------------------------
# Logging Configuration
# ----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------------
# FastAPI App and CORS
# ----------------------------------------------------------------------------
app = FastAPI(
    title="Pill Identifier API (Supabase)",
    description="Identify pills via Supabase-managed metadata and images",
    version="1.0.0"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------------
# Static Files Mounting (for frontend HTML, CSS, JS)
# ----------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
static_dir = BASE_DIR / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# ----------------------------------------------------------------------------
# Middleware: Normalize Internal Redirects
# ----------------------------------------------------------------------------
@app.middleware("http")
async def fix_port_redirects(request: Request, call_next):
    response = await call_next(request)
    if response.status_code in (301, 302, 307, 308) and 'location' in response.headers:
        loc = response.headers['location']
        if ':8001' in loc:
            response.headers['location'] = loc.replace(':8001', ':8000')
    return response

# ----------------------------------------------------------------------------
# In-Memory Cache for Pill Records
# ----------------------------------------------------------------------------
pills: List[Dict[str, Any]] = []

# ----------------------------------------------------------------------------
# Helper Functions
# ----------------------------------------------------------------------------
def normalize_text(text: str) -> str:
    """Capitalize first letter, lowercase the rest."""
    if not text or not isinstance(text, str):
        return ""
    text = text.strip()
    return text[0].upper() + text[1:].lower() if text else ""


def normalize_imprint(value: str) -> str:
    """Uppercase alphanumeric imprint, remove special chars."""
    if not value or not isinstance(value, str):
        return ""
    return re.sub(r'[^A-Za-z0-9]+', ' ', value).strip().upper()


def normalize_name(value: str) -> str:
    """Lowercase and strip drug names."""
    if not value or not isinstance(value, str):
        return ""
    return value.strip().lower()


def split_image_filenames(filenames: str) -> List[str]:
    """Split on commas/semicolons and strip whitespace."""
    if not filenames or not isinstance(filenames, str):
        return []
    parts = re.split(r"[,;]+", filenames)
    return [p.strip() for p in parts if p.strip()]


def get_image_urls(filenames: str) -> List[str]:
    """Construct public image URLs from stored filenames."""
    names = split_image_filenames(filenames)
    urls = [f"{IMAGE_BASE}/{name}" for name in names]
    return urls or ["https://via.placeholder.com/400x300?text=No+Image+Available"]


def load_data() -> bool:
    """Fetch all pill records from Supabase into memory."""
    global pills
    try:
        resp = supabase.table(SUPABASE_TABLE).select("*").execute()
        if resp.error:
            logger.error(f"Supabase error: {resp.error.message}")
            pills = []
            return False
        pills = resp.data or []
        logger.info(f"Loaded {len(pills)} records from '{SUPABASE_TABLE}'")
        return True
    except Exception as e:
        logger.exception(f"Data load failed: {e}")
        pills = []
        return False

# Initial data load
load_data()

# ----------------------------------------------------------------------------
# Health & Reload Endpoints
# ----------------------------------------------------------------------------
@app.get("/health")
def health_check():
    return {"status": "healthy", "version": app.version, "count": len(pills)}

@app.get("/reload-data")
async def reload_data_endpoint(background_tasks: BackgroundTasks):
    success = load_data()
    return {"message": "reload " + ("succeeded" if success else "failed"), "count": len(pills)}

# ----------------------------------------------------------------------------
# Frontend HTML Routes
# ----------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_index():
    path = BASE_DIR / "index.html"
    if path.exists():
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="index.html not found")

@app.get("/index.html")
async def redirect_index():
    return RedirectResponse(url="/")

@app.get("/details.html", response_class=HTMLResponse)
async def serve_details():
    path = BASE_DIR / "details.html"
    if path.exists():
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="details.html not found")

# ----------------------------------------------------------------------------
# Core API Endpoints
# ----------------------------------------------------------------------------
@app.get("/details")
def get_pill_details(
    imprint: Optional[str] = Query(None),
    drug_name: Optional[str] = Query(None),
    rxcui: Optional[str] = Query(None),
    ndc: Optional[str] = Query(None)
) -> Dict[str, Any]:
    if not pills and not load_data():
        raise HTTPException(status_code=500, detail="No data available")
    data = pills.copy()
    used_ndc = False

    if ndc:
        used_ndc = True
        c = re.sub(r"[^0-9]", "", ndc)
        data = [p for p in data
                if re.sub(r"[^0-9]", "", str(p.get("ndc11", ""))) == c
                or re.sub(r"[^0-9]", "", str(p.get("ndc9", ""))) == c]
    elif rxcui:
        data = [p for p in data if str(p.get("rxcui", "")) == str(rxcui)]
    elif imprint and drug_name:
        imp_norm = normalize_imprint(imprint)
        name_norm = normalize_name(drug_name)
        data = [p for p in data
                if normalize_imprint(p.get("splimprint", "")) == imp_norm
                and normalize_name(p.get("medicine_name", "")) == name_norm]
    elif imprint:
        imp_norm = normalize_imprint(imprint)
        data = [p for p in data if normalize_imprint(p.get("splimprint", "")) == imp_norm]
    elif drug_name:
        name_norm = normalize_name(drug_name)
        data = [p for p in data if normalize_name(p.get("medicine_name", "")) == name_norm]
    else:
        raise HTTPException(status_code=400, detail="Provide imprint, drug_name, rxcui, or ndc")

    if not data:
        raise HTTPException(status_code=404, detail="No matching pill found")

    record = data[0].copy()
    filenames = record.get("image_filename", "") if used_ndc else ",".join([p.get("image_filename", "") for p in data])
    record["image_urls"] = get_image_urls(filenames)
    return record

@app.get("/search")
def search(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query("imprint"),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100)
) -> Dict[str, Any]:
    if not pills and not load_data():
        raise HTTPException(status_code=500, detail="No data available")
    filtered = pills.copy()
    if q:
        query = q.strip()
        if type == "imprint":
            norm = normalize_imprint(query)
            filtered = [p for p in filtered if normalize_imprint(p.get("splimprint", "")) == norm]
        elif type == "drug":
            norm = normalize_name(query)
            filtered = [p for p in filtered if normalize_name(p.get("medicine_name", "")) == norm]
        elif type == "ndc":
            c = re.sub(r"[^0-9]", "", query)
            filtered = [p for p in filtered
                        if c in re.sub(r"[^0-9]", "", str(p.get("ndc11", "")))
                        or c in re.sub(r"[^0-9]", "", str(p.get("ndc9", "")))]
    if color:
        filtered = [p for p in filtered if p.get("splcolor_text", "").strip().lower() == color.strip().lower()]
    if shape:
        filtered = [p for p in filtered if p.get("splshape_text", "").strip().lower() == shape.strip().lower()]

    # Deduplicate & attach images
    seen = set()
    results = []
    for p in filtered:
        key = (
            normalize_name(p.get("medicine_name", "")),
            normalize_imprint(p.get("splimprint", "")),
            p.get("splcolor_text", ""),
            p.get("splshape_text", ""),
            str(p.get("rxcui", ""))
        )
        if key not in seen:
            seen.add(key)
            item = p.copy()
            item["image_urls"] = get_image_urls(item.get("image_filename", ""))
            results.append(item)
    total = len(results)
    start = (page - 1) * per_page
    end = start + per_page
    return {"results": results[start:end], "total": total, "page": page, "per_page": per_page, "total_pages": (total + per_page - 1) // per_page}

@app.get("/filters")
def get_filters() -> Dict[str, Any]:
    if not pills and not load_data():
        raise HTTPException(status_code=500, detail="No data available")
    standard_colors = {
        "White": "#FFFFFF", "Blue": "#0000FF", "Green": "#008000",
        "Red": "#FF0000", "Yellow": "#FFFF00", "Pink": "#FFC0CB",
        "Orange": "#FFA500", "Purple": "#800080", "Gray": "#808080",
        "Brown": "#A52A2A", "Beige": "#F5F5DC"
    }
    colors = [{"name": n, "hex": h} for n, h in standard_colors.items()]
    shapes = []
    seen_shapes = set()
    for p in pills:
        s = p.get("splshape_text", "").strip()
        if s and s.lower() not in seen_shapes:
            seen_shapes.add(s.lower())
            shapes.append({"name": s.title(), "icon": "🔹"})
    shapes.sort(key=lambda x: x["name"])
    return {"colors": colors, "shapes": shapes}

@app.get("/suggestions")
def get_suggestions(q: str = Query(...), type: str = Query(...)) -> List[str]:
    if not pills and not load_data():
        return []
    query = q.strip()
    if not query:
        return []
    suggestions = []
    seen = set()
    if type == "imprint":
        for p in pills:
            imp = p.get("splimprint", "").strip()
            norm = normalize_imprint(imp)
            if norm and norm not in seen and (norm == normalize_imprint(query) or normalize_imprint(query) in norm):
                seen.add(norm)
                suggestions.append(imp)
                if len(suggestions) >= 10:
                    break
    elif type == "drug":
        for p in pills:
            nm = p.get("medicine_name", "").strip()
            norm = normalize_name(nm)
            if norm and norm not in seen and (norm == normalize_name(query) or normalize_name(query) in norm):
                seen.add(norm)
                suggestions.append(nm)
                if len(suggestions) >= 10:
                    break
    elif type == "ndc":
        c = re.sub(r"[^0-9]", "", query)
        for p in pills:
            for field in ["ndc9", "ndc11"]:
                val = re.sub(r"[^0-9]", "", str(p.get(field, "")))
                if val.startswith(c) and val not in seen:
                    seen.add(val)
                    suggestions.append(val)
                    if len(suggestions) >= 10:
                        break
            if len(suggestions) >= 10:
                break
    return suggestions

@app.get("/ndc_lookup")
def ndc_lookup(ndc: str = Query(...)) -> Dict[str, Any]:
    if not ndc or (not pills and not load_data()):
        return {"found": False}
    c = re.sub(r"[^0-9]", "", ndc)
    match = next((p for p in pills if c in re.sub(r"[^0-9]", "", str(p.get("ndc11", ""))) or c in re.sub(r"[^0-9]", "", str(p.get("ndc9", "")))), None)
    if not match:
        return {"found": False}
    result = match.copy()
    result["image_urls"] = get_image_urls(result.get("image_filename", ""))
    result["found"] = True
    return result

@app.get("/ndc_diagnostic")
def ndc_diagnostic(ndc: str = Query(...)) -> Dict[str, Any]:
    if not ndc or (not pills and not load_data()):
        return {"error": "no data or ndc"}
    images = get_image_urls(ndc)
    c = re.sub(r"[^0-9]", "", ndc)
    record = next((p for p in pills if c in re.sub(r"[^0-9]", "", str(p.get("ndc11", ""))) or c in re.sub(r"[^0-9]", "", str(p.get("ndc9", "")))), None)
    return {"ndc": ndc, "images_found": bool(images), "image_urls": images, "record": record}

# Redirect compatibility
@app.get("/index.html")
async def redirect_index2():
    return RedirectResponse(url="/")

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI with Supabase integration on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
