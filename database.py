"""Database engine lifecycle for the API.

Render workers × (pool_size + max_overflow) must stay well below Supabase
pooler's max_client_conn (200 on Micro compute). With defaults (5+2)×2 workers
= 14, leaving headroom for admin tools and migrations.
"""

import logging
import os
import time

from sqlalchemy import create_engine, text

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

def _env_int(name: str, default: str) -> int:
    return int(os.getenv(name, default))


def _env_bool(name: str) -> bool:
    return os.getenv(name, "").lower() in {"1", "true", "yes"}


def _create_db_engine():
    return create_engine(
        DATABASE_URL,
        pool_size=_env_int("DB_POOL_SIZE", "5"),
        max_overflow=_env_int("DB_MAX_OVERFLOW", "2"),
        pool_recycle=_env_int("DB_POOL_RECYCLE", "300"),
        pool_timeout=_env_int("DB_POOL_TIMEOUT", "10"),
        pool_pre_ping=True,
        echo_pool=_env_bool("DB_ECHO_POOL"),
    )


db_engine = _create_db_engine()
ndc_handler = None
_common_drug_cache: dict = {}
_missing_files_log: set = set()


def initialize_ndc_handler():
    """Initialize the NDC handler with the CSV files"""
    global ndc_handler
    try:
        BASE_DIR = os.path.dirname(os.path.abspath(__file__))
        drugs_csv = os.path.join(BASE_DIR, "drugs.csv")
        ndc_csv = os.path.join(BASE_DIR, "ndc_relationships.csv")

        if os.path.exists(drugs_csv) and os.path.exists(ndc_csv):
            from ndc_module import NDCHandler
            ndc_handler = NDCHandler(drugs_csv, ndc_csv)
            logger.info("NDC handler initialized successfully")
            return True
        else:
            logger.warning("NDC CSV files not found. NDC functionality will be limited.")
            ndc_handler = None
            return False
    except Exception as e:
        logger.error(f"Error initializing NDC handler: {e}")
        ndc_handler = None
        return False


# connection scoped to function body.
def connect_to_database():
    """Connect to Supabase PostgreSQL database with connection pooling"""
    global db_engine
    try:
        if db_engine is None:
            db_engine = _create_db_engine()
        logger.info("Connecting to Supabase PostgreSQL database...")
        with db_engine.connect() as conn:
            result = conn.execute(text("SELECT COUNT(*) FROM pillfinder"))
            count = result.scalar()
            logger.info(f"Connected to database successfully. Found {count} records in pillfinder table.")

        initialize_ndc_handler()
        return True
    except Exception as e:
        logger.error(f"Error connecting to database: {e}")
        return False


# connection scoped to function body.
def warmup_system():
    """Pre-warm the system to avoid slow initial requests"""
    global _common_drug_cache

    from utils import normalize_name

    logger.info("Starting system warm-up...")
    start_time = time.time()

    if not db_engine and not connect_to_database():
        logger.error("Failed to connect to database during warmup")
        return

    try:
        with db_engine.connect() as conn:
            common_drugs_query = text("""
                SELECT DISTINCT medicine_name FROM pillfinder
                ORDER BY medicine_name
                LIMIT 50
            """)
            common_drugs = conn.execute(common_drugs_query).fetchall()
            for drug in common_drugs:
                drug_name = drug[0] if drug[0] else ""
                _common_drug_cache[drug_name.lower()] = drug_name
                normalize_name(drug_name)

        elapsed = time.time() - start_time
        logger.info(f"System warm-up complete in {elapsed:.2f} seconds")
    except Exception as e:
        logger.error(f"Error during system warm-up: {e}")
