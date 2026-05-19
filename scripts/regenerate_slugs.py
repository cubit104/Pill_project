"""Regenerate strength-based slugs for pillfinder rows."""

from __future__ import annotations

import logging
import time
from typing import Callable

from sqlalchemy import text

import database
from utils import generate_slug

logger = logging.getLogger(__name__)


def _ensure_engine(engine=None):
    if engine is not None:
        return engine
    if database.db_engine or database.connect_to_database():
        return database.db_engine
    raise RuntimeError("Database connection not available")


# connection scoped to function body.
def regenerate_slugs(*, engine=None, slug_builder: Callable[[str, str], str] = generate_slug) -> dict[str, float | int]:
    started_at = time.perf_counter()
    db = _ensure_engine(engine)
    with db.begin() as conn:
        rows = conn.execute(
            text("SELECT id, medicine_name, spl_strength, slug FROM pillfinder")
        ).fetchall()

        updates: list[dict[str, str | int]] = []
        seen_slugs: dict[str, int] = {}
        skipped = 0

        for row_id, medicine_name, spl_strength, existing_slug in rows:
            new_slug = slug_builder(medicine_name or "", spl_strength or "")
            base_slug = new_slug
            counter = 1
            while new_slug in seen_slugs and seen_slugs[new_slug] != row_id:
                new_slug = f"{base_slug}-{counter}"
                counter += 1
            seen_slugs[new_slug] = row_id

            if existing_slug == new_slug:
                skipped += 1
                continue
            updates.append({"new_slug": new_slug, "row_id": row_id})

        if updates:
            conn.execute(
                text(
                    "UPDATE pillfinder SET slug = :new_slug"
                    " WHERE id = :row_id"
                    "   AND (slug IS DISTINCT FROM :new_slug)"
                ),
                updates,
            )

    scanned = len(rows)
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
    result = {
        "scanned": scanned,
        "updated": len(updates),
        "skipped": skipped,
        "elapsed_ms": elapsed_ms,
    }
    logger.info(
        "regenerate_slugs: scanned %s rows, updated %s, skipped %s, elapsed %sms",
        scanned,
        len(updates),
        skipped,
        elapsed_ms,
    )
    return result


def main() -> None:
    regenerate_slugs()


if __name__ == "__main__":
    main()
