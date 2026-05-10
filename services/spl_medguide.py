"""Service for rendering the FDA patient Medication Guide section as native semantic HTML.

Fetches SPL XML from DailyMed, isolates the patient-facing medguide ``<section>``
subtree via LOINC priority (``42231-1`` → ``42230-3`` → Section 17 fallback), then
walks the subtree to produce clean, Tailwind-styleable markup with no FDA stylesheet
link, iframe wrapper, or ``<html>`` outer frame.
"""

from __future__ import annotations

from copy import deepcopy
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
_SECTION_REF_RE = re.compile(r"\s*\((?:\d+\.\d+(?:\.\d+)?(?:\s*,\s*\d+\.\d+(?:\.\d+)?)*)\)")
_APPROVAL_P_RE = re.compile(r"^\s*this medication guide has been approved", re.IGNORECASE)
_REVISED_P_RE = re.compile(r"^\s*revised:", re.IGNORECASE)
_ALLOWED_CLASS_VALUES: dict[str, set[str]] = {
    "div": {"medguide-meta"},
    "p": {"medguide-approval", "medguide-revised"},
}

# Safe HTML tags allowed in output
ALLOWED_TAGS = [
    "article",
    "h1", "h2", "h3",
    "div",
    "p", "ul", "ol", "li", "strong", "em", "u", "br",
    "hr",
]

