"""Service for rendering the FDA patient Medication Guide section as native semantic HTML.

Fetches SPL XML from DailyMed, isolates the patient-facing medguide ``<section>``
subtree via LOINC priority (``42231-1`` → ``42230-3`` → Section 17 fallback), then
walks the subtree to produce clean, Tailwind-styleable markup with no FDA stylesheet
link, iframe wrapper, or ``<html>`` outer frame.
"""

from __future__ import annotations

import html
import logging
import re
import unicodedata
from typing import Optional

import bleach
import httpx
from lxml import etree
from lxml import html as lxml_html

logger = logging.getLogger(__name__)

_DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{spl_set_id}.xml"

_HL7_NS = "urn:hl7-org:v3"
_NS = f"{{{_HL7_NS}}}"

_PATIENT_TITLE_KEYWORDS = (
    "medication guide",
    "patient information",
    "med guide",
    "patient package insert",
)
_PATIENT_CONTENT_KEYWORDS = (
    "medication guide",
    "patient information",
    "patient package insert",
    "important: read",
    "read this medication guide",
)
_SPL_UNCLASSIFIED_CODE = "42229-5"
_HEADING_KEYWORD_RE = re.compile(
    r"^\s*(what|who|how|when|why|where|before|after|general information about|important information about|read this medication guide)\b",
    re.IGNORECASE,
)
_DASH_ONLY_P_RE = re.compile(r"^[\s\-–—_=]{3,}$")

# Safe HTML tags allowed in output
ALLOWED_TAGS = [
    "article",
    "h1", "h2", "h3",
    "p", "ul", "ol", "li", "strong", "em", "u", "br",
    "table", "thead", "tbody", "tr", "th", "td", "caption",
    "hr",
]

