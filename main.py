from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import logging
import asyncio
from pathlib import Path
from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv()

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Current directory
BASE_DIR = str(Path(__file__).resolve().parent)

import database  # noqa: E402 — imported as module so db_engine is always current

# Re-export key names for backward compatibility (used by tests and startup hooks)
from database import (  # noqa: E402
    connect_to_database,
    warmup_system,
    DATABASE_URL,
    db_engine,
)
from utils import IMAGE_BASE, generate_slug  # noqa: E402

# File paths
IMAGES_DIR = os.path.join(BASE_DIR, "images")

# Create FastAPI app focused on pill identification
app = FastAPI(
    title="Pill Identifier API",
    description="API for identifying pills and medications",
    version="2.0.0",
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.getenv(
            "ALLOWED_ORIGINS",
            "https://pill0project.onrender.com,https://pill-project.vercel.app,https://pillseek.com,https://www.pillseek.com",
        ).split(",")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create image folder if it doesn't exist (for caching)
image_dir = Path("images")
if not image_dir.exists():
    image_dir.mkdir(parents=True)
    logger.info(f"Created image directory: images")

# Mount the images directory for local access (kept for backward compatibility)
try:
    app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")
    logger.info(f"Successfully mounted /images directory from {IMAGES_DIR}")
except Exception as e:
    logger.error(f"Error mounting images directory: {e}")

# Include all route modules
from routes import search, details, filters, ndc, sitemap, health, similar  # noqa: E402
from routes import pill_images  # noqa: E402
from routes.admin import pills as admin_pills, drafts as admin_drafts, images as admin_images  # noqa: E402
from routes.admin import audit as admin_audit, users as admin_users, stats as admin_stats  # noqa: E402
from routes.admin import duplicates as admin_duplicates  # noqa: E402
from routes.admin import backfill as admin_backfill  # noqa: E402

app.include_router(search.router)
app.include_router(details.router)
app.include_router(filters.router)
app.include_router(ndc.router)
app.include_router(sitemap.router)
app.include_router(health.router)
app.include_router(similar.router)
app.include_router(pill_images.router)
app.include_router(admin_pills.router)
app.include_router(admin_drafts.router)
app.include_router(admin_images.router)
app.include_router(admin_audit.router)
app.include_router(admin_users.router)
app.include_router(admin_stats.router)
app.include_router(admin_duplicates.router)
app.include_router(admin_backfill.router)


def regenerate_slugs():
    """One-time update: regenerate all slug values in the DB using medicine_name + spl_strength."""
    from typing import Dict

    if not database.db_engine:
        return
    try:
        with database.db_engine.connect() as conn:
            rows = conn.execute(
                text("SELECT id, medicine_name, spl_strength, splimprint, slug FROM pillfinder")
            ).fetchall()

        updates = []
        seen_slugs: Dict[str, int] = {}

        for row in rows:
            row_id, medicine_name, spl_strength, splimprint, existing_slug = row
            new_slug = generate_slug(medicine_name or "", spl_strength or "")

            base_slug = new_slug
            counter = 1
            while new_slug in seen_slugs and seen_slugs[new_slug] != row_id:
                new_slug = f"{base_slug}-{counter}"
                counter += 1
            seen_slugs[new_slug] = row_id

            if existing_slug != new_slug:
                updates.append({"new_slug": new_slug, "row_id": row_id})

        if updates:
            with database.db_engine.connect() as conn:
                for upd in updates:
                    conn.execute(
                        text(
                            "UPDATE pillfinder SET slug = :new_slug"
                            " WHERE id = :row_id"
                            "   AND (slug IS DISTINCT FROM :new_slug)"
                        ),
                        upd,
                    )
                conn.commit()
            logger.info(f"regenerate_slugs: updated {len(updates)} slug(s) to strength-based format")
        else:
            logger.info("regenerate_slugs: all slugs already up-to-date")
    except Exception as e:
        logger.error(f"regenerate_slugs failed: {e}", exc_info=True)


@app.on_event("startup")
async def startup_event():
    """Run tasks when the application starts"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, warmup_system)
    await loop.run_in_executor(None, regenerate_slugs)
    logger.info("Pill identification system initialized successfully")


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


@app.get("/__routes__")
async def list_routes():
    """Return all the paths FastAPI knows about"""
    return sorted(route.path for route in app.router.routes)


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting server on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
