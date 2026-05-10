import html
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import bleach
import httpx
from lxml import etree
from lxml import html as lxml_html

from services._spl_text_helpers import strip_leading_bullets_from_html

logger = logging.getLogger(__name__)

_DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{spl_set_id}.xml"
_DAILYMED_IMAGE_URL = "https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid={spl_set_id}&type=img&name={filename}"
_DAILYMED_IMAGE_HOST = "dailymed.nlm.nih.gov"
_HL7_NS = "urn:hl7-org:v3"
_NS = f"{{{_HL7_NS}}}"
_ANCHOR_HREF_RE = re.compile(r"^#[a-z0-9-]+$")
_SECTION_REF_RE = re.compile(r"\s*\((?:\d+\.\d+(?:\.\d+)?(?:\s*,\s*\d+\.\d+(?:\.\d+)?)*)\)")
_BRACKETED_REF_RE = re.compile(
    r"\[((?:see\s+also|also\s+see|see)\b[^\]]*?)\]",
    flags=re.IGNORECASE,
)
_NUMBERED_REF_RE = re.compile(r"\((\d+)(?:\.\d+(?:\.\d+)?)?\)")
_FULL_PI_CONTENTS_RE = re.compile(r"^full prescribing information:\s*contents\b", re.IGNORECASE)
_SECTIONS_OMITTED_RE = re.compile(
    r"^\*\s*sections or subsections omitted from the full prescribing information are not listed\.?\s*$",
    re.IGNORECASE,
)
_DASH_ONLY_RE = re.compile(r"^-{2,}$")

PRO_SECTIONS = [
    ("42229-5", "highlights", "Highlights", "Highlights of Prescribing Information"),
    ("34066-1", "boxed-warning", "Boxed Warning", "Boxed Warning"),
    ("34067-9", "indications", "Indications", "Indications and Usage"),
    ("34068-7", "dosage", "Dosage", "Dosage and Administration"),
    ("43678-2", "dosage-forms", "Dosage Forms", "Dosage Forms and Strengths"),
    ("34070-3", "contraindications", "Contraindications", "Contraindications"),
    ("43685-7", "warnings-precautions", "Warnings", "Warnings and Precautions"),
    ("34084-4", "adverse-reactions", "Adverse Reactions", "Adverse Reactions"),
    ("34073-7", "drug-interactions", "Drug Interactions", "Drug Interactions"),
    ("43684-0", "specific-populations", "Specific Populations", "Use in Specific Populations"),
    ("42227-9", "drug-abuse-dependence", "Drug Abuse", "Drug Abuse and Dependence"),
    ("34088-5", "overdosage", "Overdosage", "Overdosage"),
    ("34089-3", "description", "Description", "Description"),
    ("34090-1", "clinical-pharmacology", "Clinical Pharmacology", "Clinical Pharmacology"),
    ("43680-8", "nonclinical-toxicology", "Nonclinical Toxicology", "Nonclinical Toxicology"),
    ("34092-7", "clinical-studies", "Clinical Studies", "Clinical Studies"),
    ("43686-5", "references", "References", "References"),
    ("34069-5", "how-supplied", "How Supplied", "How Supplied / Storage and Handling"),
    ("34076-0", "patient-counseling", "Patient Counseling", "Patient Counseling Information"),
]

NUMBERED_SECTION_PREFIX_TO_SLUG = {
    1: "indications",
    2: "dosage",
    3: "dosage-forms",
    4: "contraindications",
    5: "warnings-precautions",
    6: "adverse-reactions",
    7: "drug-interactions",
    8: "specific-populations",
    9: "drug-abuse-dependence",
    10: "overdosage",
    11: "description",
    12: "clinical-pharmacology",
    13: "nonclinical-toxicology",
    14: "clinical-studies",
    15: "references",
    16: "how-supplied",
    17: "patient-counseling",
}

