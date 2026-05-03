"""Condition slug normalization helpers.

Slug rules (must match frontend condition-utils.ts):
  - Strip leading/trailing whitespace
  - Lowercase
  - Apostrophes stripped (NOT replaced with hyphen)
  - Runs of whitespace → single hyphen
  - Examples:
      "heart attack"       → "heart-attack"
      "parkinson's disease"→ "parkinsons-disease"
      "adhd"               → "adhd"
"""

import re

from services.condition_tags import CONDITION_KEYWORDS

# Pre-built forward and reverse lookup tables generated once at import time.
_SLUG_TO_TAG: dict[str, str] = {}
_TAG_TO_SLUG: dict[str, str] = {}


def slug_from_tag(tag: str) -> str:
    """Return the URL slug for a canonical condition tag string."""
    return re.sub(r"\s+", "-", tag.strip().lower().replace("'", ""))


def tag_from_slug(slug: str) -> str | None:
    """Return the canonical tag string for a given slug, or None if not found."""
    return _SLUG_TO_TAG.get(slug)


# ---------------------------------------------------------------------------
# Build lookup tables at module load time.
# ---------------------------------------------------------------------------
for _tag in CONDITION_KEYWORDS:
    _s = slug_from_tag(_tag)
    _TAG_TO_SLUG[_tag] = _s
    _SLUG_TO_TAG[_s] = _tag

__all__ = ["slug_from_tag", "tag_from_slug"]
