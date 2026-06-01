"""DailyMed SPL XML client — structured HTML extraction from FDA label XML.

Fetches raw SPL XML from DailyMed using the SPL Set ID and converts the
XML structure (lists, paragraphs, tables, styled content) to safe HTML
suitable for direct frontend rendering.
"""

from __future__ import annotations

import html
import logging
from typing import Optional

import bleach
import httpx
from lxml import etree

logger = logging.getLogger(__name__)

DAILYMED_SPL_XML_URL = (
    "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{spl_set_id}.xml"
)

# HL7 v3 namespace used in all SPL documents
NS = "urn:hl7-org:v3"

# Mapping of LOINC section codes → medication guide section keys.
# When multiple LOINC codes map to the same key, their HTML is concatenated
# with an <hr> separator.
LOINC_TO_SECTION: dict[str, str] = {
    "34089-3": "overview",           # Description
    "34067-9": "uses",               # Indications & Usage
    "34068-7": "dosage_administration",  # Dosage & Administration
    "43678-2": "dosage",             # Dosage Forms & Strengths (merge)
    "34076-0": "how_to_take",        # Information for Patients
    "42231-1": "how_to_take",        # SPL Medguide Section (patient-facing)
    "42230-3": "how_to_take",        # Patient Package Insert
    "34072-9": "how_to_take",        # Instructions for Use
    "34084-4": "side_effects",       # Adverse Reactions
    "34066-1": "warnings",           # Boxed Warning
    "43685-7": "warnings",           # Warnings and Cautions (merge)
    "34071-1": "warnings",           # Warnings (merge)
    "34073-7": "interactions",       # Drug Interactions
    "34070-3": "contraindications",  # Contraindications
    "43684-0": "special_populations",  # Use in Specific Populations
    "42228-7": "special_populations",  # Pregnancy
    "34080-2": "special_populations",  # Nursing Mothers/Lactation (merge)
    "34081-0": "special_populations",  # Pediatric Use (merge)
    "34082-8": "special_populations",  # Geriatric Use (merge)
    "34088-5": "overdose",           # Overdosage
    "44425-7": "storage",            # Storage & Handling
    "34069-5": "storage",            # How Supplied (merge)
    "34090-1": "pharmacology",       # Clinical Pharmacology
    "34092-7": "pharmacology",       # Pharmacokinetics (merge)
}

# LOINC code indicating a boxed (black box) warning section
_BOXED_WARNING_LOINC = "34066-1"

# Safe HTML tags allowed in output
ALLOWED_TAGS = [
    "p", "ul", "ol", "li", "strong", "em", "u", "br",
    "table", "thead", "tbody", "tr", "th", "td", "caption",
    "h3", "h4", "hr",
]

