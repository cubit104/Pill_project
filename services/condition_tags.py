"""Condition tag extraction service — sentence-level treatment-intent matching.

A tag is applied ONLY when both conditions hold in the same sentence:
  1. The sentence contains a treatment-intent anchor phrase
     (e.g. "used to treat", "indicated for", "reduce the risk of").
  2. The sentence contains a condition keyword (whole-word/phrase match).

This prevents false positives from side-effect warnings, contraindications,
and incidental mentions (e.g. "monitor kidney function" won't tag 'kidney disease';
"may cause insomnia" won't tag 'insomnia'; "chest pain" won't tag 'pain').

Functions
---------
extract_tags(plain_text: str) -> list[str]
    Returns list of matching tag names (case-insensitive, sentence-scoped).

backfill_condition_tags(conn) -> dict
    Syncs drug_condition_tags for all rxcuis that have plain_text in
    drug_indications. For each rxcui, extracts the current tag set, deletes
    any stale tags no longer in the current set (or all tags when none match),
    then inserts new tags with ON CONFLICT DO NOTHING.
    Returns {"processed": N, "tagged": N, "skipped": N}.
"""

import logging
import re
from sqlalchemy import text

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Treatment-intent anchor pattern
# Matches sentences that describe what the drug TREATS or PREVENTS.
# Applied per-sentence before checking condition keywords.
# ---------------------------------------------------------------------------
_INTENT_PATTERN = re.compile(
    r'\b('
    r'used to (?:treat|prevent|reduce|manage|lower|control)|'
    r'indicated (?:for|to)\b|'
    r'\btreatment of\b|'
    r'\bprevention of\b|'
    r'\bmanagement of\b|'
    r'reduces? (?:the )?risk of|'
    r'help(?:s)? (?:treat|prevent|manage|control|lower|reduce)|'
    r'prescribed (?:for|to)|'
    r'approved (?:for|to)|'
    r'\btreats?\b|'
    r'\bprevents?\b'
    r')',
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Condition keywords: {tag: [exact_phrases]}
# Phrases are matched with \b word-boundary anchors (case-insensitive).
# Use specific multi-word phrases wherever possible to avoid over-matching.
# ---------------------------------------------------------------------------
CONDITION_KEYWORDS: dict[str, list[str]] = {
    "heart attack": [
        "heart attack",
        "myocardial infarction",
    ],
    "stroke": [
        "stroke",
    ],
    "high blood pressure": [
        "high blood pressure",
        "hypertension",
        "elevated blood pressure",
    ],
    "diabetes": [
        "type 2 diabetes",
        "type 1 diabetes",
        "diabetes mellitus",
        "diabetes",
        "blood glucose",
        "blood sugar",
    ],
    "pain": [
        "moderate to severe pain",
        "mild to moderate pain",
        "chronic pain",
        "acute pain",
        "musculoskeletal pain",
        "neuropathic pain",
        "cancer pain",
    ],
    "bacterial infection": [
        "bacterial infections",
        "bacterial infection",
        "bacterial pneumonia",
        "bacterial sinusitis",
        "bacterial meningitis",
    ],
    "high cholesterol": [
        "high cholesterol",
        "elevated cholesterol",
        "hyperlipidemia",
        "hypercholesterolemia",
        "low-density lipoprotein",
        "ldl cholesterol",
        "triglycerides",
    ],
    "anxiety": [
        "anxiety disorder",
        "generalized anxiety disorder",
        "panic disorder",
        "social anxiety disorder",
        "anxiety",
    ],
    "depression": [
        "major depressive disorder",
        "major depression",
        "depression",
    ],
    "seizures": [
        "seizures",
        "epilepsy",
        "epileptic",
    ],
    "blood clots": [
        "blood clots",
        "deep vein thrombosis",
        "pulmonary embolism",
        "thrombosis",
        "dvt",
        "clotting",
        "clot",
    ],
    "acid reflux": [
        "acid reflux",
        "gastroesophageal reflux disease",
        "gerd",
        "heartburn",
        "stomach acid",
    ],
    "allergies": [
        "seasonal allergies",
        "allergic rhinitis",
        "hay fever",
        "allergic reactions",
        "allergy",
        "allergies",
    ],
    "asthma": [
        "asthma",
        "bronchospasm",
    ],
    "thyroid disease": [
        "hypothyroidism",
        "hyperthyroidism",
        "thyroid disease",
        "thyroid disorder",
    ],
    "kidney disease": [
        "chronic kidney disease",
        "kidney disease",
        "renal failure",
        "renal disease",
        "end-stage renal disease",
    ],
    "osteoporosis": [
        "osteoporosis",
        "bone loss",
    ],
    "rheumatoid arthritis": [
        "rheumatoid arthritis",
    ],
    "osteoarthritis": [
        "osteoarthritis",
    ],
    "nausea": [
        "nausea and vomiting",
        "chemotherapy-induced nausea",
        "postoperative nausea",
        "nausea",
    ],
    "insomnia": [
        "insomnia",
        "sleep disorder",
        "difficulty sleeping",
    ],
    "adhd": [
        "attention deficit hyperactivity disorder",
        "adhd",
        "attention deficit disorder",
    ],
    "bipolar disorder": [
        "bipolar disorder",
        "manic episodes",
        "manic depression",
    ],
    "schizophrenia": [
        "schizophrenia",
        "schizoaffective disorder",
    ],
    "parkinson's disease": [
        "parkinson's disease",
        "parkinson disease",
        "parkinsonian symptoms",
    ],
    "alzheimer's disease": [
        "alzheimer's disease",
        "alzheimer disease",
        "dementia",
    ],
    "hiv": [
        "hiv infection",
        "human immunodeficiency virus",
        "hiv",
        "antiretroviral",
    ],
    "hepatitis": [
        "hepatitis b",
        "hepatitis c",
        "chronic hepatitis",
    ],
    "fungal infections": [
        "fungal infections",
        "yeast infections",
        "candidiasis",
        "tinea",
    ],
    "peripheral artery disease": [
        "peripheral arterial disease",
        "peripheral artery disease",
        "poor blood flow",
    ],
    "heart failure": [
        "heart failure",
        "congestive heart failure",
        "cardiac failure",
    ],
    "atrial fibrillation": [
        "atrial fibrillation",
        "irregular heartbeat",
        "abnormal heart rhythm",
        "arrhythmia",
    ],
}

# Pre-compile all condition phrase patterns once at module load.
# Key: phrase string → compiled re.Pattern (case-insensitive, word-boundary)
_CONDITION_PATTERNS: dict[str, re.Pattern] = {
    phrase: re.compile(r"\b" + re.escape(phrase) + r"\b", re.IGNORECASE)
    for phrases in CONDITION_KEYWORDS.values()
    for phrase in phrases
}


def _split_sentences(text: str) -> list[str]:
    """Split plain_text into individual sentences on '.', '!', '?' boundaries."""
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def extract_tags(plain_text: str) -> list[str]:
    """Return list of matching condition tag names for a given plain_text.

    A tag is only applied when BOTH conditions hold in the same sentence:
    1. The sentence contains a treatment-intent anchor (e.g. "used to treat").
    2. The sentence contains a condition keyword phrase.

    This prevents side-effect sentences ("may cause insomnia"),
    warning sentences ("do not take if you have kidney disease"),
    and incidental mentions from generating false-positive tags.
    """
    if not plain_text or not plain_text.strip():
        return []

    sentences = _split_sentences(plain_text)
    matched: list[str] = []

    for tag, phrases in CONDITION_KEYWORDS.items():
        for sentence in sentences:
            # Gate: only consider sentences with treatment intent
            if not _INTENT_PATTERN.search(sentence):
                continue
            # Check if any condition phrase matches in this intent sentence
            for phrase in phrases:
                if _CONDITION_PATTERNS[phrase].search(sentence):
                    matched.append(tag)
                    break  # tag matched — move to next tag
            else:
                continue
            break  # this tag is already matched, skip remaining sentences

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