_DESCRIPTIVE_NAME_TO_SLUG = {
    "boxed warning": "boxed-warning",
    "highlights": "highlights",
    "indications": "indications",
    "indications and usage": "indications",
    "dosage and administration": "dosage",
    "dosage forms and strengths": "dosage-forms",
    "contraindications": "contraindications",
    "warnings": "warnings-precautions",
    "warnings and precautions": "warnings-precautions",
    "adverse reactions": "adverse-reactions",
    "drug interactions": "drug-interactions",
    "use in specific populations": "specific-populations",
    "drug abuse and dependence": "drug-abuse-dependence",
    "overdosage": "overdosage",
    "description": "description",
    "clinical pharmacology": "clinical-pharmacology",
    "nonclinical toxicology": "nonclinical-toxicology",
    "clinical studies": "clinical-studies",
    "references": "references",
    "how supplied": "how-supplied",
    "how supplied/storage and handling": "how-supplied",
    "patient counseling information": "patient-counseling",
    "patient counseling": "patient-counseling",
}

_ALLOWED_TAGS = [
    "div",
    "aside",
    "span",
    "section",
    "figure",
    "figcaption",
    "img",
    "a",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "u",
    "br",
    "sub",
    "sup",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "caption",
]

_ALLOWED_ATTRS: dict[str, list[str]] = {
    "div": ["class"],
    "aside": ["class", "role", "aria-label"],
    "span": ["class"],
    "section": ["id", "class"],
    "figure": ["class"],
    "figcaption": ["class"],
    "img": ["src", "alt", "loading", "width", "height", "class"],
    "a": ["href", "id", "class", "title", "aria-label"],
    "h2": ["id", "class"],
    "h3": ["id", "class"],
    "h4": ["id", "class"],
    "h5": ["id", "class"],
    "h6": ["id", "class"],
    "th": ["colspan", "rowspan"],
    "td": ["colspan", "rowspan"],
}


@dataclass
class ProfessionalRendered:
    article_html: str
    highlights_html: Optional[str]
    sections: list[tuple[str, str]]


def _local(tag: str) -> str:
    if "{" in tag:
        return tag.split("}", 1)[1]
    return tag


def _normalize_text(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower())
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-") or "section"


def _slugify_section_title(text: str) -> str:
    cleaned = re.sub(r"^\d+(?:\.\d+)*\s*", "", (text or "").strip())
    return _slugify(cleaned or text)


def _iter_section_children(section: etree._Element):
    for child in section:
        if isinstance(child.tag, str):
            yield child


def _find_section_by_code(tree: etree._Element, code: str) -> Optional[etree._Element]:
    for section in tree.iter(f"{_NS}section"):
        code_el = section.find(f"{_NS}code")
        if code_el is not None and code_el.get("code") == code:
            return section
    return None


def _unique_anchor(base: str, seen: dict[str, int]) -> str:
    cleaned = _slugify(base)
    if cleaned not in seen:
        seen[cleaned] = 1
        return cleaned
    seen[cleaned] += 1
    return f"{cleaned}-{seen[cleaned]}"


def _title_text(section: etree._Element) -> str:
    title_el = section.find(f"{_NS}title")
    return _normalize_text("".join(title_el.itertext())) if title_el is not None else ""


def _section_path(section: etree._Element) -> str:
    return section.getroottree().getpath(section)


def _build_section_anchor_maps(sections: list[tuple[etree._Element, str]]) -> tuple[dict[str, str], dict[str, str]]:
    seen: dict[str, int] = {}
    section_anchors: dict[str, str] = {}
    xml_targets: dict[str, str] = {}

    def _walk(section: etree._Element, *, top_slug: str, parent_anchor: str, level: int) -> None:
        anchor = parent_anchor
        if level == 0:
            anchor = _unique_anchor(top_slug, seen)
        else:
            title = _title_text(section)
            if title:
                anchor = _unique_anchor(f"{top_slug}-{_slugify_section_title(title)}", seen)
        section_anchors[_section_path(section)] = anchor
        xml_id = section.get("ID") or section.get("id")
        if xml_id:
            xml_targets[xml_id] = anchor
        for child in _iter_section_children(section):
            if _local(child.tag) != "component":
                continue
            for grandchild in _iter_section_children(child):
                if _local(grandchild.tag) == "section":
                    _walk(grandchild, top_slug=top_slug, parent_anchor=anchor, level=level + 1)

    for section, top_slug in sections:
        _walk(section, top_slug=top_slug, parent_anchor=top_slug, level=0)
    return section_anchors, xml_targets


