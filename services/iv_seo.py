"""Meta title and description for an IV drug page, generated the way pill pages get theirs.

Used as the suggestion in the admin (an editor's own text always wins) and as the page's fallback.
"""

from __future__ import annotations

from typing import Any, Mapping

TITLE_MAX = 65
DESCRIPTION_MAX = 160


def _brands(row: Mapping[str, Any], limit: int) -> list:
    name = str(row.get("generic_name") or "").lower()
    return [b for b in (row.get("brand_names") or []) if b and b.lower() != name][:limit]


def build_meta_title(row: Mapping[str, Any]) -> str:
    """'Vancomycin IV (Vancocin): Infusion Rate, Mixing & FDA Label', shortened until it fits a search result."""
    name = str(row.get("generic_name") or "").strip()
    if not name:
        return ""
    brand = _brands(row, 1)
    head = f"{name} IV ({brand[0]})" if brand else f"{name} IV"
    for tail in (": Infusion Rate, Mixing & FDA Label", ": Infusion, Mixing & Label", " Injection: FDA Label", ""):
        for start in (head, f"{name} IV"):
            if len(start + tail) <= TITLE_MAX:
                return start + tail
    return f"{name} IV"[:TITLE_MAX]


def build_meta_description(row: Mapping[str, Any]) -> str:
    name = str(row.get("generic_name") or "").strip()
    if not name:
        return ""
    brands = _brands(row, 2)
    known_as = f" ({', '.join(brands)})" if brands else ""
    makers = int(row.get("maker_count") or 0)
    supply = f" Strengths from {makers} manufacturers," if makers > 1 else " All strengths,"
    text = (
        f"{name}{known_as} IV: infusion rate, mixing and storage from the FDA label."
        f"{supply} recalls, dosage, side effects."
    )
    if len(text) <= DESCRIPTION_MAX:
        return text
    return f"{name} IV: how it is given, infusion rate, mixing and storage from the FDA label, plus dosage and side effects."[:DESCRIPTION_MAX]
