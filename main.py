from fastapi import FastAPI, Query, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from typing import List, Optional, Dict, Any, Set
import pandas as pd
import os
import re
import logging
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
import requests
from ndc_module import NDCHandler  # Import the NDC handler
import asyncio
import aiohttp
from fastapi import BackgroundTasks
from functools import lru_cache
import time
from datetime import datetime

# Set up logging
logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
logger = logging.getLogger(__name__)

# Current directory
BASE_DIR = os.path.dirname(os.path.abspath(__name__))

# Supabase Configuration
IMAGE_BASE = "https://uqdwcxizabmxwflkbfrb.supabase.co/storage/v1/object/public/images"

# Direct Postgres connection for Supabase
DATABASE_URL = (
    "postgresql://postgres.uqdwcxizabmxwflkbfrb:Potato6200$"
    "supabase@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
)

# File paths and settings for backward compatibility
CSV_PATH = os.path.join(BASE_DIR, "Final_structured_combined_with_image_filename.csv")
IMAGES_DIR = os.path.join(BASE_DIR, "images")
IMAGE_FOLDER = "images"  # For compatibility with the provided code

# Common image extensions to check (updated list)
IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]
IMAGE_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff"
}

# Config settings - UPDATED with current values
MAX_SUGGESTIONS = 10
MAX_IMAGES_PER_DRUG = 20
CONFIG = {
    "current_timestamp": "2025-05-01 04:30:46",
    "current_user": "cubit104"
}