def _build_media_map(tree: etree._Element) -> dict[str, str]:
    media: dict[str, str] = {}
    for observation in tree.iter():
        if not isinstance(observation.tag, str) or _local(observation.tag) != "observationMedia":
            continue
        media_id = observation.get("ID") or observation.get("id")
        reference = next(
            (
                node
                for node in observation.iter()
                if isinstance(node.tag, str) and _local(node.tag) == "reference"
            ),
            None,
        )
        filename = reference.get("value") if reference is not None else None
        if media_id and filename:
            media[media_id] = filename.split("/")[-1]
    return media


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


def _is_layout_table(table_el: etree._Element) -> bool:
    border = (table_el.get("border") or "").strip()
    if border and border != "0":
        return False

    rows = _logical_table_rows(table_el)
    if not rows:
        return False

    row_cell_counts: list[int] = []
    has_block_cell_content = False
    for row in rows:
        cells = _row_cells(row)
        if not cells:
            continue
        if any(_local(cell.tag) == "th" for cell in cells):
            return False
        row_cell_counts.append(len(cells))
        for cell in cells:
            if _local(cell.tag) != "td":
                continue
            if any(
                _local(desc.tag) in {"paragraph", "list", "section", "table", "br"}
                for desc in cell.iterdescendants()
                if isinstance(desc.tag, str)
            ):
                has_block_cell_content = True

    # FDA page-frame layout tables are narrow navigation/content wrappers (typically 1-2 cells/row).
    # Real clinical data tables generally exceed this width or use headers.
    return bool(row_cell_counts) and all(count <= 3 for count in row_cell_counts) and has_block_cell_content


def _paragraph_from_text(text: str) -> etree._Element | None:
    normalized = _normalize_text(text or "")
    if not normalized:
        return None
    paragraph = etree.Element("paragraph")
    paragraph.text = normalized
    return paragraph


def _flatten_layout_table(table_el: etree._Element, *, depth: int = 0, max_depth: int = 2) -> list[etree._Element]:
    flattened: list[etree._Element] = []
    for row in _logical_table_rows(table_el):
        for cell in _row_cells(row):
            if _local(cell.tag) not in {"td", "th"}:
                continue
            text_paragraph = _paragraph_from_text(cell.text or "")
            if text_paragraph is not None:
                flattened.append(text_paragraph)
            for child in cell:
                if (
                    _local(child.tag) == "table"
                    and depth < max_depth
                    and _is_layout_table(child)
                ):
                    flattened.extend(_flatten_layout_table(child, depth=depth + 1, max_depth=max_depth))
                else:
                    flattened.append(child)
                tail_paragraph = _paragraph_from_text(child.tail or "")
                if tail_paragraph is not None:
                    flattened.append(tail_paragraph)
    return flattened


def _meaningful_children(el: etree._Element) -> list[etree._Element]:
    return [child for child in el if isinstance(child.tag, str)]


def _unwrap_outer_layout_blocks(text_el: etree._Element) -> list[etree._Element]:
    meaningful = _meaningful_children(text_el)
    if len(meaningful) == 1 and _local(meaningful[0].tag) == "table" and _is_layout_table(meaningful[0]):
        return _flatten_layout_table(meaningful[0], depth=0, max_depth=2)
    return meaningful


def _is_dash_or_empty_paragraph(el: etree._Element) -> bool:
    if _local(el.tag) != "paragraph":
        return False
    normalized = _normalize_text("".join(el.itertext()))
    return not normalized or bool(_DASH_ONLY_RE.fullmatch(normalized))


def _list_item_is_section_link_only(item_el: etree._Element) -> bool:
    links = [
        link
        for link in item_el.iter()
        if isinstance(link.tag, str) and _local(link.tag) == "linkHtml"
    ]
    if not links:
        return False
    if not all((link.get("href") or "").lower().startswith("#section") for link in links):
        return False
    item_text = _normalize_text("".join(item_el.itertext()))
    links_text = _normalize_text(" ".join("".join(link.itertext()) for link in links))
    return bool(item_text) and item_text == links_text


def _is_fda_contents_link_list(el: etree._Element) -> bool:
    if _local(el.tag) != "list":
        return False
    items = [child for child in _meaningful_children(el) if _local(child.tag) == "item"]
    if not items:
        return False
    return all(_list_item_is_section_link_only(item) for item in items)