# Safe attributes allowed per tag in output
ALLOWED_ATTRS: dict[str, list[str]] = {
    "h1": ["id"],
    "h2": ["id"],
    "h3": ["id"],
    "div": ["class"],
    "p": ["class"],
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
    if normalized.endswith(":"):
        return len(normalized) <= 80
    return normalized.endswith("?") or bool(_HEADING_KEYWORD_RE.match(normalized))


def _style_tokens(style_code: str) -> set[str]:
    return {token for token in re.split(r"[\s,]+", (style_code or "").lower()) if token}


def _apply_style_wrappers(inner: str, style_code: str) -> str:
    if not inner:
        return ""
    tokens = _style_tokens(style_code)
    if "bold" in tokens:
        inner = f"<strong>{inner}</strong>"
    if "italics" in tokens or "italic" in tokens:
        inner = f"<em>{inner}</em>"
    if "underline" in tokens:
        inner = f"<u>{inner}</u>"
    return inner


def _logical_table_rows(table_el: etree._Element) -> list[etree._Element]:
    rows: list[etree._Element] = []
    for child in table_el:
        child_tag = _local(child.tag)
        if child_tag == "tr":
            rows.append(child)
        elif child_tag in {"thead", "tbody", "tfoot"}:
            rows.extend(grandchild for grandchild in child if _local(grandchild.tag) == "tr")
    return rows


def _row_cells(row_el: etree._Element) -> list[etree._Element]:
    return [child for child in row_el if _local(child.tag) in {"td", "th"}]


_BLOCK_CELL_TAGS = {"paragraph", "list", "br", "table"}


def _table_has_block_cell_content(table_el: etree._Element) -> bool:
    for row in _logical_table_rows(table_el):
        for cell in _row_cells(row):
            if _local(cell.tag) != "td":
                continue
            if any(_local(desc.tag) in _BLOCK_CELL_TAGS for desc in cell.iterdescendants()):
                return True
    return False


def _table_combined_text_length(table_el: etree._Element) -> int:
    return sum(len(t) for t in table_el.itertext())


def _is_layout_table(table_el: etree._Element) -> bool:
    border = (table_el.get("border") or "").strip()
    if border and border != "0":
        return False

    rows = _logical_table_rows(table_el)
    if not rows:
        return False

    row_cell_counts: list[int] = []
    for row in rows:
        cells = _row_cells(row)
        if not cells:
            continue
        if any(_local(cell.tag) == "th" for cell in cells):
            return False
        row_cell_counts.append(len(cells))

    if not row_cell_counts:
        return False
    if not all(count <= 3 for count in row_cell_counts):
        return False
    if _table_combined_text_length(table_el) <= 40:
        return False
    return _table_has_block_cell_content(table_el)


def _paragraph_inner_html(paragraph_el: etree._Element) -> str:
    parts: list[str] = []
    if paragraph_el.text:
        parts.append(html.escape(paragraph_el.text))
    for child in paragraph_el:
        parts.append(_to_html(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    inner = "".join(parts)
    return _apply_style_wrappers(inner, paragraph_el.get("styleCode") or "")


def _render_paragraph(paragraph_el: etree._Element) -> str:
    inner = _paragraph_inner_html(paragraph_el)
    if not inner.strip():
        return ""
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
    for row in _logical_table_rows(table_el):
        for cell in _row_cells(row):
            if _local(cell.tag) not in {"td", "th"}:
                continue
            if cell.text and cell.text.strip():
                rendered.append(f"<p>{html.escape(cell.text)}</p>")
            for child in cell:
                if _local(child.tag) == "table" and _is_layout_table(child):
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
                    child_html = _render_paragraph(child)
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
        if not _paragraph_is_fully_bold_dom(p_el):
            continue
        h2_el = lxml_html.Element("h2")
        h2_el.set("id", _unique_slug(visible_text, seen_ids))
        h2_el.text = visible_text
        parent = p_el.getparent()
        if parent is not None:
            parent.replace(p_el, h2_el)


def _paragraph_is_fully_bold_dom(p_el: etree._Element) -> bool:
    if _normalize_visible_text(p_el.text or ""):
        return False

    children = [child for child in p_el if isinstance(child.tag, str)]
    if not children:
        return False

    has_bold_text = False
    for child in children:
        child_tag = _local(child.tag)
        if child_tag == "strong":
            if _normalize_visible_text("".join(child.itertext())):
                has_bold_text = True
        elif child_tag != "br":
            return False
        if _normalize_visible_text(child.tail or ""):
            return False
    return has_bold_text


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


def _is_generic_medguide_h1(el: etree._Element | None) -> bool:
    if el is None or _local(el.tag) != "h1":
        return False
    return _normalize_visible_text("".join(el.itertext())).lower() == "medication guide"


def _clone_with_tag(source_el: etree._Element, tag_name: str) -> etree._Element:
    clone = deepcopy(source_el)
    clone.tag = tag_name
    return clone


def _promote_medguide_title_block(root: etree._Element) -> None:
    existing_h1 = next(
        (child for child in root if isinstance(child.tag, str) and _local(child.tag) == "h1"),
        None,
    )
    generic_h1 = _is_generic_medguide_h1(existing_h1)

    candidate: Optional[etree._Element] = None
    for child in root:
        if not isinstance(child.tag, str):
            continue
        child_tag = _local(child.tag)
        if child_tag == "h1":
            continue
        if child_tag != "p":
            break
        visible_text = _normalize_visible_text("".join(child.itertext()))
        if not visible_text:
            continue
        if _APPROVAL_P_RE.match(visible_text) or _REVISED_P_RE.match(visible_text):
            continue
        candidate = child
        break

    if candidate is None or not _paragraph_is_fully_bold_dom(candidate):
        return

    visible_text = _normalize_visible_text("".join(candidate.itertext()))
    if "medication guide" not in visible_text.lower():
        return

    title_h1 = _clone_with_tag(candidate, "h1")
    parent = candidate.getparent()
    if parent is None:
        return

    if generic_h1 and existing_h1 is not None:
        parent.replace(existing_h1, title_h1)
        parent.remove(candidate)
        return

    parent.replace(candidate, title_h1)
    if generic_h1 and existing_h1 is not None and existing_h1.getparent() is parent:
        parent.remove(existing_h1)


def _extract_meta_strip(root: etree._Element) -> None:
    meta_paragraphs: list[etree._Element] = []
    for child in list(root):
        if not isinstance(child.tag, str) or _local(child.tag) != "p":
            continue
        visible_text = _normalize_visible_text("".join(child.itertext()))
        if _APPROVAL_P_RE.match(visible_text):
            child.set("class", "medguide-approval")
            meta_paragraphs.append(child)
        elif _REVISED_P_RE.match(visible_text):
            child.set("class", "medguide-revised")
            meta_paragraphs.append(child)

    if not meta_paragraphs:
        return

    meta_div = lxml_html.Element("div")
    meta_div.set("class", "medguide-meta")
    for paragraph in meta_paragraphs:
        if paragraph.getparent() is root:
            root.remove(paragraph)
        meta_div.append(paragraph)

    h1_index = next(
        (index for index, child in enumerate(root) if isinstance(child.tag, str) and _local(child.tag) == "h1"),
        None,
    )
    insert_at = 0 if h1_index is None else h1_index + 1
    root.insert(insert_at, meta_div)


def _bleach_allowed_attrs(tag: str, name: str, value: str) -> bool:
    allowed_attrs = ALLOWED_ATTRS.get(tag, [])
    if name not in allowed_attrs:
        return False
    if name != "class":
        return True
    allowed_values = _ALLOWED_CLASS_VALUES.get(tag, set())
    class_values = [part for part in (value or "").split() if part]
    return bool(class_values) and set(class_values).issubset(allowed_values)


def _postprocess_rendered_html(combined_html: str, seen_ids: dict[str, int], h1_text: str) -> str:
    root = lxml_html.fragment_fromstring(combined_html or "", create_parent="div")
    _remove_dash_empty_paragraphs(root)
    _promote_medguide_title_block(root)
    _extract_meta_strip(root)
    _promote_strong_only_paragraphs(root, seen_ids)
    _dedupe_and_trim_hr(root)
    _strip_duplicated_leading_medguide_header(root, h1_text)
    return "".join(
        etree.tostring(child, encoding="unicode", method="html")
        for child in root
    )


def _strip_tables(html_str: str) -> str:
    root = lxml_html.fragment_fromstring(html_str or "", create_parent="div")
    for table in list(root.xpath(".//table")):
        parent = table.getparent()
        if parent is None:
            continue
        replacement_blocks: list[etree._Element] = []
        for cell in [node for node in table.iter() if isinstance(node.tag, str) and _local(node.tag) in {"td", "th", "caption"}]:
            cell_text = _normalize_visible_text(cell.text or "")
            if cell_text:
                p_el = lxml_html.Element("p")
                p_el.text = cell_text
                replacement_blocks.append(p_el)
            for child in list(cell):
                cell.remove(child)
                child_tail = child.tail
                child.tail = None
                replacement_blocks.append(child)
                if _normalize_visible_text(child_tail or ""):
                    tail_p = lxml_html.Element("p")
                    tail_p.text = _normalize_visible_text(child_tail or "")
                    replacement_blocks.append(tail_p)

        insert_at = parent.index(table)
        for offset, block in enumerate(replacement_blocks):
            parent.insert(insert_at + offset, block)
        parent.remove(table)

    return "".join(
        etree.tostring(child, encoding="unicode", method="html")
        for child in root
    )


def _collapse_consecutive_identical_h1(root: etree._Element) -> None:
    for parent in root.iter():
        prev_h1_text: Optional[str] = None
        for child in list(parent):
            if not isinstance(child.tag, str):
                prev_h1_text = None
                continue
            if _local(child.tag) != "h1":
                prev_h1_text = None
                continue
            current_text = _normalize_visible_text("".join(child.itertext())).lower()
            if prev_h1_text is not None and current_text == prev_h1_text:
                parent.remove(child)
                continue
            prev_h1_text = current_text


def _postprocess_after_table_strip(html_str: str, *, extract_meta_strip: bool) -> str:
    root = lxml_html.fragment_fromstring(html_str or "", create_parent="div")
    _remove_dash_empty_paragraphs(root)
    if extract_meta_strip:
        _extract_meta_strip(root)
    _collapse_consecutive_identical_h1(root)
    return "".join(
        etree.tostring(child, encoding="unicode", method="html")
        for child in root
    )


def _strip_section_refs(html_str: str) -> str:
    return _SECTION_REF_RE.sub("", html_str or "")


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
        return _render_paragraph(el)

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
    for child in text_el:
        child_tag = _local(child.tag)
        if child_tag == "table" and _is_layout_table(child):
            parts.extend(
                _render_unwrapped_table(child, section_depth=section_depth, seen_ids=seen_ids)
            )
            if child.tail and child.tail.strip():
                parts.append(f"<p>{html.escape(child.tail)}</p>")
            continue
        elif child_tag == "paragraph":
            child_html = _render_paragraph(child)
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
    combined = _strip_tables(combined)
    combined = _postprocess_after_table_strip(combined, extract_meta_strip=True)
    sanitized = bleach.clean(combined, tags=ALLOWED_TAGS, attributes=_bleach_allowed_attrs, strip=True)
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


_BOXED_WARNING_LOINC = "34066-1"

_BOXED_ALLOWED_TAGS = [
    "div", "h2", "h3",
    "p", "ul", "ol", "li", "strong", "em", "u", "br",
]

_BOXED_ALLOWED_ATTRS: dict[str, list[str]] = {
    "h2": ["id"],
    "h3": ["id"],
    "div": ["class"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
}

_BOXED_ALLOWED_CLASS_VALUES: set[str] = {"boxed-warning-content"}


def _boxed_allowed_attrs(tag: str, name: str, value: str) -> bool:
    allowed = _BOXED_ALLOWED_ATTRS.get(tag, [])
    if name not in allowed:
        return False
    if name != "class":
        return True
    class_values = [p for p in (value or "").split() if p]
    return bool(class_values) and set(class_values).issubset(_BOXED_ALLOWED_CLASS_VALUES)


def _render_boxed_warning_section(section: etree._Element) -> str:
    """Render a 34066-1 boxed warning section as sanitized HTML."""
    seen_ids: dict[str, int] = {}
    parts: list[str] = []

    for child in section:
        child_tag = _local(child.tag)
        if child_tag == "title":
            continue
        if child_tag == "text":
            parts.append(_render_text_element(child, section_depth=1, seen_ids=seen_ids))
            continue
        if child_tag == "component":
            for grandchild in child:
                gc_tag = _local(grandchild.tag)
                if gc_tag == "section":
                    parts.append(
                        _walk_section(grandchild, heading_level=2, section_depth=2, seen_ids=seen_ids)
                    )
                else:
                    gc_html = _to_html(grandchild)
                    if gc_html.strip():
                        parts.append(gc_html)
            continue
        child_html = _to_html(child)
        if child_html.strip():
            parts.append(child_html)

    inner = "\n".join(parts)
    inner = _strip_tables(inner)
    inner = _postprocess_after_table_strip(inner, extract_meta_strip=False)
    inner = _strip_section_refs(inner)
    sanitized = bleach.clean(
        inner,
        tags=_BOXED_ALLOWED_TAGS,
        attributes=_boxed_allowed_attrs,
        strip=True,
    )
    return f'<div class="boxed-warning-content">{sanitized}</div>'


async def fetch_boxed_warning_html(spl_set_id: str) -> Optional[str]:
    """Fetch SPL XML, isolate the FDA Boxed Warning section (LOINC 34066-1),
    render via the same structural walker as the medguide, sanitize, and return.
    Returns None if no boxed warning section is present or on any failure.
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

        section = _find_section_by_code(xml_tree, _BOXED_WARNING_LOINC)
        if section is None:
            return None

        rendered = _render_boxed_warning_section(section)
        stripped = rendered.replace('<div class="boxed-warning-content">', "").replace("</div>", "").strip()
        if not stripped:
            return None
        return rendered
    except Exception as exc:
        logger.warning(
            "Failed to render boxed warning HTML for spl_set_id=%s: %s",
            spl_set_id,
            exc,
            exc_info=True,
        )
        return None
