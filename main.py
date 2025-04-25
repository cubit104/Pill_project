from fastapi import FastAPI, Query, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from typing import List, Optional, Dict, Any, Set
import pandas as pd
import os
import re
import logging
import time
from collections import defaultdict
from pathlib import Path
import sqlalchemy
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
import requests
from ndc_module import NDCHandler  # Import the NDC handler
import concurrent.futures



# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Current directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

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

# Common image extensions to check
IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"]

# Config settings
MAX_SUGGESTIONS = 10
MAX_IMAGES_PER_DRUG = 20
CONFIG = {
    "current_timestamp": "2025-04-24 02:21:19",
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

def normalize_text(text):
    """
    Normalize text for consistent display:
    1. Convert text to lowercase
    2. Capitalize first letter of each sentence
    3. Preserve acronyms and proper capitalization for names (heuristically)
    4. Handle special medical terms appropriately

    Args:
        text (str): The input text to normalize

    Returns:
        str: Normalized text
    """
    if not text or not isinstance(text, str):
        return ""

    # List of terms to preserve capitalization (common drug name components, acronyms)
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
        'er': 'ER',  # Extended Release
        'sr': 'SR',  # Sustained Release
        'xr': 'XR',  # Extended Release
        'dr': 'DR',  # Delayed Release
        'ir': 'IR',  # Immediate Release
        'ph': 'pH',
    }

    # Convert to lowercase first
    text = text.lower()

    # Split into sentences and capitalize first letter of each sentence
    sentences = re.split(r'([.!?]\s+)', text)
    result = []

    for i, part in enumerate(sentences):
        if i % 2 == 0:  # This is the sentence content
            if part:
                # Capitalize first letter of the sentence
                part = part[0].upper() + part[1:] if part else part

                # Replace preserved terms with their proper capitalization
                for term, replacement in preserve_terms.items():
                    # Make sure we only replace whole words, not substrings
                    part = re.sub(r'\b' + term + r'\b', replacement, part)

        result.append(part)

    # Join sentences back together
    normalized = ''.join(result)

    # If the text didn't have sentence endings, make sure at least the first character is capitalized
    if not normalized:
        return ""
    elif len(normalized) == 1:
        return normalized.upper()
    else:
        return normalized[0].upper() + normalized[1:]

# Helper function to find images for an NDC code (updated for Supabase)
def find_images_for_ndc(ndc_code, db_conn=None):
    """Find images for an NDC code using Supabase"""
    # Clean the NDC for matching without dashes
    clean_ndc = re.sub(r'[^0-9]', '', ndc_code)
    images = []

    try:
        # Query Supabase for images associated with this NDC code
        if db_conn:
            query = text("""
                SELECT image_filename 
                FROM pillfinder 
                WHERE ndc9 = :ndc_code OR ndc11 = :ndc_code 
                OR REPLACE(ndc9, '-', '') = :clean_ndc 
                OR REPLACE(ndc11, '-', '') = :clean_ndc
            """)

            result = db_conn.execute(query, {"ndc_code": ndc_code, "clean_ndc": clean_ndc})

            all_filenames = []
            for row in result:
                if row[0]:  # image_filename
                    all_filenames.append(row[0])

            if all_filenames:
                combined = ",".join(all_filenames)
                valid_images = get_valid_images_from_supabase(combined)
                images = [f"{IMAGE_BASE}/{img}" for img in valid_images]
    except Exception as e:
        logger.error(f"Error finding images for NDC {ndc_code}: {e}")

    # Return placeholder if no images
    if not images:
        images = ["https://via.placeholder.com/400x300?text=No+Image+Available"]

    return images

def clean_filename(filename: str) -> str:
    """Clean individual filename"""
    if pd.isna(filename) or not filename:
        return ""
    # Remove any whitespace and invalid characters
    return re.sub(r'[^\w.-]', '', str(filename).strip())



