"""HIPAA-compliant NDC normalization utilities.

FDA NDC formats (all represent the same 10 significant digits):
  4-4-2  →  labeler(4) + product(4) + package(2), pad labeler  → 5-4-2
  5-3-2  →  labeler(5) + product(3) + package(2), pad product  → 5-4-2
  5-4-1  →  labeler(5) + product(4) + package(1), pad package  → 5-4-2
  5-4-2  →  canonical 11-digit form, unchanged

Any input with exactly 11 digits and no hyphens is treated as canonical 5-4-2.
Inputs with fewer than 11 significant digits and no hyphens are ambiguous and
return None (the caller must supply the hyphenated form for disambiguation).
"""

import re
from typing import Optional


def normalize_ndc_to_11(raw: str) -> Optional[str]:
    """Convert any FDA NDC format to canonical 11-digit hyphenated 5-4-2.

    Returns None if input cannot be parsed or is ambiguous.
    """
    if not raw or not isinstance(raw, str):
        return None

    s = raw.strip()
    if not s:
        return None

    if "-" in s:
        parts = s.split("-")
        if len(parts) != 3:
            # 2-segment product_ndc (e.g. "12345-6789") — no package code, ambiguous
            return None
        if not all(p.isdigit() for p in parts):
            return None

        lens = tuple(len(p) for p in parts)

        if lens == (4, 4, 2):
            # 4-4-2 → prepend 0 to labeler
            return f"0{parts[0]}-{parts[1]}-{parts[2]}"
        if lens == (5, 3, 2):
            # 5-3-2 → prepend 0 to product
            return f"{parts[0]}-0{parts[1]}-{parts[2]}"
        if lens == (5, 4, 1):
            # 5-4-1 → prepend 0 to package
            return f"{parts[0]}-{parts[1]}-0{parts[2]}"
        if lens == (5, 4, 2):
            # Already canonical
            return f"{parts[0]}-{parts[1]}-{parts[2]}"

        # Unknown segment-length combination
        return None

    # No hyphens — strip to digits only
    digits = re.sub(r"\D", "", s)
    if len(digits) == 11:
        # Treat as canonical 5-4-2
        return f"{digits[:5]}-{digits[5:9]}-{digits[9:]}"

    # 10-digit without hyphens: ambiguous (could be 4-4-2, 5-3-2, or 5-4-1)
    return None


def ndc11_to_ndc9(ndc11: str) -> Optional[str]:
    """Extract the 9-digit labeler+product code from a canonical 11-digit NDC.

    Returns the first 9 characters of the digit-stripped NDC (labeler + product,
    no package code).  Returns None when *ndc11* is not a valid 11-digit NDC.
    """
    if not ndc11 or not isinstance(ndc11, str):
        return None
    digits = re.sub(r"\D", "", ndc11)
    if len(digits) != 11:
        return None
    return digits[:9]
