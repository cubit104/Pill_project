"""Condition tag extraction service.

Extracts medical condition tags from drug indication plain_text using
simple keyword matching, then populates the drug_condition_tags table.

Functions
---------
extract_tags(plain_text: str) -> list[str]
    Returns list of matching tag names for a given plain_text (case-insensitive).

backfill_condition_tags(conn) -> dict
    Reads drug_indications, extracts tags, upserts into drug_condition_tags.
    Returns {"processed": N, "tagged": N, "skipped": N}.
"""

import logging
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Maps a tag name to phrases to search for in plain_text (case-insensitive)
CONDITION_KEYWORDS: dict[str, list[str]] = {
    "heart attack": ["heart attack", "myocardial infarction"],
    "stroke": ["stroke"],
    "blood pressure": ["high blood pressure", "hypertension"],
    "diabetes": ["diabetes", "blood sugar", "blood glucose"],
    "pain": ["pain relief", "pain", "analgesic"],
    "infection": ["bacterial infection", "antibiotic", "infection"],
    "cholesterol": ["high cholesterol", "ldl", "cholesterol"],
    "anxiety": ["anxiety", "anxiolytic"],
    "depression": ["depression", "antidepressant"],
    "seizure": ["seizure", "epilepsy", "anticonvulsant"],
    "blood clot": ["blood clot", "clot", "thrombosis", "anticoagulant", "antiplatelet"],
    "acid reflux": ["acid reflux", "heartburn", "gerd", "stomach acid"],
    "allergy": ["allergy", "allergic", "antihistamine"],
    "asthma": ["asthma", "bronchospasm", "inhaler"],
    "thyroid": ["thyroid", "hypothyroid", "hyperthyroid"],
    "kidney": ["kidney", "renal"],
    "osteoporosis": ["osteoporosis", "bone loss"],
    "arthritis": ["arthritis", "rheumatoid", "anti-inflammatory", "nsaid"],
    "nausea": ["nausea", "vomiting", "antiemetic"],
    "sleep": ["insomnia", "sleep", "sedative"],
    "adhd": ["adhd", "attention deficit", "hyperactivity"],
    "bipolar": ["bipolar", "manic"],
    "schizophrenia": ["schizophrenia", "antipsychotic", "psychosis"],
    "parkinson": ["parkinson"],
    "alzheimer": ["alzheimer", "dementia"],
    "hiv": ["hiv", "antiretroviral"],
    "hepatitis": ["hepatitis"],
    "malaria": ["malaria"],
    "fungal infection": ["fungal", "antifungal", "yeast infection"],
    "viral infection": ["viral", "antiviral"],
}


def extract_tags(plain_text: str) -> list[str]:
    """Return list of matching condition tag names for a given plain_text.

    Performs case-insensitive substring matching against CONDITION_KEYWORDS.
    """
    if not plain_text:
        return []
    lowered = plain_text.lower()
    matched: list[str] = []
    for tag, phrases in CONDITION_KEYWORDS.items():
        for phrase in phrases:
            if phrase in lowered:
                matched.append(tag)
                break
    return matched


def backfill_condition_tags(conn) -> dict:
    """Read all drug_indications rows with plain_text, extract tags, upsert into
    drug_condition_tags.

    Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.

    Returns
    -------
    dict with keys "processed", "tagged", "skipped"
    """
    rows = conn.execute(
        text(
            """
            SELECT di.rxcui, p.medicine_name, di.plain_text
            FROM drug_indications di
            JOIN pillfinder p ON p.rxcui = di.rxcui
            WHERE di.plain_text IS NOT NULL AND di.rxcui IS NOT NULL
              AND p.deleted_at IS NULL
            """
        )
    ).fetchall()

    processed = 0
    tagged = 0
    skipped = 0

    seen_rxcui: set[str] = set()

    for row in rows:
        rxcui = str(row[0]).strip()
        medicine_name = (row[1] or "").lower()
        plain_text = row[2] or ""

        # Process each rxcui only once (multiple pillfinder rows may share it)
        if rxcui in seen_rxcui:
            skipped += 1
            continue
        seen_rxcui.add(rxcui)

        processed += 1
        tags = extract_tags(plain_text)

        if not tags:
            continue

        for tag in tags:
            conn.execute(
                text(
                    """
                    INSERT INTO drug_condition_tags (rxcui, drug_name, tag)
                    VALUES (:rxcui, :drug_name, :tag)
                    ON CONFLICT (rxcui, tag) DO NOTHING
                    """
                ),
                {"rxcui": rxcui, "drug_name": medicine_name, "tag": tag},
            )
        conn.commit()
        tagged += 1
        logger.debug("Tagged rxcui=%s (%s): %s", rxcui, medicine_name, tags)

    return {"processed": processed, "tagged": tagged, "skipped": skipped}