def get_clean_image_list(image_str: str) -> List[str]:
    """Clean and normalize image filenames from DB (handles commas, semicolons, bad spacing)."""
    if not image_str:
        return ["placeholder.jpg"]
    split_chars = re.split(r'[;,]', image_str)
    cleaned = []

    for name in split_chars:
        name = name.strip()
        if name.lower().endswith((".jpg", ".jpeg", ".png")):
            cleaned.append(name)

    return cleaned or ["placeholder.jpg"]


def split_image_filenames(filename: str) -> List[str]:
    """Split image filenames considering various separators"""
    if pd.isna(filename) or not filename:
        return []

    # Handle multiple separator types (comma, semicolon)
    parts = re.split(r'[,;]+', str(filename))
    # Clean each part and remove empty strings
    return [clean_filename(part) for part in parts if clean_filename(part)]

def normalize_imprint(value: str) -> str:
    """Normalize imprint value by standardizing format"""
    if pd.isna(value):
        return ""
    # Remove special characters and standardize spacing
    cleaned = re.sub(r'[;,\s]+', ' ', str(value)).strip().upper()
    return cleaned

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

def check_image_exists_in_supabase(image_name: str) -> bool:
    """Check if an image exists in Supabase storage"""
    if not image_name:
        return False

    image_name = clean_filename(image_name)

    # Try with and without extensions
    for ext in IMAGE_EXTENSIONS:
        possible_paths = [
            f"{image_name}{ext}",
            f"{image_name}.{ext}",
            image_name
        ]

        for path in possible_paths:
            # Check if image exists in Supabase
            url = f"{IMAGE_BASE}/{path}"
            try:
                response = requests.head(url, timeout=2)
                if response.status_code == 200:
                    return path
            except Exception:
                pass

    return ""

def get_valid_images_from_supabase(filename: str) -> Set[str]:
    """Get set of valid image paths from filename"""
    valid_images = set()

    # Split the filename on multiple delimiters
    image_names = split_image_filenames(filename)

    for image_name in image_names:
        valid_path = check_image_exists_in_supabase(image_name)
        if valid_path:
            valid_images.add(valid_path)

    return valid_images

