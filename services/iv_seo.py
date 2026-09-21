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


def _is_intravenous(row: Mapping[str, Any]) -> bool:
    """No routes on file counts as IV: every imported drug has them, and IV is what this section began as."""
    routes = row.get("routes") or []
    return not routes or any("intravenous" in str(r).lower() for r in routes)


def build_meta_title(row: Mapping[str, Any]) -> str:
    """'Norepinephrine IV (Levophed): Infusion Rate, Mixing & Calculator', shortened until it fits a search result.

    Names what the page really has and what a nurse types; "uses, side effects, price" would promise sections the page
    does not have. The brand name is kept before a longer tail: people search the brand ("levophed drip rate").
    """
    name = str(row.get("generic_name") or "").strip()
    if not name:
        return ""
    brand = _brands(row, 1)
    kind = "IV" if _is_intravenous(row) else "Injection"
    starts = ([f"{name} {kind} ({brand[0]})"] if brand else []) + [f"{name} {kind}"]
    tails = (": Infusion Rate, Mixing, Calculator & Shortage", ": Infusion Rate, Mixing & Calculator", ": Infusion Rate & Mixing")
    if kind == "Injection":
        tails = (": How It Is Given, Mixing, Storage & Shortage", ": How It Is Given, Mixing & Storage", ": Mixing & Storage")
    for start in starts:
        for tail in tails:
            if len(start + tail) <= TITLE_MAX:
                return start + tail
    return f"{name} {kind}"[:TITLE_MAX]


def build_meta_description(row: Mapping[str, Any]) -> str:
    name = str(row.get("generic_name") or "").strip()
    if not name:
        return ""
    brands = _brands(row, 2)
    known_as = f" ({', '.join(brands)})" if brands else ""
    makers = int(row.get("maker_count") or 0)
    supply = f" Strengths from {makers} manufacturers" if makers > 1 else " All strengths"
    if not _is_intravenous(row):
        for who in (f"{name}{known_as}", name):
            text = f"{who} injection: how it is given, mixing and storage, current shortage status.{supply} and recalls."
            if len(text) <= DESCRIPTION_MAX:
                return text
        return f"{name} injection: how it is given, mixing and storage, shortage status and recalls."[:DESCRIPTION_MAX]
    for who in (f"{name}{known_as}", name):
        text = f"{who} IV: infusion rate, mixing and storage, drip rate calculator, current shortage status.{supply} and recalls."
        if len(text) <= DESCRIPTION_MAX:
            return text
    return f"{name} IV: infusion rate, mixing and storage, drip rate calculator, shortage status and recalls."[:DESCRIPTION_MAX]