def _is_fda_contents_table(el: etree._Element) -> bool:
    if _local(el.tag) != "table":
        return False
    if any(_local(desc.tag) == "th" for desc in el.iterdescendants() if isinstance(desc.tag, str)):
        return False
    found_list = False
    for node in el.iter():
        if not isinstance(node.tag, str):
            continue
        local = _local(node.tag)
        if local in {"tbody", "thead", "tfoot", "tr", "td", "table"}:
            continue
        if local == "list":
            if not _is_fda_contents_link_list(node):
                return False
            found_list = True
            continue
        if local == "paragraph":
            text = _normalize_text("".join(node.itertext()))
            if not text:
                continue
            if _FULL_PI_CONTENTS_RE.match(text) or _SECTIONS_OMITTED_RE.fullmatch(text):
                continue
            return False
        return False
    return found_list


def _should_drop_contents_node(el: etree._Element) -> bool:
    if _is_dash_or_empty_paragraph(el):
        return True
    if _local(el.tag) == "paragraph":
        text = _normalize_text("".join(el.itertext()))
        if _FULL_PI_CONTENTS_RE.match(text):
            return True
        if _SECTIONS_OMITTED_RE.fullmatch(text):
            return True
    if _is_fda_contents_link_list(el):
        return True
    return _is_fda_contents_table(el)


def _format_revision_date(tree: etree._Element) -> Optional[str]:
    for element in tree.iter(f"{_NS}effectiveTime"):
        value = (element.get("value") or "").strip()
        if not value:
            continue
        for fmt, length in (("%Y%m%d", 8), ("%Y%m", 6), ("%Y", 4)):
            candidate = value[:length]
            try:
                parsed = datetime.strptime(candidate, fmt)
            except ValueError:
                continue
            if length == 8:
                return parsed.strftime("Revised: %b %d, %Y")
            if length == 6:
                return parsed.strftime("Revised: %b %Y")
            return parsed.strftime("Revised: %Y")
        return f"Revised: {html.escape(value)}"
    return None


def _is_meaningful_html(fragment: str) -> bool:
    return bool(re.sub(r"<[^>]+>", "", fragment or "").strip())


def _sanitize_html(fragment: str) -> str:
    sanitized = bleach.clean(fragment, tags=_ALLOWED_TAGS, attributes=_is_attr_allowed, strip=True)
    root = lxml_html.fragment_fromstring(sanitized or "", create_parent="div")
    for img in list(root.xpath(".//img[not(@src)]")):
        parent = img.getparent()
        if parent is not None:
            parent.remove(img)
    return ((root.text or "") + "".join(lxml_html.tostring(child, encoding="unicode") for child in root)).strip()


def _strip_dash_empty_paragraphs_html(fragment: str) -> str:
    root = lxml_html.fragment_fromstring(fragment or "", create_parent="div")
    for paragraph in list(root.xpath(".//p")):
        text = _normalize_text("".join(paragraph.itertext()))
        if not text or _DASH_ONLY_RE.fullmatch(text):
            parent = paragraph.getparent()
            if parent is not None:
                parent.remove(paragraph)
    return ((root.text or "") + "".join(lxml_html.tostring(child, encoding="unicode") for child in root)).strip()


def _promote_warning_paragraphs_to_h3(fragment: str) -> str:
    root = lxml_html.fragment_fromstring(fragment or "", create_parent="div")
    for paragraph in list(root.xpath(".//p")):
        text = _normalize_text("".join(paragraph.itertext()))
        if not re.match(r"^WARNING:\s", text):
            continue
        heading = lxml_html.Element("h3")
        heading.set("class", "boxed-warning-heading")
        heading.text = text
        paragraph.addnext(heading)
        parent = paragraph.getparent()
        if parent is not None:
            parent.remove(paragraph)
    return ((root.text or "") + "".join(lxml_html.tostring(child, encoding="unicode") for child in root)).strip()


