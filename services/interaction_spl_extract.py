from __future__ import annotations

from typing import Optional

from lxml import etree
from lxml import html as lxml_html


def _tag_name(node: etree._Element) -> str:
    if not isinstance(node.tag, str):
        return ""
    return node.tag.rsplit("}", 1)[-1].lower()


def _plain_text(nodes: list[etree._Element]) -> str:
    chunks: list[str] = []
    for node in nodes:
        text = " ".join("".join(node.itertext()).split()).strip()
        if text:
            chunks.append(text)
    return "\n".join(chunks).strip()


def extract_targeted_paragraph(section_html: str, candidate_names: set[str]) -> Optional[str]:
    """
    Given the HTML of a drug-interactions SPL section and a set of lowercase
    candidate names, return the plain text of the paragraph block(s) that
    mention any candidate name.
    """
    if not isinstance(section_html, str) or not section_html.strip():
        return None

    normalized_candidates = {
        str(name or "").strip().lower()
        for name in (candidate_names or set())
        if str(name or "").strip()
    }
    if not normalized_candidates:
        return None

    try:
        root = lxml_html.fragment_fromstring(section_html, create_parent="div")
    except (etree.ParserError, etree.XMLSyntaxError, TypeError, ValueError):
        return None

    container = next((node for node in root if _tag_name(node) == "section"), root)
    children = [node for node in container if isinstance(node.tag, str)]
    heading_tags = {"h3", "h4"}
    body_tags = {"p", "ul", "li"}
    blocks: list[list[etree._Element]] = []

    if any(_tag_name(node) in heading_tags for node in children):
        i = 0
        while i < len(children):
            tag = _tag_name(children[i])
            if tag not in heading_tags:
                i += 1
                continue
            block = [children[i]]
            i += 1
            while i < len(children) and _tag_name(children[i]) not in heading_tags:
                if _tag_name(children[i]) in body_tags:
                    block.append(children[i])
                i += 1
            blocks.append(block)
    else:
        blocks = [[node] for node in children if _tag_name(node) == "p"]

    matches: list[str] = []
    for block in blocks:
        block_text = _plain_text(block)
        lowered = block_text.lower()
        if block_text and any(name in lowered for name in normalized_candidates):
            matches.append(block_text)

    if not matches:
        return None
    return "\n".join(matches).strip()