def normalize_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize text fields in a data dictionary
    """
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

def connect_to_database():
    """Connect to Supabase PostgreSQL database"""
    global db_engine
    try:
        logger.info("Connecting to Supabase PostgreSQL database...")
        db_engine = create_engine(DATABASE_URL)

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


# Connect to database on startup
connect_to_database()


@app.middleware("http")
async def fix_port_redirects(request: Request, call_next):
    """Middleware to ensure all internal redirects use port 8000"""
    response = await call_next(request)

    # If the response is a redirect, ensure it uses port 8000
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
    """Get details about a pill"""
    global db_engine

    # 1) Ensure database connection is available
    if not db_engine:
        if not connect_to_database():
            raise HTTPException(status_code=500, detail="Database connection not available")

    used_ndc = False
    pill_info = None

    try:
        with db_engine.connect() as conn:
            # 2) Build the query based on search parameters
            if ndc:
                used_ndc = True
                clean_ndc = re.sub(r'[^0-9]', '', ndc)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE ndc11 = :ndc 
                    OR ndc9 = :ndc
                    OR REPLACE(ndc11, '-', '') = :clean_ndc
                    OR REPLACE(ndc9, '-', '') = :clean_ndc
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
                norm_imp = normalize_imprint(imprint)
                norm_name = normalize_name(drug_name)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+', ' ', 'g')) = UPPER(:imprint)
                    AND LOWER(TRIM(medicine_name)) = LOWER(:drug_name)
                    LIMIT 1
                """)
                result = conn.execute(query, {"imprint": norm_imp, "drug_name": norm_name})
            elif imprint:
                norm_imp = normalize_imprint(imprint)
                query = text("""
                    SELECT * FROM pillfinder
                    WHERE UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+', ' ', 'g')) = UPPER(:imprint)
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

            # 3) Process the result
            row = result.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No pills found matching your criteria")

            # Convert row to dict
            columns = result.keys()
            pill_info = dict(zip(columns, row))
            pill_info = normalize_fields(pill_info)

            # 4) Get images for the pill
            if used_ndc:
                # Option B: NDC → only first row
                filenames = pill_info.get("image_filename", "")
            else:
                # Option A: imprint/drug/RxCUI → could merge multiple rows
                query = text("""
                    SELECT image_filename FROM pillfinder
                    WHERE medicine_name = :medicine_name
                    AND splimprint = :splimprint
                """)
                image_result = conn.execute(query, {
                    "medicine_name": pill_info.get("medicine_name", ""),
                    "splimprint": pill_info.get("splimprint", "")
                })

                filenames_list = []
                for img_row in image_result:
                    if img_row[0]:
                        filenames_list.append(img_row[0])

                filenames = ",".join(filenames_list)

            valid = get_valid_images_from_supabase(filenames)
            image_urls = [f"{IMAGE_BASE}/{img}" for img in valid][:MAX_IMAGES_PER_DRUG]

            if not image_urls:
                image_urls = ["https://via.placeholder.com/400x300?text=No+Image+Available"]

            # Add carousel-specific data format
            pill_info["image_urls"] = image_urls
            pill_info["has_multiple_images"] = len(image_urls) > 1
            pill_info["carousel_images"] = [
                {"id": i, "url": url} for i, url in enumerate(image_urls)
            ]

            return pill_info

    except SQLAlchemyError as e:
        logger.error(f"Database error in get_pill_details: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    except Exception as e:
        logger.error(f"Error in get_pill_details: {e}")
        raise HTTPException(status_code=500, detail=f"Error: {e}")


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
def search(
    q: Optional[str] = Query(None),
    type: Optional[str] = Query("imprint"),
    color: Optional[str] = Query(None),
    shape: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100)
) -> dict:
    global db_engine, ndc_handler

    if not db_engine and not connect_to_database():
        raise HTTPException(500, "Database connection not available")

    logger.info(f"[SEARCH] q={q}, type={type}, color={color}, shape={shape}")

    try:
        with db_engine.connect() as conn:
            base_sql = """
                SELECT medicine_name, splimprint, splcolor_text, splshape_text, ndc11, rxcui, image_filename
                FROM pillfinder
                WHERE 1=1
            """
            params = {}

            if q:
                query = q.strip()
                if type == "imprint":
                    norm = normalize_imprint(query)
                    base_sql += " AND UPPER(REGEXP_REPLACE(splimprint, '[;,\\s]+', ' ', 'g')) = UPPER(:imprint)"
                    params["imprint"] = norm
                elif type == "drug":
                    base_sql += " AND LOWER(medicine_name) LIKE LOWER(:drug_name)"
                    params["drug_name"] = f"{query.lower().strip()}%"
                elif type == "ndc":
                    clean_ndc = re.sub(r'[^0-9]', '', query)
                    base_sql += """
                        AND (
                            ndc11 = :ndc OR ndc9 = :ndc OR
                            REPLACE(ndc11, '-', '') LIKE :like_ndc OR
                            REPLACE(ndc9, '-', '') LIKE :like_ndc
                        )
                    """
                    params["ndc"] = query
                    params["like_ndc"] = f"%{clean_ndc}%"

            if color:
                base_sql += " AND LOWER(TRIM(splcolor_text)) = LOWER(:color)"
                params["color"] = color.strip().lower()

            if shape:
                base_sql += " AND LOWER(TRIM(splshape_text)) = LOWER(:shape)"
                params["shape"] = shape.strip().lower()

            final_sql = f"{base_sql} ORDER BY ndc11, rxcui NULLS LAST"
            result = conn.execute(text(final_sql), params)

            records = []
            for row in result:
                item = {
                    "medicine_name": row[0] or "",
                    "splimprint": row[1] or "",
                    "splcolor_text": row[2] or "",
                    "splshape_text": row[3] or "",
                    "ndc11": row[4] or "",
                    "rxcui": row[5] or "",
                    "image_filename": row[6] or ""
                }

                # ✅ Build cleaned image list from current row
                imgs = get_clean_image_list(item["image_filename"])
                image_urls = [f"{IMAGE_BASE}/{i}" for i in imgs[:MAX_IMAGES_PER_DRUG]]
                item["image_urls"] = image_urls
                item["has_multiple_images"] = len(imgs) > 1  # 🛠 FIX HERE - use original imgs
                item["carousel_images"] = [{"id": idx, "url": url} for idx, url in enumerate(image_urls)]


                records.append(item)

        # Pagination
        total = len(records)
        start = (page - 1) * per_page
        end = start + per_page
        page_data = records[start:end]

        return {
            "results": page_data,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page
        }

    except Exception as e:
        logger.error(f"[SEARCH ERROR] {e}", exc_info=True)
        raise HTTPException(500, f"Search error: {e}")


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

        # Find images using our helper function
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
        "using_supabase": True
    }

@app.get("/reload-data")
async def reload_data(background_tasks: BackgroundTasks):
    """Reload database connection and recreate handlers"""
    success = connect_to_database()

    record_count = 0
    if success and db_engine:
        try:
            with db_engine.connect() as conn:
                result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
                record_count = result.scalar()
        except:
            pass

    return {
        "message": "Data reload " + ("succeeded" if success else "failed"),
        "record_count": record_count,
        "ndc_handler_active": ndc_handler is not None
    }

@app.get("/ndc_diagnostic")
def ndc_diagnostic(
    ndc: str = Query(..., description="NDC code to diagnose")
):
    """Diagnostic endpoint for NDC search issues"""
    global db_engine, ndc_handler

    if not db_engine:
        if not connect_to_database():
            return {"error": "Database connection not available"}

    try:
        # Get database information
        db_info = {}
        with db_engine.connect() as conn:
            clean_ndc = re.sub(r'[^0-9]', '', ndc)
            query = text("""
                SELECT ndc9, ndc11, medicine_name, splimprint, image_filename 
                FROM pillfinder
                WHERE ndc11 = :ndc OR ndc9 = :ndc 
                OR REPLACE(ndc11, '-', '') = :clean_ndc 
                OR REPLACE(ndc9, '-', '') = :clean_ndc
                LIMIT 1
            """)

            result = conn.execute(query, {"ndc": ndc, "clean_ndc": clean_ndc})
            row = result.fetchone()

            if row:
                db_info = {
                    "ndc9": row[0],
                    "ndc11": row[1],
                    "medicine_name": row[2],
                    "imprint": row[3],
                    "image_filename": row[4]
                }

        # Test the image helper function
        images = []
        if db_engine:
            with db_engine.connect() as conn:
                images = find_images_for_ndc(ndc, conn)

        # Get drug info from NDC handler
        drug_info = ndc_handler.find_drug_by_ndc(ndc) if ndc_handler else None

        # Return diagnostic info
        return {
            "ndc": ndc,
            "database_found": bool(db_info),
            "database_info": db_info,
            "images_found": images != ["https://via.placeholder.com/400x300?text=No+Image+Available"],
            "image_urls": images,
            "drug_found_in_handler": drug_info is not None,
            "drug_name": drug_info.get("medicine_name") if drug_info else None,
            "has_imprint": bool(drug_info.get("splimprint")) if drug_info else False,
            "imprint": drug_info.get("splimprint") if drug_info else None,
            "related_ndcs_count": len(drug_info.get("related_ndcs", [])) if drug_info else 0
        }
    except Exception as e:
        return {"error": str(e)}

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
