"""Condition tag extraction service.

Extracts medical condition tags from drug indication plain_text using
word-boundary keyword matching, then populates the drug_condition_tags table.

Functions
---------
extract_tags(plain_text: str) -> list[str]
    Returns list of matching tag names for a given plain_text (case-insensitive,
    word-boundary aware to avoid false positives like 'clot' in 'Clotrimazole').

backfill_condition_tags(conn) -> dict
    Reads drug_indications, extracts tags, upserts into drug_condition_tags and
    removes stale tags that no longer match.
    Returns {"processed": N, "tagged": N, "skipped": N}.

Note: Only drug_indications rows with a non-null rxcui are processed, since tags
are keyed by rxcui.  Pills backed solely by openFDA drug_name_key rows (no rxcui)
will not receive condition tags.
"""

import logging
import re
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Maps a tag name to phrases to search for in plain_text (case-insensitive,
# matched as whole words/phrases via \b word-boundary anchors to avoid false
# positives such as "clot" matching "Clotrimazole" or "renal" matching "adrenal").
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

# Pre-compile word-boundary patterns for all phrases (keyed by phrase string)
_PHRASE_PATTERNS: dict[str, re.Pattern] = {
    phrase: re.compile(r"\b" + re.escape(phrase) + r"\b")
    for phrases in CONDITION_KEYWORDS.values()
    for phrase in phrases
}


def extract_tags(plain_text: str) -> list[str]:
    """Return list of matching condition tag names for a given plain_text.

    Uses word-boundary regex matching (case-insensitive) to avoid false
    positives from substrings (e.g. 'clot' will not match 'Clotrimazole',
    'renal' will not match 'adrenal').
    """
    if not plain_text:
        return []
    lowered = plain_text.lower()
    matched: list[str] = []
    for tag, phrases in CONDITION_KEYWORDS.items():
        for phrase in phrases:
            if _PHRASE_PATTERNS[phrase].search(lowered):
                matched.append(tag)
                break
    return matched


def backfill_condition_tags(conn) -> dict:
    """Read all drug_indications rows with plain_text, extract tags, and sync
    drug_condition_tags so that stale tags are removed and new ones are added.

    For each processed rxcui:
    - Extracts the current tag set from plain_text.
    - Deletes any existing drug_condition_tags rows whose tag is no longer in
      the current set (removes stale tags when plain_text changes).
    - Inserts new tags with ON CONFLICT DO NOTHING.

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

        # Remove stale tags that are no longer in the current tag set
        if tags:
            conn.execute(
                text(
                    """
                    DELETE FROM drug_condition_tags
                    WHERE rxcui = :rxcui AND tag != ALL(:tags)
                    """
                ),
                {"rxcui": rxcui, "tags": tags},
            )
        else:
            # No tags matched — remove all existing tags for this rxcui
            conn.execute(
                text("DELETE FROM drug_condition_tags WHERE rxcui = :rxcui"),
                {"rxcui": rxcui},
            )
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
        tagged += 1
        logger.debug("Tagged rxcui=%s (%s): %s", rxcui, medicine_name, tags)

    conn.commit()
    return {"processed": processed, "tagged": tagged, "skipped": skipped}

