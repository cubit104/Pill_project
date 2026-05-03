"""Condition page metadata: aliases and related-condition mappings.

Rules enforced at import time:
  - Every CONDITION_ALIASES value must be a canonical slug in CONDITION_DESCRIPTIONS.
  - Every slug in RELATED_CONDITIONS (keys + values) must exist in CONDITION_DESCRIPTIONS.
"""

from services.condition_slugs import slug_from_tag

# ---------------------------------------------------------------------------
# Canonical slug set — built from CONDITION_DESCRIPTIONS at import time.
# ---------------------------------------------------------------------------
# Import lazily to avoid circular issues between data modules.
from data.condition_descriptions import CONDITION_DESCRIPTIONS

_VALID_SLUGS: frozenset[str] = frozenset(
    entry["slug"] for entry in CONDITION_DESCRIPTIONS.values()
)

# ---------------------------------------------------------------------------
# Aliases: alternative slugs that redirect to the canonical slug.
# Keys are alias slugs; values are canonical slugs.
# ---------------------------------------------------------------------------
CONDITION_ALIASES: dict[str, str] = {
    "hypertension": slug_from_tag("high blood pressure"),
    "htn": slug_from_tag("high blood pressure"),
    "high-bp": slug_from_tag("high blood pressure"),
    "type-2-diabetes": slug_from_tag("diabetes"),
    "type-1-diabetes": slug_from_tag("diabetes"),
    "type2-diabetes": slug_from_tag("diabetes"),
    "type1-diabetes": slug_from_tag("diabetes"),
    "afib": slug_from_tag("atrial fibrillation"),
    "a-fib": slug_from_tag("atrial fibrillation"),
    "gerd": slug_from_tag("acid reflux"),
    "heartburn": slug_from_tag("acid reflux"),
    "acid-reflux-disease": slug_from_tag("acid reflux"),
    "chf": slug_from_tag("heart failure"),
    "congestive-heart-failure": slug_from_tag("heart failure"),
    "adhd-add": slug_from_tag("adhd"),
    "add": slug_from_tag("adhd"),
    "parkinsons": slug_from_tag("parkinson's disease"),
    "parkinson-s-disease": slug_from_tag("parkinson's disease"),
    "alzheimers": slug_from_tag("alzheimer's disease"),
    "alzheimer-s-disease": slug_from_tag("alzheimer's disease"),
    "aids": slug_from_tag("hiv"),
    "hiv-aids": slug_from_tag("hiv"),
    "pad": slug_from_tag("peripheral artery disease"),
    "ckd": slug_from_tag("kidney disease"),
    "chronic-kidney-disease": slug_from_tag("kidney disease"),
    "ra": slug_from_tag("rheumatoid arthritis"),
    "oa": slug_from_tag("osteoarthritis"),
    "epilepsy": slug_from_tag("seizures"),
    "high-blood-cholesterol": slug_from_tag("high cholesterol"),
    "hypercholesterolemia": slug_from_tag("high cholesterol"),
    "dvt": slug_from_tag("blood clots"),
    "blood-clot": slug_from_tag("blood clots"),
    "yeast-infection": slug_from_tag("fungal infections"),
    "fungal-infection": slug_from_tag("fungal infections"),
}