# Safe attributes allowed per tag in output
ALLOWED_ATTRS: dict[str, list[str]] = {
    "table": ["border", "cellpadding", "cellspacing"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
}


def _local(tag: str) -> str:
    """Strip namespace URI from a Clark-notation tag, e.g. {ns}foo → foo."""
    if "{" in tag:
        return tag.split("}", 1)[1]
    return tag


def _to_html(el: etree._Element) -> str:
    """Recursively convert one SPL XML element to an HTML string.

    Handles: paragraph, list, item, caption, content, br, table family,
    linkHtml (strip tag/keep text), renderMultiMedia (skip entirely).
    All text nodes are HTML-escaped. Unknown tags fall through to inner text.
    """
    tag = _local(el.tag)

    # ── Skip multimedia references entirely ───────────────────────────────
    if tag == "renderMultiMedia":
        return ""

    # ── Helper: build inner HTML of an element ────────────────────────────
    def _inner() -> str:
        parts: list[str] = []
        if el.text:
            parts.append(html.escape(el.text))
        for child in el:
            parts.append(_to_html(child))
            if child.tail:
                parts.append(html.escape(child.tail))
        return "".join(parts)

    # ── linkHtml: strip tag, keep contained text ──────────────────────────
    if tag == "linkHtml":
        return _inner()

    # ── paragraph → <p> ──────────────────────────────────────────────────
    if tag == "paragraph":
        inner = _inner()
        return f"<p>{inner}</p>" if inner.strip() else ""

    # ── list → <ul> or <ol> ──────────────────────────────────────────────
    if tag == "list":
        style = (el.get("styleCode") or "").lower()
        list_type = (el.get("listType") or "").lower()
        is_ordered = "arabic" in style or list_type == "ordered"
        wrap = "ol" if is_ordered else "ul"

        items: list[str] = []
        for child in el:
            child_tag = _local(child.tag)
            if child_tag == "caption":
                caption_inner = _caption_inner(child)
                if caption_inner.strip():
                    items.append(f"<strong>{caption_inner}</strong>")
            elif child_tag == "item":
                item_inner = _item_inner(child)
                if item_inner.strip():
                    items.append(f"<li>{item_inner}</li>")

        return f"<{wrap}>{''.join(items)}</{wrap}>" if items else ""

    # ── item → <li> (fallback for top-level item outside list) ───────────
    if tag == "item":
        inner = _item_inner(el)
        return f"<li>{inner}</li>" if inner.strip() else ""

    # ── caption → <strong> ────────────────────────────────────────────────
    if tag == "caption":
        inner = _caption_inner(el)
        return f"<strong>{inner}</strong>" if inner.strip() else ""

    # ── content with styleCode ────────────────────────────────────────────
    if tag == "content":
        style = (el.get("styleCode") or "").lower()
        inner = _inner()
        if not inner:
            return ""
        if "bold" in style:
            return f"<strong>{inner}</strong>"
        if "italics" in style or "italic" in style:
            return f"<em>{inner}</em>"
        if "underline" in style:
            return f"<u>{inner}</u>"
        return inner

    # ── line break ────────────────────────────────────────────────────────
    if tag == "br":
        return "<br>"

    # ── table elements (pass-through with safe attrs) ─────────────────────
    if tag == "table":
        inner = _inner()
        return f"<table>{inner}</table>"
    if tag in ("thead", "tbody", "tr"):
        inner = _inner()
        return f"<{tag}>{inner}</{tag}>"
    if tag in ("td", "th"):
        attrs = _safe_cell_attrs(el)
        inner = _inner()
        return f"<{tag}{attrs}>{inner}</{tag}>"

    # ── section title → <h3> ─────────────────────────────────────────────
    if tag == "title":
        inner = _inner()
        return f"<h3>{inner}</h3>" if inner.strip() else ""

    # ── Unknown / structural wrapper tags — fall through to inner HTML ────
    return _inner()


def _caption_inner(el: etree._Element) -> str:
    """Return the inner HTML of a <caption> element."""
    parts: list[str] = []
    if el.text:
        parts.append(html.escape(el.text))
    for child in el:
        parts.append(_to_html(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    return "".join(parts)


def _item_inner(el: etree._Element) -> str:
    """Return inner HTML for a list <item>, including any nested lists."""
    parts: list[str] = []
    if el.text:
        parts.append(html.escape(el.text))
    for child in el:
        parts.append(_to_html(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    return "".join(parts)


def _safe_cell_attrs(el: etree._Element) -> str:
    """Build a safe attribute string for <td>/<th> elements."""
    attrs = ""
    colspan = el.get("colspan")
    rowspan = el.get("rowspan")
    if colspan:
        attrs += f' colspan="{html.escape(colspan)}"'
    if rowspan:
        attrs += f' rowspan="{html.escape(rowspan)}"'
    return attrs


def _section_text_to_html(text_el: etree._Element) -> str:
    """Convert a section's <text> element to sanitized HTML.

    Direct text content of the <text> element is wrapped in <p>. Each child
    element is converted recursively. Tail text after child elements is also
    wrapped in <p>. The result is sanitized with bleach.
    """
    parts: list[str] = []

    if text_el.text and text_el.text.strip():
        parts.append(f"<p>{html.escape(text_el.text)}</p>")

    for child in text_el:
        child_html = _to_html(child)
        if child_html.strip():
            parts.append(child_html)
        if child.tail and child.tail.strip():
            parts.append(f"<p>{html.escape(child.tail)}</p>")

    combined = "\n".join(parts)
    return bleach.clean(combined, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)


async def fetch_spl_sections(spl_set_id: str) -> dict[str, str | bool]:
    """Fetch and parse DailyMed SPL XML, return section key → HTML string dict.

    Returns an empty dict on any failure so callers can fall back to openFDA
    plain text. The special key ``_has_boxed_warning`` is set to ``True`` when
    a boxed-warning LOINC section (34066-1) is present in the document.

    Args:
        spl_set_id: The SPL Set ID (UUID) for the drug label.

    Returns:
        A dict mapping medication guide section keys to HTML strings, or ``{}``
        on network/parse failure.
    """
    url = DAILYMED_SPL_XML_URL.format(spl_set_id=spl_set_id)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
        if resp.status_code >= 400:
            logger.debug(
                "DailyMed SPL XML HTTP %s for spl_set_id=%s",
                resp.status_code,
                spl_set_id,
            )
            return {}
        xml_bytes = resp.content
    except Exception:
        logger.warning(
            "DailyMed SPL XML fetch failed for spl_set_id=%s",
            spl_set_id,
            exc_info=True,
        )
        return {}

    try:
        root = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError:
        logger.warning("SPL XML parse error for spl_set_id=%s", spl_set_id)
        return {}

    sections: dict[str, str] = {}
    has_boxed_warning = False

    for section in root.iter(f"{{{NS}}}section"):
        code_el = section.find(f"{{{NS}}}code")
        if code_el is None:
            continue
        loinc_code = code_el.get("code")
        if not loinc_code or loinc_code not in LOINC_TO_SECTION:
            continue

        section_key = LOINC_TO_SECTION[loinc_code]
        if loinc_code == _BOXED_WARNING_LOINC:
            has_boxed_warning = True

        text_el = section.find(f"{{{NS}}}text")
        if text_el is None:
            continue

        section_html = _section_text_to_html(text_el)
        if not section_html.strip():
            continue

        if section_key in sections:
            sections[section_key] = sections[section_key] + "\n<hr>\n" + section_html
        else:
            sections[section_key] = section_html

    if has_boxed_warning:
        sections["_has_boxed_warning"] = True

    logger.info(
        "SPL sections fetched for spl_set_id=%s: %s",
        spl_set_id,
        sorted(k for k in sections if not k.startswith("_")),
    )
    return sections