def _dedupe_boxed_warning_html(fragment: str) -> str:
    root = lxml_html.fragment_fromstring(fragment or "", create_parent="div")
    seen_headings: set[str] = set()
    seen_list_items: set[str] = set()
    for el in list(root.iter()):
        if not isinstance(el.tag, str):
            continue
        text = _normalize_text("".join(el.itertext())).lower().rstrip(".:;,")
        if not text:
            continue
        if el.tag == "li":
            if text in seen_list_items:
                parent = el.getparent()
                if parent is not None:
                    parent.remove(el)
                continue
            seen_list_items.add(text)
            continue
        if el.tag in {"h2", "h3", "h4", "h5", "h6"}:
            if text in seen_headings:
                parent = el.getparent()
                if parent is not None:
                    parent.remove(el)
                continue
            seen_headings.add(text)
    return ((root.text or "") + "".join(lxml_html.tostring(child, encoding="unicode") for child in root)).strip()


def _strip_section_refs(html_str: str) -> str:
    return _SECTION_REF_RE.sub("", html_str or "")


def _linkify_section_refs(html_str: str) -> str:
    def _replace_bracket(match: re.Match) -> str:
        inner = match.group(1)
        num_match = _NUMBERED_REF_RE.search(inner)
        if not num_match:
            stripped = re.sub(r"^\s*(?:see\s+also|also\s+see|see)\s+", "", inner, flags=re.IGNORECASE).strip().lower()
            descriptive_slug = _DESCRIPTIVE_NAME_TO_SLUG.get(stripped)
            if not descriptive_slug:
                return match.group(0)
            return f'<a href="#{descriptive_slug}" class="pro-section-ref">[{inner}]</a>'

        section_prefix = int(num_match.group(1))
        slug = NUMBERED_SECTION_PREFIX_TO_SLUG.get(section_prefix)
        if not slug:
            return match.group(0)
        return f'<a href="#{slug}" class="pro-section-ref">[{inner}]</a>'

    return _BRACKETED_REF_RE.sub(_replace_bracket, html_str or "")


def _is_attr_allowed(tag: str, name: str, value: str) -> bool:
    if name not in _ALLOWED_ATTRS.get(tag, []):
        return False
    if tag == "a" and name == "href":
        return bool(_ANCHOR_HREF_RE.fullmatch((value or "").strip()))
    if tag == "img" and name == "src":
        parsed = urlparse((value or "").strip())
        return parsed.scheme == "https" and parsed.hostname == _DAILYMED_IMAGE_HOST
    return True


class _RenderContext:
    def __init__(self, *, spl_set_id: str, media_map: dict[str, str], link_targets: dict[str, str], section_anchors: dict[str, str]):
        self.spl_set_id = spl_set_id
        self.media_map = media_map
        self.link_targets = link_targets
        self.section_anchors = section_anchors


def _render_children(parent: etree._Element, ctx: _RenderContext) -> str:
    parts: list[str] = []
    children = [child for child in parent if isinstance(child.tag, str)]
    index = 0
    while index < len(children):
        child = children[index]
        next_sibling = children[index + 1] if index + 1 < len(children) else None
        if _local(child.tag) == "renderMultiMedia":
            figure_html, consumed_caption = _render_multimedia(child, next_sibling, ctx)
            if figure_html:
                parts.append(figure_html)
            if child.tail:
                parts.append(html.escape(child.tail))
            if consumed_caption and next_sibling is not None:
                if next_sibling.tail:
                    parts.append(html.escape(next_sibling.tail))
                index += 2
                continue
            index += 1
            continue
        rendered = _render_node(child, ctx)
        if rendered:
            parts.append(rendered)
        if child.tail:
            parts.append(html.escape(child.tail))
        index += 1
    return "".join(parts)