# Safe attributes allowed per tag in output
ALLOWED_ATTRS: dict[str, list[str]] = {
    "h1": ["id"],
    "h2": ["id"],
    "h3": ["id"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    """Strip namespace URI from a Clark-notation tag, e.g. {ns}foo → foo."""
    if "{" in tag:
        return tag.split("}", 1)[1]
    return tag


def _slugify(text: str) -> str:
    """Convert heading text to a URL-safe id slug."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = ascii_text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    return slug or "section"


def _unique_slug(text: str, seen: dict[str, int]) -> str:
    """Return a slugified id that is unique within *seen*."""
    base = _slugify(text)
    if base not in seen:
        seen[base] = 1
        return base
    seen[base] += 1
    return f"{base}-{seen[base]}"


def _normalize_visible_text(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _is_heading_like_text(text: str) -> bool:
    normalized = _normalize_visible_text(text)
    if not normalized:
        return False
    if len(normalized) > 200:
        return False
    if len(normalized.split()) > 25:
        return False
    return normalized.endswith("?") or bool(_HEADING_KEYWORD_RE.match(normalized))


def _is_single_bold_paragraph_source(paragraph_el: etree._Element) -> bool:
    style = (paragraph_el.get("styleCode") or "").lower()
    if "bold" in style:
        return True
    children = list(paragraph_el)
    if len(children) != 1:
        return False
    child = children[0]
    if _local(child.tag) != "content":
        return False
    child_style = (child.get("styleCode") or "").lower()
    if "bold" not in child_style:
        return False
    para_text = _normalize_visible_text("".join(paragraph_el.itertext()))
    child_text = _normalize_visible_text("".join(child.itertext()))
    return bool(para_text) and para_text == child_text


def _is_single_cell_layout_table(table_el: etree._Element) -> bool:
    rows = [row for row in table_el.iter() if _local(row.tag) == "tr"]
    if len(rows) != 1:
        return False
    cells = [c for c in rows[0] if _local(c.tag) in {"td", "th"}]
    return len(cells) == 1


def _table_content_ratio(text_el: etree._Element, table_el: etree._Element) -> float:
    total = len(_normalize_visible_text("".join(text_el.itertext())))
    if total <= 0:
        return 0.0
    cell_text = "".join(
        "".join(cell.itertext())
        for row in table_el.iter()
        if _local(row.tag) == "tr"
        for cell in row
        if _local(cell.tag) in {"td", "th"}
    )
    cell_len = len(_normalize_visible_text(cell_text))
    return cell_len / total if total else 0.0


def _outer_layout_table(text_el: etree._Element) -> Optional[etree._Element]:
    non_title_children = [c for c in text_el if _local(c.tag) != "title"]
    table_children = [c for c in non_title_children if _local(c.tag) == "table"]
    if len(table_children) != 1:
        return None
    if len(non_title_children) != 1:
        return None
    table_el = table_children[0]
    has_rows = any(_local(row.tag) == "tr" for row in table_el.iter())
    if not has_rows:
        return None
    if _table_content_ratio(text_el, table_el) <= 0.60:
        return None
    return table_el


def _paragraph_inner_html(paragraph_el: etree._Element) -> str:
    parts: list[str] = []
    if paragraph_el.text:
        parts.append(html.escape(paragraph_el.text))
    for child in paragraph_el:
        parts.append(_to_html(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    return "".join(parts)


def _render_paragraph(
    paragraph_el: etree._Element,
    *,
    section_depth: int,
    seen_ids: dict[str, int],
) -> str:
    inner = _paragraph_inner_html(paragraph_el)
    visible_text = _normalize_visible_text("".join(paragraph_el.itertext()))
    if not inner.strip():
        return ""
    if _is_single_bold_paragraph_source(paragraph_el) and _is_heading_like_text(visible_text):
        tag_name = "h3" if section_depth >= 2 else "h2"
        slug = _unique_slug(visible_text, seen_ids)
        return f'<{tag_name} id="{slug}">{html.escape(visible_text)}</{tag_name}>'
    return f"<p>{inner}</p>"


def _render_unwrapped_table(
    table_el: etree._Element,
    *,
    section_depth: int,
    seen_ids: dict[str, int],
    depth: int = 0,
) -> list[str]:
    if depth >= 3:
        table_html = _to_html(table_el)
        return [table_html] if table_html.strip() else []

    rendered: list[str] = []
    for row in table_el.xpath(".//*[local-name()='tr']"):
        if _local(row.tag) != "tr":
            continue
        nearest_table_ancestor = next(
            (anc for anc in row.iterancestors() if _local(anc.tag) == "table"),
            None,
        )
        if nearest_table_ancestor is not table_el:
            continue
        for cell in row:
            if _local(cell.tag) not in {"td", "th"}:
                continue
            if cell.text and cell.text.strip():
                rendered.append(f"<p>{html.escape(cell.text)}</p>")
            for child in cell:
                if _local(child.tag) == "table" and _is_single_cell_layout_table(child):
                    rendered.extend(
                        _render_unwrapped_table(
                            child,
                            section_depth=section_depth,
                            seen_ids=seen_ids,
                            depth=depth + 1,
                        )
                    )
                    if child.tail and child.tail.strip():
                        rendered.append(f"<p>{html.escape(child.tail)}</p>")
                    continue
                child_tag = _local(child.tag)
                if child_tag == "paragraph":
                    child_html = _render_paragraph(child, section_depth=section_depth, seen_ids=seen_ids)
                else:
                    child_html = _to_html(child)
                if child_html.strip():
                    rendered.append(child_html)
                if child.tail and child.tail.strip():
                    rendered.append(f"<p>{html.escape(child.tail)}</p>")
            if cell.tail and cell.tail.strip():
                rendered.append(f"<p>{html.escape(cell.tail)}</p>")
    return rendered


def _promote_strong_only_paragraphs(root: etree._Element, seen_ids: dict[str, int]) -> None:
    for p_el in list(root.xpath(".//p")):
        visible_text = _normalize_visible_text("".join(p_el.itertext()))
        if not _is_heading_like_text(visible_text):
            continue
        children = [child for child in p_el if isinstance(child.tag, str)]
        if len(children) != 1 or _local(children[0].tag) != "strong":
            continue
        child_text = _normalize_visible_text("".join(children[0].itertext()))
        if child_text != visible_text:
            continue
        h2_el = lxml_html.Element("h2")
        h2_el.set("id", _unique_slug(visible_text, seen_ids))
        h2_el.text = visible_text
        parent = p_el.getparent()
        if parent is not None:
            parent.replace(p_el, h2_el)


def _remove_dash_empty_paragraphs(root: etree._Element) -> None:
    for p_el in list(root.xpath(".//p")):
        visible_text = _normalize_visible_text("".join(p_el.itertext()))
        if not visible_text or _DASH_ONLY_P_RE.fullmatch(visible_text):
            parent = p_el.getparent()
            if parent is not None:
                parent.remove(p_el)


def _dedupe_and_trim_hr(root: etree._Element) -> None:
    for parent in root.iter():
        children = [child for child in parent if isinstance(child.tag, str)]
        prev_was_hr = False
        for child in children:
            if _local(child.tag) != "hr":
                prev_was_hr = False
                continue
            if prev_was_hr:
                parent.remove(child)
                continue
            prev_was_hr = True

    while len(root) and isinstance(root[0].tag, str) and _local(root[0].tag) == "hr":
        root.remove(root[0])
    while len(root) and isinstance(root[-1].tag, str) and _local(root[-1].tag) == "hr":
        root.remove(root[-1])


def _strip_duplicated_leading_medguide_header(root: etree._Element, h1_text: str) -> None:
    normalized_h1 = _normalize_visible_text(h1_text).lower()
    if not normalized_h1:
        return
    if not normalized_h1.startswith("medication guide"):
        return
    for child in list(root):
        if not isinstance(child.tag, str):
            continue
        tag = _local(child.tag)
        if tag == "h1":
            continue
        if tag != "p":
            break
        text = _normalize_visible_text("".join(child.itertext())).lower()
        if not text:
            root.remove(child)
            continue
        if text.startswith("medication guide"):
            root.remove(child)
        break


def _postprocess_rendered_html(combined_html: str, seen_ids: dict[str, int], h1_text: str) -> str:
    root = lxml_html.fragment_fromstring(combined_html or "", create_parent="div")
    _promote_strong_only_paragraphs(root, seen_ids)
    _remove_dash_empty_paragraphs(root)
    _dedupe_and_trim_hr(root)
    _strip_duplicated_leading_medguide_header(root, h1_text)
    return "".join(
        etree.tostring(child, encoding="unicode", method="html")
        for child in root
    )


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


def _to_html(el: etree._Element) -> str:
    """Recursively convert one SPL XML element to an HTML string.

    Handles: paragraph, list, item, caption, content, br, table family,
    linkHtml (strip tag/keep text), renderMultiMedia (skip entirely).
    All text nodes are HTML-escaped.  Unknown tags fall through to inner text.
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
                cap_parts: list[str] = []
                if child.text:
                    cap_parts.append(html.escape(child.text))
                for c in child:
                    cap_parts.append(_to_html(c))
                    if c.tail:
                        cap_parts.append(html.escape(c.tail))
                cap_inner = "".join(cap_parts)
                if cap_inner.strip():
                    items.append(f"<strong>{cap_inner}</strong>")
            elif child_tag == "item":
                item_parts: list[str] = []
                if child.text:
                    item_parts.append(html.escape(child.text))
                for c in child:
                    item_parts.append(_to_html(c))
                    if c.tail:
                        item_parts.append(html.escape(c.tail))
                item_inner = "".join(item_parts)
                if item_inner.strip():
                    items.append(f"<li>{item_inner}</li>")

        return f"<{wrap}>{''.join(items)}</{wrap}>" if items else ""

    # ── item → <li> (fallback for top-level item outside list) ───────────
    if tag == "item":
        inner = _inner()
        return f"<li>{inner}</li>" if inner.strip() else ""

    # ── caption → <strong> ────────────────────────────────────────────────
    if tag == "caption":
        inner = _inner()
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

    # ── Unknown / structural wrapper tags — fall through to inner HTML ────
    return _inner()


def _render_text_element(
    text_el: etree._Element,
    *,
    section_depth: int,
    seen_ids: dict[str, int],
) -> str:
    """Convert an SPL ``<text>`` element to an HTML string (unsanitized)."""
    parts: list[str] = []
    if text_el.text and text_el.text.strip():
        parts.append(f"<p>{html.escape(text_el.text)}</p>")
    table_layout = _outer_layout_table(text_el)
    if table_layout is not None:
        parts.extend(
            _render_unwrapped_table(table_layout, section_depth=section_depth, seen_ids=seen_ids)
        )
        return "\n".join(parts)
    for child in text_el:
        if _local(child.tag) == "paragraph":
            child_html = _render_paragraph(child, section_depth=section_depth, seen_ids=seen_ids)
        else:
            child_html = _to_html(child)
        if child_html.strip():
            parts.append(child_html)
        if child.tail and child.tail.strip():
            parts.append(f"<p>{html.escape(child.tail)}</p>")
    return "\n".join(parts)


def _walk_section(
    section: etree._Element,
    heading_level: int,
    section_depth: int,
    seen_ids: dict[str, int],
) -> str:
    """Walk a subsection and emit semantic HTML.

    Args:
        section: The SPL ``<section>`` element to walk.
        heading_level: The heading level (2 for direct children, 3 for nested).
        seen_ids: Mutable dict used for tracking id uniqueness.

    Returns:
        HTML string for the section and all its content.
    """
    parts: list[str] = []
    tag_name = f"h{heading_level}"

    title_el = section.find(f"{_NS}title")
    if title_el is not None:
        title_parts: list[str] = []
        if title_el.text:
            title_parts.append(html.escape(title_el.text))
        for child in title_el:
            title_parts.append(_to_html(child))
            if child.tail:
                title_parts.append(html.escape(child.tail))
        title_text = "".join(title_parts)
        raw_title = "".join(title_el.itertext())
        slug = _unique_slug(raw_title, seen_ids)
        if title_text.strip():
            parts.append(f'<{tag_name} id="{slug}">{title_text}</{tag_name}>')

    for child in section:
        child_tag = _local(child.tag)

        if child_tag == "title":
            continue  # already handled above

        if child_tag == "text":
            parts.append(_render_text_element(child, section_depth=section_depth, seen_ids=seen_ids))
            continue

        if child_tag == "component":
            # Components wrap nested sections
            for grandchild in child:
                gc_tag = _local(grandchild.tag)
                if gc_tag == "section":
                    next_level = min(heading_level + 1, 3)
                    parts.append(
                        _walk_section(
                            grandchild,
                            next_level,
                            section_depth=section_depth + 1,
                            seen_ids=seen_ids,
                        )
                    )
                else:
                    gc_html = _to_html(grandchild)
                    if gc_html.strip():
                        parts.append(gc_html)
            continue

        # Any other direct child (e.g. stray paragraph-like elements)
        child_html = _to_html(child)
        if child_html.strip():
            parts.append(child_html)

    return "\n".join(parts)


def _render_medguide_section(section: etree._Element) -> str:
    """Convert a medguide section subtree into a sanitized semantic HTML article.

    The section's own ``<title>`` becomes ``<h1>``.  Direct-child subsection
    titles become ``<h2>`` with slugified ids; one level deeper becomes ``<h3>``.
    The whole output is wrapped in ``<article>`` and sanitized via bleach.
    """
    parts: list[str] = []
    seen_ids: dict[str, int] = {}
    h1_text_plain = ""

    # Medguide section title → <h1>
    title_el = section.find(f"{_NS}title")
    if title_el is not None:
        title_parts: list[str] = []
        if title_el.text:
            title_parts.append(html.escape(title_el.text))
        for child in title_el:
            title_parts.append(_to_html(child))
            if child.tail:
                title_parts.append(html.escape(child.tail))
        title_text = "".join(title_parts)
        if title_text.strip():
            parts.append(f"<h1>{title_text}</h1>")
            h1_text_plain = "".join(title_el.itertext())

    for child in section:
        child_tag = _local(child.tag)

        if child_tag == "title":
            continue  # already handled above

        if child_tag == "text":
            parts.append(_render_text_element(child, section_depth=1, seen_ids=seen_ids))
            continue

        if child_tag == "component":
            for grandchild in child:
                gc_tag = _local(grandchild.tag)
                if gc_tag == "section":
                    parts.append(
                        _walk_section(
                            grandchild,
                            heading_level=2,
                            section_depth=2,
                            seen_ids=seen_ids,
                        )
                    )
                else:
                    gc_html = _to_html(grandchild)
                    if gc_html.strip():
                        parts.append(gc_html)
            continue

        child_html = _to_html(child)
        if child_html.strip():
            parts.append(child_html)

    combined = _postprocess_rendered_html("\n".join(parts), seen_ids=seen_ids, h1_text=h1_text_plain)
    sanitized = bleach.clean(combined, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)
    return f"<article>{sanitized}</article>"


# ---------------------------------------------------------------------------
# Section selection (unchanged from PR #196)
# ---------------------------------------------------------------------------

def _find_section_by_code(tree: etree._Element, code: str) -> Optional[etree._Element]:
    """Return the first ``<section>`` whose direct child ``<code code="...">`` matches."""
    for section in tree.iter(f"{_NS}section"):
        code_el = section.find(f"{_NS}code")
        if code_el is not None and code_el.get("code") == code:
            return section
    return None


def _section_looks_like_patient_guide(section: etree._Element) -> bool:
    """Return True if the section's title or opening text looks like a patient guide."""
    title_el = section.find(f"{_NS}title")
    if title_el is not None and title_el.text:
        title_lower = title_el.text.strip().lower()
        if any(kw in title_lower for kw in _PATIENT_TITLE_KEYWORDS):
            return True
    # Unclassified sections (42229-5) often hold embedded patient guides with no title
    code_el = section.find(f"{_NS}code")
    if code_el is not None and code_el.get("code") == _SPL_UNCLASSIFIED_CODE:
        return True
    # Check opening content (first 400 chars) for patient-guide keywords
    raw = "".join(section.itertext())
    snippet = raw[:400].lower()
    return any(kw in snippet for kw in _PATIENT_CONTENT_KEYWORDS)


def _find_patient_subsection_in_section17(tree: etree._Element) -> Optional[etree._Element]:
    """Look inside Section 17 (34076-0) for an embedded patient guide subsection."""
    section17 = _find_section_by_code(tree, "34076-0")
    if section17 is None:
        return None
    for child in section17.iter(f"{_NS}section"):
        if child is section17:
            continue
        if _section_looks_like_patient_guide(child):
            return child
    return None


def _select_medguide_section(tree: etree._Element) -> Optional[etree._Element]:
    """Select the medguide section using LOINC priority: 42231-1 → 42230-3 → Section 17 fallback."""
    for code in ("42231-1", "42230-3"):
        section = _find_section_by_code(tree, code)
        if section is not None:
            return section
    return _find_patient_subsection_in_section17(tree)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def fetch_medguide_html(spl_set_id: str) -> Optional[str]:
    """Fetch SPL XML, isolate the patient Medication Guide subtree, render as
    sanitized semantic HTML (no <html>/<head>/<link>, no FDA stylesheet, no
    iframe wrapper). Returns None on miss/failure.
    """
    spl_set_id = (spl_set_id or "").strip()
    if not spl_set_id:
        return None

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(_DAILYMED_SPL_XML_URL.format(spl_set_id=spl_set_id))
        if response.status_code >= 400:
            return None

        parser = etree.XMLParser(recover=True)
        xml_tree = etree.fromstring(response.content, parser=parser)

        section = _select_medguide_section(xml_tree)
        if section is None:
            return None

        return _render_medguide_section(section)
    except Exception as exc:
        logger.warning(
            "Failed to render medguide HTML for spl_set_id=%s: %s",
            spl_set_id,
            exc,
            exc_info=True,
        )
        return None