# Create FastAPI app
app = FastAPI(
    title="Pill Identifier API",
    description="API for identifying pills based on various characteristics",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create image folder if it doesn't exist (for caching)
image_dir = Path(IMAGE_FOLDER)
if not image_dir.exists():
    image_dir.mkdir(parents=True)
    logger.info(f"Created image directory: {IMAGE_FOLDER}")

# Mount the images directory for local access
try:
    app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")
    logger.info(f"Successfully mounted /images directory from {IMAGES_DIR}")
except Exception as e:
    logger.error(f"Error mounting images directory: {e}")

# Global database connection and NDC handler
db_engine = None
ndc_handler = None

# Filename caches
_common_drug_cache = {}
_missing_files_log = set()  # Track missing files for logging purposes only

@lru_cache(maxsize=1000)
def normalize_text(text):
    """Normalize text for consistent display"""
    if not text or not isinstance(text, str):
        return ""

    preserve_terms = {
        'hcl': 'HCl',
        'mg': 'mg',
        'ml': 'mL', 
        'mcg': 'mcg',
        'iu': 'IU',
        'fda': 'FDA',
        'usp': 'USP',
        'otc': 'OTC',
        'rx': 'Rx',
        'ndc': 'NDC',
        'dea': 'DEA',
        'rxcui': 'RxCUI',
        'er': 'ER',
        'sr': 'SR',
        'xr': 'XR',
        'dr': 'DR',
        'ir': 'IR',
        'ph': 'pH',
    }

    text = text.lower()
    sentences = re.split(r'([.!?]\s+)', text)
    result = []

    for i, part in enumerate(sentences):
        if i % 2 == 0:
            if part:
                part = part[0].upper() + part[1:] if part else part
                for term, replacement in preserve_terms.items():
                    part = re.sub(r'\b' + term + r'\b', replacement, part)
        result.append(part)

    normalized = ''.join(result)
    return normalized[0].upper() + normalized[1:] if normalized else ""

def clean_filename(filename: str) -> str:
    """Clean individual filename"""
    if pd.isna(filename) or not filename:
        return ""
    return re.sub(r'[^\w.-]', '', str(filename).strip())

def get_clean_image_list(image_str: str) -> List[str]:
    """Clean and normalize image filenames from DB (handles multiple extensions)"""
    if not image_str:
        return ["placeholder.jpg"]

    split_chars = re.split(r'[;,]', image_str)
    cleaned = []

    for name in split_chars:
        name = name.strip()
        if name.lower().endswith(tuple(IMAGE_EXTENSIONS)):
            cleaned.append(name)
        else:
            # If no extension, try adding .jpg
            cleaned.append(f"{name}.jpg")

    return cleaned or ["placeholder.jpg"]

def split_image_filenames(filename: str) -> List[str]:
    """Split image filenames considering various separators"""
    if pd.isna(filename) or not filename:
        return []
    parts = re.split(r'[,;]+', str(filename))
    return [clean_filename(part) for part in parts if clean_filename(part)]

@lru_cache(maxsize=1000)
def normalize_imprint(value: str) -> str:
    """Normalize imprint value by standardizing format"""
    if pd.isna(value):
        return ""
    cleaned = re.sub(r'[;,\s]+', ' ', str(value)).strip().upper()
    return cleaned

@lru_cache(maxsize=1000)
def normalize_name(value: str) -> str:
    """Normalize drug name"""
    if pd.isna(value):
        return ""
    return str(value).strip().lower()

def get_unique_key(item: Dict) -> tuple:
    """Generate a unique key for deduplication"""
    return (
        normalize_name(item.get("medicine_name", "")),
        normalize_imprint(item.get("splimprint", "")),
        str(item.get("splcolor_text", "")).lower().strip(),
        str(item.get("splshape_text", "")).lower().strip(),
        str(item.get("rxcui", "")).strip()
    )

# NEW OPTIMIZED IMAGE HANDLING FUNCTIONS

def get_image_url(filename: str) -> str:
    """Get image URL from filename, removing validation"""
    if not filename:
        return f"{IMAGE_BASE}/placeholder.jpg"
    
    # Extract just the first part before any comma
    first_filename = filename.split(',')[0].strip()
    if not first_filename:
        return f"{IMAGE_BASE}/placeholder.jpg"
    
    # Trust the database - use the filename directly
    return f"{IMAGE_BASE}/{first_filename}"

def get_image_urls(filenames_str: str) -> List[str]:
    """Get multiple image URLs from a comma/semicolon separated string"""
    if not filenames_str:
        return [f"{IMAGE_BASE}/placeholder.jpg"]
    
    # Split by commas or semicolons
    parts = re.split(r'[,;]+', filenames_str)
    urls = []
    
    for part in parts:
        clean_part = part.strip()
        if clean_part:
            # Trust the database - use the filename directly
            urls.append(f"{IMAGE_BASE}/{clean_part}")
    
    return urls or [f"{IMAGE_BASE}/placeholder.jpg"]

def process_image_filenames(image_filename: str) -> dict:
    """Process image filenames into required format for API responses"""
    if not image_filename:
        placeholder = f"{IMAGE_BASE}/placeholder.jpg"
        return {
            "image_urls": [placeholder],
            "has_multiple_images": False,
            "carousel_images": [{"id": 0, "url": placeholder}]
        }
    
    image_urls = get_image_urls(image_filename)
    
    return {
        "image_urls": image_urls[:MAX_IMAGES_PER_DRUG],
        "has_multiple_images": len(image_urls) > 1,
        "carousel_images": [
            {"id": i, "url": url} for i, url in enumerate(image_urls[:MAX_IMAGES_PER_DRUG])
        ]
    }

def normalize_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize text fields in a data dictionary"""
    fields_to_normalize = [
        "medicine_name", "splcolor_text", "splshape_text", 
        "dailymed_pharma_class_epc", "pharmclass_fda_epc", 
        "dosage_form", "spl_strength", "spl_ingredients", "spl_inactive_ing",
        "status_rx_otc", "dea_schedule_name", "splroute", "route"
    ]

    for field in fields_to_normalize:
        if field in data and data[field]:
            data[field] = normalize_text(str(data[field]))

    return data

def initialize_ndc_handler():
    """Initialize the NDC handler with the CSV files"""
    global ndc_handler
    try:
        drugs_csv = os.path.join(BASE_DIR, "drugs.csv")
        ndc_csv = os.path.join(BASE_DIR, "ndc_relationships.csv")

        if os.path.exists(drugs_csv) and os.path.exists(ndc_csv):
            ndc_handler = NDCHandler(drugs_csv, ndc_csv)
            logger.info(f"NDC handler initialized successfully")
            return True
        else:
            logger.warning(f"NDC CSV files not found. NDC functionality will be limited.")
            ndc_handler = None
            return False
    except Exception as e:
        logger.error(f"Error initializing NDC handler: {e}")
        ndc_handler = None
        return False

def find_images_for_ndc(ndc, conn):
    """Find images for a given NDC code"""
    try:
        clean_ndc = re.sub(r'[^0-9]', '', ndc)
        query = text("""
            SELECT DISTINCT image_filename FROM pillfinder
            WHERE ndc11 = :ndc OR ndc9 = :ndc
            OR REPLACE(ndc11, '-', '') = :clean_ndc
            OR REPLACE(ndc9, '-', '') = :clean_ndc
        """)
        
        rows = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})
        all_filenames = []
        
        for row in rows:
            if row[0]:
                all_filenames.append(row[0])
        
        if not all_filenames:
            return ["https://via.placeholder.com/400x300?text=No+Image+Available"]
            
        # Use our optimized function to get URLs
        all_urls = []
        for filename_str in all_filenames:
            urls = get_image_urls(filename_str)
            all_urls.extend(urls)
        
        # Remove duplicates
        unique_urls = list(dict.fromkeys(all_urls))
        
        return unique_urls or ["https://via.placeholder.com/400x300?text=No+Image+Available"]
    except Exception as e:
        logger.error(f"Error finding images for NDC {ndc}: {e}")
        return ["https://via.placeholder.com/400x300?text=No+Image+Available"]

def connect_to_database():
    """Connect to Supabase PostgreSQL database with connection pooling"""
    global db_engine
    try:
        logger.info("Connecting to Supabase PostgreSQL database...")
        # Add pool settings for better performance
        db_engine = create_engine(
            DATABASE_URL, 
            pool_size=10, 
            max_overflow=20,
            pool_timeout=30,
            pool_recycle=1800
        )

        # Test the connection
        with db_engine.connect() as conn:
            result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
            count = result.scalar()
            logger.info(f"Connected to database successfully. Found {count} records in pillfinder table.")

        # Initialize NDC handler
        initialize_ndc_handler()

        return True
    except Exception as e:
        logger.error(f"Error connecting to database: {e}")
        return False

async def warmup_system():
    """Pre-warm the system to avoid slow initial requests"""
    global _common_drug_cache, db_engine
    
    logger.info("Starting system warm-up...")
    start_time = time.time()
    
    # Ensure database connection is established
    if not db_engine and not connect_to_database():
        logger.error("Failed to connect to database during warmup")
        return
    
    try:
        # Pre-load common queries
        with db_engine.connect() as conn:
            # Get some common drug names for cache
            common_drugs_query = text("""
                SELECT DISTINCT medicine_name FROM pillfinder
                ORDER BY medicine_name
                LIMIT 50
            """)
            common_drugs = conn.execute(common_drugs_query).fetchall()
            for drug in common_drugs:
                drug_name = drug[0] if drug[0] else ""
                _common_drug_cache[drug_name.lower()] = drug_name
                # Normalize to warm up the cache
                normalize_name(drug_name)
        
        elapsed = time.time() - start_time
        logger.info(f"System warm-up complete in {elapsed:.2f} seconds")
    except Exception as e:
        logger.error(f"Error during system warm-up: {e}")

# Connect to database on startup
connect_to_database()

@app.on_event("startup")
async def startup_event():
    """Run tasks when the application starts"""
    await warmup_system()

@app.middleware("http")
async def fix_port_redirects(request: Request, call_next):
    """Middleware to ensure all internal redirects use port 8000"""
    response = await call_next(request)
    if response.status_code in (301, 302, 307, 308) and 'location' in response.headers:
        location = response.headers['location']
        if ':8001' in location:
            new_location = location.replace(':8001', ':8000')
            response.headers['location'] = new_location
    return response

@app.get("/details.html", response_class=HTMLResponse)
async def get_details_html():
    """Serve the details HTML page"""
    details_path = os.path.join(BASE_DIR, "details.html")
    if os.path.exists(details_path):
        return FileResponse(details_path)
    raise HTTPException(status_code=404, detail=f"Details page not found at {details_path}")

@app.get("/details")
async def get_pill_details(
    imprint: Optional[str] = Query(None),
    drug_name: Optional[str] = Query(None),
    rxcui: Optional[str] = Query(None),
    ndc: Optional[str] = Query(None)
):
    """Get details about a pill, trusting the database for image filenames."""
    global db_engine

    # Ensure DB connection
    if not db_engine:
        if not connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    used_ndc = False

    try:
        # 1) Fetch the pill row
        with db_engine.connect() as conn:
            if ndc:
                used_ndc = True
                clean_ndc = re.sub(r'[^0-9]', '', ndc)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE ndc11 = :ndc 
                       OR ndc9  = :ndc
                       OR REPLACE(ndc11, '-', '') = :clean_ndc
                       OR REPLACE(ndc9,  '-', '') = :clean_ndc
                    LIMIT 1
                """)
                result = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})

            elif rxcui:
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE rxcui = :rxcui
                    LIMIT 1
                """)
                result = conn.execute(query, {"rxcui": rxcui})

            elif imprint and drug_name:
                norm_imp  = normalize_imprint(imprint)
                norm_name = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+',' ','g')) = UPPER(:imprint)
                      AND LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp, "drug_name": norm_name})

            elif imprint:
                norm_imp = normalize_imprint(imprint)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+',' ','g')) = UPPER(:imprint)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp})

            elif drug_name:
                norm_name = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"drug_name": norm_name})

            else:
                raise HTTPException(status_code=400, detail="At least one search parameter is required")

            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No pills found matching your criteria")

            columns = result.keys()
            pill_info = dict(zip(columns, row))
            pill_info = normalize_fields(pill_info)

            # 2) Handle image filenames
            if used_ndc:
                filenames = pill_info.get("image_filename", "")
            else:
                image_q = text("""
                    SELECT image_filename FROM pillfinder
                    WHERE medicine_name = :medicine_name
                      AND splimprint    = :splimprint
                """)
                img_rows = conn.execute(image_q, {
                    "medicine_name": pill_info.get("medicine_name", ""),
                    "splimprint": pill_info.get("splimprint", "")
                })
                filenames = ",".join(r[0] for r in img_rows if r[0])

        # 3) Process images (now trusting the database)
        image_data = process_image_filenames(filenames)
        
        # 4) Attach to pill_info
        pill_info.update(image_data)

        logger.info(f"Details for {pill_info.get('medicine_name')}: {len(pill_info['image_urls'])} images")

        return pill_info

    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error")
    except Exception as e:
        logger.error(f"Error in get_pill_details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/suggestions")
def get_suggestions(
    q: str = Query(..., description="Search query"),
    type: str = Query(..., description="Search type (imprint, drug, or ndc)")
) -> List[str]:
    """Get search suggestions based on query and type"""
    logger.info(f"[suggestions] q={q!r}, type={type!r}")
    global db_engine, ndc_handler

    # 1) Normalize type aliases
    if type == "name":
        type = "drug"

    # 2) Bail early on too-short queries
    norm_q = (q or "").strip()
    if len(norm_q) < 2:
        return []

    # 3) Ensure database connection
    if not db_engine and not connect_to_database():
        raise HTTPException(503, "Database unavailable")

    # 4) NDC suggestions
    if type == "ndc":
        logger.info("→ branch: ndc")
        clean_q = re.sub(r"[^0-9]", "", norm_q)
        if ndc_handler:
            try:
                return ndc_handler.get_ndc_suggestions(clean_q, MAX_SUGGESTIONS)
            except Exception:
                logger.warning("ndc_handler failed, falling back to SQL")

        with db_engine.connect() as conn:
            sql = text("""
                SELECT DISTINCT ndc9 AS code
                    FROM pillfinder
                    WHERE ndc9 IS NOT NULL
                    AND REPLACE(ndc9, '-', '') LIKE :like_q
                UNION
                SELECT DISTINCT ndc11 AS code
                    FROM pillfinder
                    WHERE ndc11 IS NOT NULL
                    AND REPLACE(ndc11, '-', '') LIKE :like_q
                LIMIT :lim
            """)
            rows = conn.execute(sql, {
                "like_q": f"{clean_q}%",
                "lim": MAX_SUGGESTIONS
            })
            out = []
            for r in rows:
                code = r[0]
                if code:
                    out.append(code)
            return out

    # 5) Imprint suggestions
    elif type == "imprint":
        logger.info("→ branch: imprint")
        norm_imp = normalize_imprint(norm_q)
        if not norm_imp:
            return []
        with db_engine.connect() as conn:
            sql = text("""
                SELECT DISTINCT splimprint
                    FROM pillfinder
                    WHERE splimprint IS NOT NULL
                    AND UPPER(
                        REGEXP_REPLACE(splimprint, '[;,\\s]+',' ','g')
                    ) LIKE UPPER(:like_imp)
                    ORDER BY splimprint
                    LIMIT :lim
            """)
            rows = conn.execute(sql, {
                "like_imp": f"{norm_imp}%",
                "lim": MAX_SUGGESTIONS
            })
            out = []
            seen = set()
            for r in rows:
                imp = r[0]
                norm2 = normalize_imprint(imp)
                if norm2 and norm2 not in seen:
                    seen.add(norm2)
                    out.append(imp)
            return out

    # 6) Drug‐name suggestions (fixed)
    elif type == "drug":
        logger.info("→ branch: drug")
        lower_q = norm_q.lower()
        with db_engine.connect() as conn:
            sql = text("""
                SELECT DISTINCT medicine_name
                    FROM pillfinder
                    WHERE LOWER(medicine_name) LIKE :like_q
                    ORDER BY medicine_name
                    LIMIT :lim
            """)
            rows = conn.execute(sql, {
                "like_q": f"{lower_q}%",
                "lim": MAX_SUGGESTIONS
            })
            out = []
            seen = set()
            for r in rows:
                name = r[0]
                nl = normalize_name(name)
                if nl and nl not in seen:
                    seen.add(nl)
                    out.append(name)
            return out

    # 7) Unrecognized type → no suggestions
    logger.info("→ branch: default (no suggestions)")
    return []

@app.get("/search")
async def search(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query("imprint"),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    background_tasks: BackgroundTasks = None,
) -> dict:
    global db_engine

    if not db_engine and not connect_to_database():
        raise HTTPException(500, "Database connection not available")

    try:
        # Base SQL for the main query
        base_sql = """
            SELECT 
                medicine_name, 
                splimprint, 
                splcolor_text, 
                splshape_text, 
                ndc11, 
                rxcui, 
                image_filename
            FROM pillfinder
            WHERE 1=1
        """
        
        # Build the conditions and parameters
        params = {}
        where_conditions = []
        
        if q:
            query = q.strip()
            if type == "imprint":
                norm = normalize_imprint(query)
                where_conditions.append("UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+', ' ', 'g')) = UPPER(:imprint)")
                params["imprint"] = norm
            elif type == "drug":
                where_conditions.append("LOWER(medicine_name) LIKE LOWER(:drug_name)")
                params["drug_name"] = f"{query.lower()}%"
            elif type == "ndc":
                clean_ndc = re.sub(r'[^0-9]', '', query)
                where_conditions.append("""
                    (
                        ndc11 = :ndc OR ndc9 = :ndc OR
                        REPLACE(ndc11, '-', '') LIKE :like_ndc OR
                        REPLACE(ndc9, '-', '') LIKE :like_ndc
                    )
                """)
                params["ndc"] = query
                params["like_ndc"] = f"%{clean_ndc}%"

        if color:
            where_conditions.append("LOWER(TRIM(splcolor_text)) = LOWER(:color)")
            params["color"] = color.strip().lower()

        if shape:
            where_conditions.append("LOWER(TRIM(splshape_text)) = LOWER(:shape)")
            params["shape"] = shape.strip().lower()
            
        # Add all WHERE conditions to the base SQL
        for condition in where_conditions:
            base_sql += f" AND {condition}"

        with db_engine.connect() as conn:
            # First, get the total count with a separate query
            count_sql = f"""
                SELECT COUNT(*) FROM (
                    SELECT DISTINCT medicine_name, splimprint
                    FROM pillfinder
                    WHERE 1=1
                    {"".join(f' AND {cond}' for cond in where_conditions)}
                ) AS count_query
            """
            count_result = conn.execute(text(count_sql), params)
            total = count_result.scalar() or 0
            
            # Calculate pagination
            offset = (page - 1) * per_page
            
            # Add LIMIT and OFFSET to the query
            paginated_sql = f"""
                {base_sql}
                LIMIT :limit OFFSET :offset
            """
            
            # Execute the paginated query
            paginated_params = {**params, "limit": per_page, "offset": offset}
            result = conn.execute(text(paginated_sql), paginated_params)
            rows = result.fetchall()
        
        # Group by normalized medicine name and imprint
        grouped = {}
        for row in rows:
            # Access by index for SQLAlchemy 1.4 compatibility
            medicine_name = row[0] if row[0] else ""  # medicine_name is first column
            splimprint = row[1] if row[1] else ""     # splimprint is second column
            
            # Normalize for grouping
            norm_name = normalize_name(medicine_name)
            norm_imprint = normalize_imprint(splimprint)
            key = (norm_name, norm_imprint)
            
            if key not in grouped:
                grouped[key] = {
                    "medicine_name": medicine_name,
                    "splimprint": splimprint,
                    "splcolor_text": row[2] if row[2] else "",  # splcolor_text
                    "splshape_text": row[3] if row[3] else "",  # splshape_text
                    "ndc11": row[4] if row[4] else "",          # ndc11
                    "rxcui": row[5] if row[5] else "",          # rxcui
                    "image_filenames": set()                    # Use set to avoid duplicates
                }
            
            # Handle image filenames - 6th index
            if row[6]:  # image_filename
                filenames = split_image_filenames(row[6])
                for fname in filenames:
                    if fname:
                        grouped[key]["image_filenames"].add(fname)

        # Process the records
        records = []
        for data in grouped.values():
            # Convert the set of filenames to a comma-separated string
            merged_images = ",".join(data["image_filenames"])
            
            # Process images using our new optimized function
            image_data = process_image_filenames(merged_images)
            
            # Create the record with all required data
            item = {
                "medicine_name": data["medicine_name"],
                "splimprint": data["splimprint"],
                "splcolor_text": data["splcolor_text"],
                "splshape_text": data["splshape_text"],
                "ndc11": data["ndc11"],
                "rxcui": data["rxcui"],
                **image_data  # Include all image URLs and related fields
            }

            records.append(item)

        return {
            "results": records,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page
        }

    except Exception as e:
        logger.error(f"Search error: {str(e)}", exc_info=True)
        raise HTTPException(500, detail=f"Search error: {str(e)}")

@app.get("/filters") 
def get_filters():
    """Get available filters for colors and shapes"""
    global db_engine

    # Ensure database connection is available
    if not db_engine:
        if not connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    try:
        def clean_shape(shape):
            shape = str(shape).strip().lower()
            replacements = {
                "capsule": ("Capsule", "💊"),
                "round": ("Round", "⚪"),
                "oval": ("Oval", "⬭"),
                "rectangle": ("Rectangle", "▭"),
                "triangle": ("Triangle", "🔺"),
                "square": ("Square", "◼"),
                "pentagon": ("Pentagon", "⬟"),
                "hexagon": ("Hexagon", "⬢"),
                "diamond": ("Diamond", "🔷"),
                "heart": ("Heart", "❤️"),
                "tear": ("Tear", "💧"),
                "trapezoid": ("Trapezoid", "⬯")
            }
            for key, (name, icon) in replacements.items():
                if key in shape:
                    return {"name": name, "icon": icon}
            return {"name": shape.title(), "icon": "🔹"}

        standard_colors = {
            "White": "#FFFFFF",
            "Blue": "#0000FF",
            "Green": "#008000",
            "Red": "#FF0000",
            "Yellow": "#FFFF00",
            "Pink": "#FFC0CB",
            "Orange": "#FFA500",
            "Purple": "#800080",
            "Gray": "#808080",
            "Brown": "#A52A2A",
            "Beige": "#F5F5DC"
        }

        colors = [{"name": name, "hex": hexcode} for name, hexcode in standard_colors.items()]

        # Get shapes from the database
        with db_engine.connect() as conn:
            shape_query = text("""
                SELECT DISTINCT splshape_text FROM pillfinder 
                WHERE splshape_text IS NOT NULL AND splshape_text != ''
            """)
            result = conn.execute(shape_query)

            seen = set()
            unique_shapes = []

            for row in result:
                shape = row[0]
                if shape:
                    item = clean_shape(shape)
                    if item["name"] not in seen:
                        unique_shapes.append(item)
                        seen.add(item["name"])

        return {
            "colors": colors,
            "shapes": sorted(unique_shapes, key=lambda x: x["name"])
        }

    except SQLAlchemyError as e:
        logger.error(f"Database error in get_filters: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    except Exception as e:
        logger.error(f"Error getting filters: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting filters: {str(e)}")

@app.get("/ndc_lookup")
def ndc_lookup(
    ndc: str = Query(..., description="NDC code to look up")
):
    """Dedicated endpoint for NDC lookups"""
    global ndc_handler, db_engine

    if not ndc:
        return {"found": False, "error": "No NDC code provided"}

    if not db_engine:
        if not connect_to_database():
            return {"found": False, "error": "Database connection not available"}

    # Use the NDC handler for looking up the drug
    try:
        drug_info = {}
        if ndc_handler:
            drug_info = ndc_handler.find_drug_by_ndc(ndc) or {}

        # If not found in handler or missing details, look in database
        if not drug_info:
            drug_info = {}

            with db_engine.connect() as conn:
                clean_ndc = re.sub(r'[^0-9]', '', ndc)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE ndc11 = :ndc OR ndc9 = :ndc 
                    OR REPLACE(ndc11, '-', '') = :clean_ndc 
                    OR REPLACE(ndc9, '-', '') = :clean_ndc
                    LIMIT 1
                """)

                result = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})
                row = result.fetchone()

                if row:
                    # Convert row to dict
                    columns = result.keys()
                    drug_info = dict(zip(columns, row))
                    drug_info["found"] = True
                else:
                    return {"found": False}
        else:
            drug_info["found"] = True

        # Find images using our optimized helper function
        with db_engine.connect() as conn:
            image_urls = find_images_for_ndc(ndc, conn)
            drug_info["image_urls"] = image_urls

            # Add carousel-specific data format
            drug_info["has_multiple_images"] = len(image_urls) > 1
            drug_info["carousel_images"] = [
                {"id": i, "url": url} for i, url in enumerate(image_urls)
            ]

        return drug_info

    except Exception as e:
        logger.exception(f"Error in NDC lookup: {e}")
        return {"found": False, "error": str(e)}

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    """Serve the frontend HTML page"""
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail=f"Frontend file not found at {index_path}")

