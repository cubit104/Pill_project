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

MAX_LEN = 155


def build_meta_description(row: dict) -> str:
    """Mirror the frontend buildIdentificationSummary logic."""
    color = (row.get("splcolor_text") or "").strip()
    shape = (row.get("splshape_text") or "").strip()
    imprint = (row.get("splimprint") or "").strip()
    drug_name = (row.get("medicine_name") or "").strip()
    strength = (row.get("spl_strength") or "").strip()
    manufacturer = (row.get("author") or "").strip()
    dosage_form = (row.get("dosage_form") or "").strip()
    ndc = (row.get("ndc11") or "").strip()

    physical = " ".join(filter(None, [color, shape]))
    article = "an" if physical and physical[0].lower() in "aeiou" else "a"

    s1_base = f"This is {article} {physical} pill" if physical else "This pill"
    s1_imprint = f" with imprint {imprint}" if imprint else ""
    s1_drug = (
        f", identified as {drug_name}{' ' + strength if strength else ''}"
        if drug_name and drug_name.lower() != "unknown"
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

    with database.db_engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT id, medicine_name, splimprint, splcolor_text, splshape_text,
                       spl_strength, author, dosage_form, ndc11
                FROM pillfinder
                WHERE meta_description IS NULL OR TRIM(meta_description) = ''
            """)
        ).fetchall()

        print(f"Found {len(rows)} rows missing meta_description")
        if not rows:
            return

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

        with conn.begin():
            conn.execute(
                text("UPDATE pillfinder SET meta_description = :desc WHERE id = :id"),
                updates,
            )
        print(f"✅ Updated {len(updates)} rows with meta_description")


if __name__ == "__main__":
    backfill()
