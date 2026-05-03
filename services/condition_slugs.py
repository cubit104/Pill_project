"""Condition slug normalization helpers.

Slug rules (must match frontend condition-utils.ts):
  - Lowercase
  - Spaces → hyphens
  - Apostrophes stripped (NOT replaced with hyphen)
  - Examples:
      "heart attack"       → "heart-attack"
      "parkinson's disease"→ "parkinsons-disease"
      "adhd"               → "adhd"
"""

from services.condition_tags import CONDITION_KEYWORDS

# Pre-built forward and reverse lookup tables generated once at import time.
_SLUG_TO_TAG: dict[str, str] = {}
_TAG_TO_SLUG: dict[str, str] = {}


def slug_from_tag(tag: str) -> str:
    """Return the URL slug for a canonical condition tag string."""
    return (
        tag.lower()
        .replace("'", "")   # strip apostrophes before hyphenating
        .replace(" ", "-")
    )


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