@app.get("/health")
def health_check():
    """Health check endpoint"""
    global db_engine

    # Try to connect to database if it's not connected
    if not db_engine:
        connect_to_database()

    # Check database connection
    db_connected = False
    record_count = 0
    if db_engine:
        try:
            with db_engine.connect() as conn:
                result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
                record_count = result.scalar()
                db_connected = True
        except:
            db_connected = False

    return {
        "status": "healthy" if db_connected else "degraded",
        "version": "1.0.0",
        "database_connected": db_connected,
        "record_count": record_count,
        "ndc_handler_active": ndc_handler is not None,
        "images_source": IMAGE_BASE,
        "images_dir": IMAGES_DIR,
        "images_dir_exists": os.path.exists(IMAGES_DIR),
        "using_supabase": True,
        "timestamp": CONFIG["current_timestamp"],
        "user": CONFIG["current_user"],
        "image_validation": "disabled"  # Added flag to show validation is off
    }

@app.get("/reload-data")
async def reload_data(background_tasks: BackgroundTasks):
    """Reload database connection and recreate handlers"""
    global _missing_files_log
    # Clear all caches
    _common_drug_cache.clear()
    _missing_files_log.clear()
    
    # Reset LRU caches
    normalize_text.cache_clear()
    normalize_imprint.cache_clear()
    normalize_name.cache_clear()
    
    # Update timestamp
    CONFIG["current_timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Reconnect to database
    success = connect_to_database()

    record_count = 0
    if success and db_engine:
        try:
            with db_engine.connect() as conn:
                result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
                record_count = result.scalar()
        except:
            pass

    # Run the warmup process in the background to restore caches
    background_tasks.add_task(warmup_system)

    return {
        "message": "Data reload " + ("succeeded" if success else "failed"),
        "record_count": record_count,
        "ndc_handler_active": ndc_handler is not None,
        "caches_cleared": True,
        "timestamp": CONFIG["current_timestamp"],
        "user": CONFIG["current_user"]
    }

# Redirects for compatibility
@app.get("/index.html")
async def redirect_to_index():
    """Redirect to the index page"""
    return RedirectResponse(url="/")

@app.get("/__routes__")
async def list_routes():
    # Return all the paths FastAPI knows about
    return sorted(route.path for route in app.router.routes)

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting server on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
