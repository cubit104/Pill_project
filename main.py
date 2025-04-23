"""
Supabase-backed FastAPI Application

Replaces CSV data load with direct Supabase table queries (table: "pillfinder")
and uses Supabase Storage for images.

Ensure the following in your `.env`:

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

# -----------------------------------------------------------------------------
# Connection Details
# -----------------------------------------------------------------------------
# Supabase Storage Base URL (public)
IMAGE_BASE = "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images"

# Database connection (for any direct SQL needs)
DATABASE_URL = "postgresql://postgres.uqdwcxizabmxwflkbfrb:Potato6200$supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

# -----------------------------------------------------------------------------
# Load environment variables
# -----------------------------------------------------------------------------
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_TABLE = os.getenv("SUPABASE_TABLE", "pillfinder")
STORAGE_BUCKET = os.getenv("STORAGE_BUCKET", "images")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials (SUPABASE_URL & SUPABASE_KEY) must be set in .env")

# -----------------------------------------------------------------------------
# Initialize Supabase client
# -----------------------------------------------------------------------------
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -----------------------------------------------------------------------------
# Logging configuration
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# FastAPI app & CORS
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# Static file mounting (frontend)
# -----------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
static_dir = BASE_DIR / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# -----------------------------------------------------------------------------
# Middleware: normalize internal redirects
# -----------------------------------------------------------------------------
@app.middleware("http")
async def fix_port_redirects(request: Request, call_next):
    response = await call_next(request)
    if response.status_code in (301,302,307,308) and 'location' in response.headers:
        loc = response.headers['location']
        if ':8001' in loc:
            response.headers['location'] = loc.replace(':8001', ':8000')
    return response

# -----------------------------------------------------------------------------
# In-memory cache for pill records
# -----------------------------------------------------------------------------
pills: List[Dict[str, Any]] = []

# -----------------------------------------------------------------------------
# Helper functions: normalization, image URL assembly, data load
# -----------------------------------------------------------------------------
def normalize_text(text: str) -> str:
    if not text or not isinstance(text, str):
        return ""
    text = text.strip()
    return text[0].upper() + text[1:].lower() if text else ""


def normalize_imprint(value: str) -> str:
    if not value or not isinstance(value, str):
        return ""
    return re.sub(r'[^A-Za-z0-9]+', ' ', value).strip().upper()


def normalize_name(value: str) -> str:
    if not value or not isinstance(value, str):
        return ""
    return value.strip().lower()


def split_image_filenames(filenames: str) -> List[str]:
    if not filenames or not isinstance(filenames, str):
        return []
    parts = re.split(r"[,;]+", filenames)
    return [p.strip() for p in parts if p.strip()]


def get_image_urls(filenames: str) -> List[str]:
    names = split_image_filenames(filenames)
    urls = []
    for name in names:
        urls.append(f"{IMAGE_BASE}/{name}")
    return urls or ["https://via.placeholder.com/400x300?text=No+Image+Available"]


def load_data() -> bool:
    """
    Load all pill records from Supabase table into `pills` cache.
    """
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

# -----------------------------------------------------------------------------
# Health & reload endpoints
# -----------------------------------------------------------------------------
@app.get("/health")
def health_check():
    return {"status":"healthy","version":app.version,"count":len(pills)}

@app.get("/reload-data")
async def reload_data(background_tasks: BackgroundTasks):
    ok = load_data()
    return {"message": "reload " + ("succeeded" if ok else "failed"), "count": len(pills)}

# -----------------------------------------------------------------------------
# Frontend HTML routes
# -----------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def serve_index():
    path = BASE_DIR / "index.html"
    if path.exists(): return FileResponse(path)
    raise HTTPException(status_code=404, detail="index.html not found")

@app.get("/index.html")
async def redirect_index():
    return RedirectResponse(url="/")

@app.get("/details.html", response_class=HTMLResponse)
async def serve_details():
    path = BASE_DIR / "details.html"
    if path.exists(): return FileResponse(path)
    raise HTTPException(status_code=404, detail="details.html not found")

# -----------------------------------------------------------------------------
# Core API endpoints
# -----------------------------------------------------------------------------
@app.get("/details")
def get_pill_details(
    imprint: Optional[str] = Query(None),
    drug_name: Optional[str] = Query(None),
    rxcui: Optional[str] = Query(None),
    ndc: Optional[str] = Query(None)
) -> Dict[str, Any]:
    if not pills and not load_data(): raise HTTPException(500, "no data")
    data = pills.copy()
    used_ndc = False

    if ndc:
        used_ndc = True
        c = re.sub(r"[^0-9]","", ndc)
        data = [p for p in data if re.sub(r"[^0-9]","",str(p.get("ndc11","")))==c or re.sub(r"[^0-9]","",str(p.get("ndc9","")))==c]
    elif rxcui:
        data = [p for p in data if str(p.get("rxcui",""))==str(rxcui)]
    elif imprint and drug_name:
        imp = normalize_imprint(imprint); nm = normalize_name(drug_name)
        data = [p for p in data if normalize_imprint(p.get("splimprint",""))==imp and normalize_name(p.get("medicine_name",""))==nm]
    elif imprint:
        imp = normalize_imprint(imprint)
        data = [p for p in data if normalize_imprint(p.get("splimprint",""))==imp]
    elif drug_name:
        nm = normalize_name(drug_name)
        data = [p for p in data if normalize_name(p.get("medicine_name",""))==nm]
    else:
        raise HTTPException(400, "provide imprint, drug_name, rxcui or ndc")

    if not data: raise HTTPException(404, "no match")
    rec = data[0].copy()
    files = rec.get("image_filename","") if used_ndc else ",".join([p.get("image_filename","") for p in data])
    rec["image_urls"] = get_image_urls(files)
    return rec

@app.get("/search")
def search(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query("imprint"),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100)
) -> Dict[str, Any]:
    if not pills and not load_data(): raise HTTPException(500, "no data")
    filtered = pills.copy()
    if q:
        qq = q.strip()
        if type=="imprint": filtered=[p for p in filtered if normalize_imprint(p.get("splimprint",""))==normalize_imprint(qq)]
        elif type=="drug": filtered=[p for p in filtered if normalize_name(p.get("medicine_name",""))==normalize_name(qq)]
        elif type=="ndc":
            c=re.sub(r"[^0-9]","",qq)
            filtered=[p for p in filtered if c in re.sub(r"[^0-9]","",str(p.get("ndc11",""))) or c in re.sub(r"[^0-9]","",str(p.get("ndc9","")))]
    if color: filtered=[p for p in filtered if p.get("splcolor_text","""].strip().lower()==color.strip().lower()]
    if shape: filtered=[p for p in filtered if p.get("splshape_text","""].strip().lower()==shape.strip().lower()]

    # dedupe & attach images
    seen=set(); results=[]
    for p in filtered:
        key=(normalize_name(p.get("medicine_name","")), normalize_imprint(p.get("splimprint","")), p.get("splcolor_text",""), p.get("splshape_text",""), str(p.get("rxcui","")))
        if key not in seen:
            seen.add(key)
            item=p.copy()
            item["image_urls"]=get_image_urls(item.get("image_filename",""))
            results.append(item)
    total=len(results)
    start=(page-1)*per_page; end=start+per_page
    return {"results":results[start:end],"total":total,"page":page,"per_page":per_page,"total_pages":(total+per_page-1)//per_page}

@app.get("/filters")
def get_filters():
    if not pills and not load_data(): raise HTTPException(500, "no data")
    std_colors={"White":"#FFF","Blue":"#00F","Green":"#080","Red":"#F00","Yellow":"#FF0","Pink":"#FFC","Orange":"#FA0","Purple":"#80F","Gray":"#888","Brown":"#A52","Beige":"#F5F"}
    colors=[{"name":n,"hex":h} for n,h in std_colors.items()]
    def mk_shape(s):return {"name":s.title(),"icon":"🔹"}
    shapes=[]; seen=set()
    for p in pills:
        s=p.get("splshape_text","""".strip());
        if s and s.lower() not in seen: shapes.append(mk_shape(s));seen.add(s.lower())
    return {"colors":colors,"shapes":sorted(shapes,key=lambda x:x["name"]) }

@app.get("/suggestions")
def get_suggestions(q: str = Query(...),type: str = Query(...)):
    if not pills and not load_data(): return []
    qq=q.strip();res=[];seen=set()
    if type=="imprint":
        for p in pills:
            imp=p.get("splimprint","""";norm=normalize_imprint(imp)
            if norm and norm not in seen and (norm==normalize_imprint(qq) or normalize_imprint(qq) in norm):seen.add(norm);res.append(imp);
    elif type=="drug":
        for p in pills:
            nm=p.get("medicine_name","""";norm=normalize_name(nm)
            if norm and norm not in seen and (norm==normalize_name(qq) or normalize_name(qq) in norm):seen.add(norm);res.append(nm);
    elif type=="ndc":
        c=re.sub(r"[^0-9]","",qq)
        for p in pills:
            for f in ("ndc9","ndc11"): val=re.sub(r"[^0-9]","",str(p.get(f,"")))
                if val.startswith(c) and val not in seen:seen.add(val);res.append(val)
    return res[:10]

@app.get("/ndc_lookup")
def ndc_lookup(ndc: str = Query(...)):
    if not ndc or (not pills and not load_data()): return {"found":False}
    c=re.sub(r"[^0-9]","",ndc)
    m=next((p for p in pills if c in re.sub(r"[^0-9]","",str(p.get("ndc11",""))) or c in re.sub(r"[^0-9]","",str(p.get("ndc9","")))),None)
    if not m: return {"found":False}
    m["image_urls"]=get_image_urls(m.get("image_filename",""))
    m["found"]=True
    return m

@app.get("/ndc_diagnostic")
def ndc_diagnostic(ndc: str = Query(...)):
    if not ndc or (not pills and not load_data()):return {"error":"no data/ndc"}
    images=get_image_urls(ndc)
    c=re.sub(r"[^0-9]","",ndc)
    m=next((p for p in pills if c in re.sub(r"[^0-9]","",str(p.get("ndc11",""))) or c in re.sub(r"[^0-9]","",str(p.get("ndc9","")))),None)
    return {"ndc":ndc,"images_found":bool(images),"image_urls":images,"record":m}

@app.get("/index.html")
async def redirect_index2():
    return RedirectResponse(url="/")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app,host="0.0.0.0",port=int(os.getenv("PORT",10000)))