def _render_node(el: etree._Element, ctx: _RenderContext) -> str:
    tag = _local(el.tag)
    inner = _render_children(el, ctx)
    if el.text:
        inner = html.escape(el.text) + inner

    if tag == "paragraph":
        return f"<p>{inner}</p>" if inner.strip() else ""
    if tag == "list":
        style = (el.get("styleCode") or "").lower()
        list_type = (el.get("listType") or "").lower()
        wrap = "ol" if "arabic" in style or list_type == "ordered" else "ul"
        items: list[str] = []
        for child in _iter_section_children(el):
            child_tag = _local(child.tag)
            if child_tag == "caption":
                caption_inner = _caption_inner_with_ctx(child, ctx)
                if caption_inner.strip():
                    items.append(f"<li><strong>{caption_inner}</strong></li>")
            elif child_tag == "item":
                item_inner = _item_inner_with_ctx(child, ctx)
                if item_inner.strip():
                    items.append(f"<li>{item_inner}</li>")
        return f"<{wrap}>{''.join(items)}</{wrap}>" if items else ""
    if tag == "item":
        return f"<li>{inner}</li>" if inner.strip() else ""
    if tag == "caption":
        return f"<caption>{inner}</caption>" if inner.strip() else ""
    if tag == "content":
        style = (el.get("styleCode") or "").lower()
        if not inner:
            return ""
        if "bold" in style:
            inner = f"<strong>{inner}</strong>"
        if "italics" in style or "italic" in style:
            inner = f"<em>{inner}</em>"
        if "underline" in style:
            inner = f"<u>{inner}</u>"
        return inner
    if tag == "table":
        return f"<table>{inner}</table>" if inner.strip() else ""
    if tag in {"thead", "tbody", "tr", "sub", "sup"}:
        return f"<{tag}>{inner}</{tag}>" if inner.strip() else ""
    if tag in {"td", "th"}:
        return f"<{tag}{_safe_cell_attrs(el)}>{inner}</{tag}>" if inner.strip() else ""
    if tag == "linkHtml":
        href = (el.get("href") or "").strip()
        if href.startswith("#"):
            target = ctx.link_targets.get(href[1:])
            if target:
                return f'<a href="#{target}">{inner}</a>' if inner.strip() else ""
        return inner
    if tag == "renderMultiMedia":
        return ""
    if tag == "br":
        return "<br>"
    return inner


def _safe_cell_attrs(el: etree._Element) -> str:
    attrs = ""
    colspan = el.get("colspan")
    rowspan = el.get("rowspan")
    if colspan:
        attrs += f' colspan="{html.escape(colspan)}"'
    if rowspan:
        attrs += f' rowspan="{html.escape(rowspan)}"'
    return attrs


