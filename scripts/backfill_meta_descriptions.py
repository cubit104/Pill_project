"""
Backfill meta_description for all pillfinder rows where it is NULL or empty.
Run once: python scripts/backfill_meta_descriptions.py
"""

import sys
import os

# Allow the script to be run from any directory
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import database
from sqlalchemy import text
from utils import normalize_text

MAX_LEN = 155
BATCH_SIZE = 1000


def build_meta_description(row: dict) -> str:
    """Mirror the frontend buildIdentificationSummary logic.

    Fields are normalized the same way normalize_fields() does before the API
    serves them, so the stored text matches what the frontend would generate.
    """
    color = normalize_text((row.get("splcolor_text") or "")).strip()
    shape = normalize_text((row.get("splshape_text") or "")).strip()
    imprint = (row.get("splimprint") or "").strip()
    drug_name = normalize_text((row.get("medicine_name") or "")).strip()
    strength = normalize_text((row.get("spl_strength") or "")).strip()
    manufacturer = (row.get("author") or "").strip()
    dosage_form = normalize_text((row.get("dosage_form") or "")).strip()
    ndc = (row.get("ndc11") or "").strip()

    physical = " ".join(filter(None, [color, shape]))
    article = "an" if physical and physical[0].lower() in "aeiou" else "a"

    s1_base = f"This is {article} {physical} pill" if physical else "This pill"
    s1_imprint = f" with imprint {imprint}" if imprint else ""
    s1_drug = (
        f", identified as {drug_name}{' ' + strength if strength else ''}"
        if drug_name and drug_name != "Unknown"
        else ""
    )
    s1_mfr = f" manufactured by {manufacturer}" if manufacturer else ""
    sentence1 = f"{s1_base}{s1_imprint}{s1_drug}{s1_mfr}."

    s2_parts = []
    if dosage_form:
        s2_parts.append(f"supplied as {dosage_form}")
    if ndc:
        s2_parts.append(f"distributed under NDC {ndc}")
    sentence2 = f"It is {' and '.join(s2_parts)}." if s2_parts else ""

    full = " ".join(filter(None, [sentence1, sentence2]))

    if len(full) > MAX_LEN:
        truncated = full[:MAX_LEN].rsplit(" ", 1)[0]
        return truncated + "..."
    return full


def backfill():
    if not database.db_engine:
        if not database.connect_to_database():
            print("ERROR: Could not connect to database")
            return

    offset = 0
    total_updated = 0

    while True:
        # Use OFFSET-based pagination (id is UUID, not integer — can't use id > last_id)
        with database.db_engine.connect() as read_conn:
            rows = read_conn.execute(
                text("""
                    SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                           spl_strength, author, dosage_form, ndc11
                    FROM pillfinder
                    WHERE (meta_description IS NULL OR TRIM(meta_description) = '')
                    ORDER BY id
                    LIMIT :batch_size OFFSET :offset
                """),
                {"batch_size": BATCH_SIZE, "offset": offset},
            ).fetchall()

        if not rows:
            break

        updates = []
        for row in rows:
            row_dict = {
                "id": row[0],
                "medicine_name": row[1],
                "splimprint": row[2],
                "splcolor_text": row[3],
                "splshape_text": row[4],
                "spl_strength": row[5],
                "author": row[6],
                "dosage_form": row[7],
                "ndc11": row[8],
            }
            desc = build_meta_description(row_dict)
            updates.append({"id": row_dict["id"], "desc": desc})

        # Use engine.begin() for a clean, auto-committing write transaction.
        # The WHERE predicate makes re-runs safe: intentionally set values are
        # never overwritten.
        with database.db_engine.begin() as write_conn:
            write_conn.execute(
                text(
                    "UPDATE pillfinder SET meta_description = :desc "
                    "WHERE id = :id "
                    "AND (meta_description IS NULL OR TRIM(meta_description) = '')"
                ),
                updates,
            )

        total_updated += len(updates)
        offset += len(rows)

        print(f"  ... processed {total_updated} rows so far")

        if len(rows) < BATCH_SIZE:
            break

    print(f"✅ Updated {total_updated} rows with meta_description")


if __name__ == "__main__":
    backfill()
