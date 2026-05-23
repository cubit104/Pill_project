import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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
from scripts.regenerate_slugs import regenerate_slugs as run_regenerate_slugs  # noqa: E402
from services.pricing_service import pricing_service  # noqa: E402
from utils import IMAGE_BASE, generate_slug  # noqa: E402

# File paths
IMAGES_DIR = os.path.join(BASE_DIR, "images")


def _env_truthy(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan that bounds startup/shutdown resource lifecycles."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, warmup_system)
    try:
        pill_views_status = await loop.run_in_executor(None, pill_views.get_pill_views_table_status)
        if not pill_views_status["pill_views_table_exists"]:
            logger.error(
                "pill_views table is missing — run supabase migration 20260522010000_create_pill_views.sql"
            )
    except Exception as exc:
        logger.warning("Unable to verify pill_views table at startup: %s", exc, exc_info=True)
    if _env_truthy("RUN_SLUG_REGEN_ON_STARTUP"):
        await loop.run_in_executor(None, regenerate_slugs)
    logger.info("Pill identification system initialized successfully")
    try:
        yield
    finally:
        await pricing_service.close()
        if getattr(database.db_engine, "dispose", None):
            database.db_engine.dispose()


# Create FastAPI app focused on pill identification
app = FastAPI(
    title="Pill Identifier API",
    description="API for identifying pills and medications",
    version="2.0.0",
    redirect_slashes=False,
    lifespan=lifespan,
)

# Enable CORS
# ALLOWED_ORIGINS_REGEX extends the static list with a regex pattern (e.g. for
# Vercel preview deployments like https://pill-project-git-*.vercel.app).
# Defaults to the standard Vercel git-branch preview URL pattern.
_allowed_origins = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "https://pill0project.onrender.com,https://pill-project.vercel.app,https://pillseek.com,https://www.pillseek.com",
    ).split(",")
    if o.strip()
]
_allow_origin_regex = os.getenv(
    "ALLOWED_ORIGINS_REGEX",
    r"https://pill-project-git-[a-z0-9\-]+\.vercel\.app",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allow_origin_regex,
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
from routes import search, details, filters, ndc, sitemap, health, similar, prices, trending, snapshot  # noqa: E402
from routes import pill_images, conditions, medication_guide, pill_views  # noqa: E402
from routes.admin import pills as admin_pills, drafts as admin_drafts, images as admin_images  # noqa: E402
from routes.admin import audit as admin_audit, users as admin_users, stats as admin_stats  # noqa: E402
from routes.admin import duplicates as admin_duplicates  # noqa: E402
from routes.admin import backfill as admin_backfill  # noqa: E402
from routes.admin import analytics as admin_analytics  # noqa: E402
from routes.admin import posthog as admin_posthog  # noqa: E402
from routes.admin import medication_guide_backfill as admin_medication_guide_backfill  # noqa: E402

app.include_router(search.router)
app.include_router(details.router)
app.include_router(filters.router)
app.include_router(ndc.router)
app.include_router(sitemap.router)
app.include_router(health.router)
app.include_router(similar.router)
app.include_router(prices.router)
app.include_router(snapshot.router)
app.include_router(trending.router)
app.include_router(medication_guide.router)
app.include_router(pill_views.router)
app.include_router(pill_images.router)
app.include_router(conditions.router)
app.include_router(admin_pills.router)
app.include_router(admin_drafts.router)
app.include_router(admin_images.router)
app.include_router(admin_audit.router)
app.include_router(admin_users.router)
app.include_router(admin_stats.router)
app.include_router(admin_duplicates.router)
app.include_router(admin_backfill.router)
app.include_router(admin_backfill.clinical_router)
app.include_router(admin_backfill.nadac_history_router)
app.include_router(admin_analytics.router)
app.include_router(admin_posthog.router)
app.include_router(admin_medication_guide_backfill.router)


def regenerate_slugs():
    """Regenerate slug values using medicine_name + spl_strength."""
    return run_regenerate_slugs(engine=database.db_engine, slug_builder=generate_slug)


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