def _caption_inner(el: etree._Element) -> str:
    parts: list[str] = []
    if el.text:
        parts.append(html.escape(el.text))
    for child in el:
        parts.append(_caption_inner(child) if _local(child.tag) == "caption" else _fallback_inner(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    return "".join(parts)


def _item_inner(el: etree._Element) -> str:
    parts: list[str] = []
    if el.text:
        parts.append(html.escape(el.text))
    for child in el:
        parts.append(_fallback_inner(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    return "".join(parts)


def _fallback_inner(el: etree._Element) -> str:
    parts: list[str] = []
    if el.text:
        parts.append(html.escape(el.text))
    for child in el:
        parts.append(_fallback_inner(child))
        if child.tail:
            parts.append(html.escape(child.tail))
    return "".join(parts)


def _caption_inner_with_ctx(el: etree._Element, ctx: _RenderContext) -> str:
    clone = etree.fromstring(etree.tostring(el))
    return _replace_inner_rendering(clone, ctx, _caption_inner)


def _item_inner_with_ctx(el: etree._Element, ctx: _RenderContext) -> str:
    clone = etree.fromstring(etree.tostring(el))
    return _replace_inner_rendering(clone, ctx, _item_inner)


def _replace_inner_rendering(el: etree._Element, ctx: _RenderContext, fallback) -> str:
    if not any(_local(child.tag) in {"linkHtml", "renderMultiMedia", "content", "sub", "sup"} for child in el.iterdescendants() if isinstance(child.tag, str)):
        return fallback(el)
    parts: list[str] = []
    if el.text:
        parts.append(html.escape(el.text))
    parts.append(_render_children(el, ctx))
    return "".join(parts)


def _render_multimedia(el: etree._Element, next_sibling: Optional[etree._Element], ctx: _RenderContext) -> tuple[str, bool]:
    media_id = (el.get("referencedObject") or "").strip()
    filename = ctx.media_map.get(media_id)
    if not filename:
        logger.warning(
            "Professional SPL multimedia reference unresolved (spl_set_id=%s, referencedObject=%s)",
            ctx.spl_set_id,
            media_id,
        )
        return "", False
    caption_text = ""
    consumed_caption = False
    if next_sibling is not None and _local(next_sibling.tag) == "caption":
        caption_text = _normalize_text("".join(next_sibling.itertext()))
        consumed_caption = True
    alt = html.escape(caption_text or "Figure from prescribing information")
    src = html.escape(_DAILYMED_IMAGE_URL.format(spl_set_id=ctx.spl_set_id, filename=filename))
    figure_parts = [
        '<figure class="pro-figure my-4">',
        f'<img src="{src}" alt="{alt}" loading="lazy" />',
    ]
    if caption_text:
        figure_parts.append(
            f'<figcaption class="text-sm text-slate-500 italic mt-2 text-center">{html.escape(caption_text)}</figcaption>'
        )
    figure_parts.append("</figure>")
    return "".join(figure_parts), consumed_caption


def _render_text(text_el: etree._Element, ctx: _RenderContext) -> str:
    parts: list[str] = []
    if text_el.text and text_el.text.strip():
        parts.append(f"<p>{html.escape(text_el.text)}</p>")
    blocks = _unwrap_outer_layout_blocks(text_el)
    index = 0
    while index < len(blocks):
        child = blocks[index]
        if _should_drop_contents_node(child):
            index += 1
            continue
        next_sibling = blocks[index + 1] if index + 1 < len(blocks) else None
        if _local(child.tag) == "renderMultiMedia":
            figure_html, consumed_caption = _render_multimedia(child, next_sibling, ctx)
            if figure_html:
                parts.append(figure_html)
            if consumed_caption:
                index += 2
                continue
            index += 1
            continue
        rendered = _render_node(child, ctx)
        if rendered:
            parts.append(rendered)
        if child.tail:
            tail_paragraph = _paragraph_from_text(child.tail)
            if tail_paragraph is not None and not _is_dash_or_empty_paragraph(tail_paragraph):
                tail_rendered = _render_node(tail_paragraph, ctx)
                if tail_rendered:
                    parts.append(tail_rendered)
        index += 1
    return "".join(parts)


def _render_section(section: etree._Element, *, slug: str, heading: str, ctx: _RenderContext, depth: int = 0) -> str:
    parts: list[str] = []
    title_el = section.find(f"{_NS}title")
    if depth == 0:
        parts.append(f'<section><h2 id="{slug}">{html.escape(heading)}</h2>')
    elif title_el is not None:
        title_html = _render_title(title_el, ctx)
        title_text = _normalize_text("".join(title_el.itertext()))
        if title_html.strip() and title_text:
            heading_level = min(2 + depth, 6)
            anchor = ctx.section_anchors.get(_section_path(section))
            id_attr = f' id="{anchor}"' if anchor else ""
            parts.append(f"<h{heading_level}{id_attr}>{title_html}</h{heading_level}>")

    for child in _iter_section_children(section):
        child_tag = _local(child.tag)
        if child_tag in {"code", "title"}:
            continue
        if child_tag == "text":
            parts.append(_render_text(child, ctx))
            continue
        if child_tag == "component":
            for grandchild in _iter_section_children(child):
                if _local(grandchild.tag) == "section":
                    parts.append(_render_section(grandchild, slug=slug, heading=heading, ctx=ctx, depth=depth + 1))
                else:
                    gc_html = _render_node(grandchild, ctx)
                    if gc_html.strip():
                        parts.append(gc_html)
            continue
        child_html = _render_node(child, ctx)
        if child_html.strip():
            parts.append(child_html)

    if depth == 0:
        parts.append("</section>")
    return "".join(parts)


def _render_title(title_el: etree._Element, ctx: _RenderContext) -> str:
    parts: list[str] = []
    if title_el.text:
        parts.append(html.escape(title_el.text))
    parts.append(_render_children(title_el, ctx))
    return "".join(parts)


def _render_highlights(section: etree._Element, ctx: _RenderContext, revision_date: Optional[str]) -> Optional[str]:
    body_parts: list[str] = []
    for child in _iter_section_children(section):
        child_tag = _local(child.tag)
        if child_tag in {"code", "title"}:
            continue
        if child_tag == "text":
            body_parts.append(_render_text(child, ctx))
            continue
        if child_tag == "component":
            for grandchild in _iter_section_children(child):
                if _local(grandchild.tag) == "section":
                    body_parts.append(_render_section(grandchild, slug="highlights", heading="Highlights of Prescribing Information", ctx=ctx, depth=1))
                else:
                    html_fragment = _render_node(grandchild, ctx)
                    if html_fragment.strip():
                        body_parts.append(html_fragment)
            continue
        child_html = _render_node(child, ctx)
        if child_html.strip():
            body_parts.append(child_html)

    inner = "".join(body_parts)
    if not _is_meaningful_html(inner):
        return None
    inner = strip_leading_bullets_from_html(inner)
    inner = _linkify_section_refs(inner)
    meta_html = f'<span class="pro-highlights-meta">{html.escape(revision_date)}</span>' if revision_date else ""
    return _sanitize_html(
        '<div class="pro-highlights">'
        '<div class="pro-highlights-header">'
        '<span class="pro-highlights-title">Highlights of Prescribing Information</span>'
        f'{meta_html}'
        '</div>'
        f'<div class="pro-highlights-body">{inner}</div>'
        '</div>'
    )


async def fetch_professional_rendered(spl_set_id: str) -> Optional[ProfessionalRendered]:
    spl_set_id = (spl_set_id or "").strip()
    if not spl_set_id:
        return None

    logger.info("fetch_professional_html start spl_set_id=%s", spl_set_id)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(_DAILYMED_SPL_XML_URL.format(spl_set_id=spl_set_id))
        if response.status_code >= 400:
            return None

        parser = etree.XMLParser(recover=True)
        xml_tree = etree.fromstring(response.content, parser=parser)

        selected_sections: list[tuple[etree._Element, str, str, str]] = []
        indexed_sections: list[tuple[etree._Element, str]] = []
        for code, slug, short_label, heading in PRO_SECTIONS:
            section = _find_section_by_code(xml_tree, code)
            if section is None:
                continue
            selected_sections.append((section, slug, short_label, heading))
            indexed_sections.append((section, slug))

        if not selected_sections:
            logger.warning(
                "fetch_professional_html no matching professional sections spl_set_id=%s",
                spl_set_id,
            )
            return None

        section_anchors, link_targets = _build_section_anchor_maps(indexed_sections)
        ctx = _RenderContext(
            spl_set_id=spl_set_id,
            media_map=_build_media_map(xml_tree),
            link_targets=link_targets,
            section_anchors=section_anchors,
        )
        revision_date = _format_revision_date(xml_tree)
        highlights_html: Optional[str] = None
        article_parts: list[str] = []
        rendered_sections: list[tuple[str, str]] = []

        for section, slug, short_label, heading in selected_sections:
            if slug == "highlights":
                highlights_html = _render_highlights(section, ctx, revision_date)
                continue
            rendered = _render_section(section, slug=slug, heading=heading, ctx=ctx)
            if slug == "boxed-warning":
                rendered = _strip_section_refs(rendered)
                rendered = _promote_warning_paragraphs_to_h3(rendered)
            rendered = strip_leading_bullets_from_html(rendered)
            if slug == "boxed-warning":
                rendered = _dedupe_boxed_warning_html(rendered)
            rendered = _linkify_section_refs(rendered)
            sanitized = _strip_dash_empty_paragraphs_html(_sanitize_html(rendered))
            if not _is_meaningful_html(sanitized):
                continue
            if slug == "boxed-warning":
                sanitized = (
                    '<aside class="pro-boxed-warning-callout" role="note" aria-label="Boxed Warning">'
                    '<div class="pro-boxed-warning-label">⚠️ Boxed Warning</div>'
                    f"{sanitized}"
                    "</aside>"
                )
            article_parts.append(sanitized)
            rendered_sections.append((slug, short_label))

        article_html = "\n".join(article_parts).strip()
        if not article_html:
            return None

        rendered = ProfessionalRendered(
            article_html=article_html,
            highlights_html=highlights_html,
            sections=rendered_sections,
        )
        logger.info(
            "fetch_professional_html done spl_set_id=%s sections=%d html_len=%d",
            spl_set_id,
            len(rendered_sections),
            len(article_html),
        )
        return rendered
    except Exception:
        logger.exception("fetch_professional_html failed for spl_set_id=%s", spl_set_id)
        if os.getenv("PRO_RAISE_ON_ERROR") == "1":
            raise
        return None


async def fetch_professional_html(spl_set_id: str) -> Optional[str]:
    rendered = await fetch_professional_rendered(spl_set_id)
    return rendered.article_html if rendered else None