# ---------------------------------------------------------------------------
# Related conditions: canonical slug → list of related canonical slugs.
# ---------------------------------------------------------------------------
RELATED_CONDITIONS: dict[str, list[str]] = {
    slug_from_tag("heart attack"): [
        slug_from_tag("high blood pressure"),
        slug_from_tag("high cholesterol"),
        slug_from_tag("diabetes"),
        slug_from_tag("heart failure"),
        slug_from_tag("atrial fibrillation"),
    ],
    slug_from_tag("stroke"): [
        slug_from_tag("high blood pressure"),
        slug_from_tag("atrial fibrillation"),
        slug_from_tag("high cholesterol"),
        slug_from_tag("diabetes"),
        slug_from_tag("blood clots"),
    ],
    slug_from_tag("high blood pressure"): [
        slug_from_tag("heart attack"),
        slug_from_tag("heart failure"),
        slug_from_tag("kidney disease"),
        slug_from_tag("stroke"),
        slug_from_tag("diabetes"),
    ],
    slug_from_tag("diabetes"): [
        slug_from_tag("high blood pressure"),
        slug_from_tag("high cholesterol"),
        slug_from_tag("kidney disease"),
        slug_from_tag("heart failure"),
    ],
    slug_from_tag("pain"): [
        slug_from_tag("osteoarthritis"),
        slug_from_tag("rheumatoid arthritis"),
        slug_from_tag("anxiety"),
        slug_from_tag("depression"),
    ],
    slug_from_tag("bacterial infection"): [
        slug_from_tag("fungal infections"),
        slug_from_tag("asthma"),
        slug_from_tag("kidney disease"),
    ],
    slug_from_tag("high cholesterol"): [
        slug_from_tag("heart attack"),
        slug_from_tag("stroke"),
        slug_from_tag("high blood pressure"),
        slug_from_tag("diabetes"),
        slug_from_tag("peripheral artery disease"),
    ],
    slug_from_tag("anxiety"): [
        slug_from_tag("depression"),
        slug_from_tag("insomnia"),
        slug_from_tag("bipolar disorder"),
        slug_from_tag("adhd"),
    ],
    slug_from_tag("depression"): [
        slug_from_tag("anxiety"),
        slug_from_tag("insomnia"),
        slug_from_tag("bipolar disorder"),
        slug_from_tag("pain"),
    ],
    slug_from_tag("seizures"): [
        slug_from_tag("bipolar disorder"),
        slug_from_tag("anxiety"),
        slug_from_tag("depression"),
    ],
    slug_from_tag("blood clots"): [
        slug_from_tag("atrial fibrillation"),
        slug_from_tag("stroke"),
        slug_from_tag("heart attack"),
        slug_from_tag("heart failure"),
    ],
    slug_from_tag("acid reflux"): [
        slug_from_tag("asthma"),
        slug_from_tag("nausea"),
    ],
    slug_from_tag("allergies"): [
        slug_from_tag("asthma"),
        slug_from_tag("nausea"),
    ],
    slug_from_tag("asthma"): [
        slug_from_tag("allergies"),
        slug_from_tag("acid reflux"),
        slug_from_tag("bacterial infection"),
    ],
    slug_from_tag("thyroid disease"): [
        slug_from_tag("atrial fibrillation"),
        slug_from_tag("osteoporosis"),
        slug_from_tag("depression"),
        slug_from_tag("anxiety"),
    ],
    slug_from_tag("kidney disease"): [
        slug_from_tag("diabetes"),
        slug_from_tag("high blood pressure"),
        slug_from_tag("heart failure"),
        slug_from_tag("blood clots"),
    ],
    slug_from_tag("osteoporosis"): [
        slug_from_tag("rheumatoid arthritis"),
        slug_from_tag("thyroid disease"),
        slug_from_tag("kidney disease"),
    ],
    slug_from_tag("rheumatoid arthritis"): [
        slug_from_tag("osteoarthritis"),
        slug_from_tag("osteoporosis"),
        slug_from_tag("pain"),
        slug_from_tag("depression"),
    ],
    slug_from_tag("osteoarthritis"): [
        slug_from_tag("rheumatoid arthritis"),
        slug_from_tag("pain"),
        slug_from_tag("osteoporosis"),
        slug_from_tag("depression"),
    ],
    slug_from_tag("nausea"): [
        slug_from_tag("acid reflux"),
        slug_from_tag("hepatitis"),
        slug_from_tag("kidney disease"),
    ],
    slug_from_tag("insomnia"): [
        slug_from_tag("anxiety"),
        slug_from_tag("depression"),
        slug_from_tag("adhd"),
        slug_from_tag("bipolar disorder"),
    ],
    slug_from_tag("adhd"): [
        slug_from_tag("anxiety"),
        slug_from_tag("depression"),
        slug_from_tag("insomnia"),
        slug_from_tag("bipolar disorder"),
    ],
    slug_from_tag("bipolar disorder"): [
        slug_from_tag("depression"),
        slug_from_tag("anxiety"),
        slug_from_tag("insomnia"),
        slug_from_tag("schizophrenia"),
    ],
    slug_from_tag("schizophrenia"): [
        slug_from_tag("bipolar disorder"),
        slug_from_tag("depression"),
        slug_from_tag("anxiety"),
    ],
    slug_from_tag("parkinson's disease"): [
        slug_from_tag("alzheimer's disease"),
        slug_from_tag("depression"),
        slug_from_tag("insomnia"),
    ],
    slug_from_tag("alzheimer's disease"): [
        slug_from_tag("parkinson's disease"),
        slug_from_tag("depression"),
        slug_from_tag("insomnia"),
        slug_from_tag("high blood pressure"),
    ],
    slug_from_tag("hiv"): [
        slug_from_tag("hepatitis"),
        slug_from_tag("fungal infections"),
        slug_from_tag("bacterial infection"),
    ],
    slug_from_tag("hepatitis"): [
        slug_from_tag("hiv"),
        slug_from_tag("kidney disease"),
        slug_from_tag("fungal infections"),
    ],
    slug_from_tag("fungal infections"): [
        slug_from_tag("bacterial infection"),
        slug_from_tag("hiv"),
        slug_from_tag("diabetes"),
    ],
    slug_from_tag("peripheral artery disease"): [
        slug_from_tag("heart attack"),
        slug_from_tag("stroke"),
        slug_from_tag("high cholesterol"),
        slug_from_tag("diabetes"),
        slug_from_tag("high blood pressure"),
    ],
    slug_from_tag("heart failure"): [
        slug_from_tag("heart attack"),
        slug_from_tag("high blood pressure"),
        slug_from_tag("atrial fibrillation"),
        slug_from_tag("kidney disease"),
        slug_from_tag("diabetes"),
    ],
    slug_from_tag("atrial fibrillation"): [
        slug_from_tag("heart failure"),
        slug_from_tag("stroke"),
        slug_from_tag("blood clots"),
        slug_from_tag("high blood pressure"),
        slug_from_tag("thyroid disease"),
    ],
}

# ---------------------------------------------------------------------------
# Startup assertions: validate referential integrity.
# ---------------------------------------------------------------------------
_bad_alias_values = [
    (alias, canonical)
    for alias, canonical in CONDITION_ALIASES.items()
    if canonical not in _VALID_SLUGS
]
assert not _bad_alias_values, (
    f"CONDITION_ALIASES has values that are not valid canonical slugs: {_bad_alias_values}"
)

for _slug, _related in RELATED_CONDITIONS.items():
    assert _slug in _VALID_SLUGS, (
        f"RELATED_CONDITIONS key {_slug!r} is not a valid canonical slug."
    )
    _bad_related = [s for s in _related if s not in _VALID_SLUGS]
    assert not _bad_related, (
        f"RELATED_CONDITIONS[{_slug!r}] contains invalid slugs: {_bad_related}"
    )
