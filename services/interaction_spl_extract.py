from __future__ import annotations

import re
from typing import Optional

from lxml import etree
from lxml import html as lxml_html

_MAX_EXTRACT_CHARS = 800


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


def _clean_spl_text(text: str) -> str:
    # Remove [see XYZ (N.N)] cross-references
    text = re.sub(r'\[see[^\]]*\]', '', text, flags=re.IGNORECASE)
    # Remove bare parenthetical section numbers like ( 7.1 ) or (12.3)
    text = re.sub(r'\(\s*\d+\.\d+\s*\)', '', text)
    # Remove leading section number prefixes like "7.2 " or "7 "
    text = re.sub(r'^\s*\d+(\.\d+)?\s+', '', text, flags=re.MULTILINE)
    # Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)
    # Collapse multiple newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _candidate_occurrences(text: str, candidate_names: set[str]) -> int:
    lowered = text.lower()
    return sum(lowered.count(name) for name in candidate_names)


def _extract_by_sentence(full_text: str, candidate_names: set[str], max_sentences: int = 5) -> Optional[str]:
    sentences = re.split(r'(?<=[.!?])\s+', full_text.strip())
    matching_indices = [
        idx
        for idx, sentence in enumerate(sentences)
        if any(name in sentence.lower() for name in candidate_names)
    ]
    if not matching_indices:
        return None

    start = max(0, matching_indices[0] - 1)
    end = min(len(sentences), matching_indices[-1] + 2)
    window = sentences[start:end]
    if len(window) > max_sentences:
        window = window[:max_sentences]

    result = " ".join(window).strip()
    return result or None


def _cap_text(text: str, max_chars: int = _MAX_EXTRACT_CHARS) -> str:
    cleaned = (text or "").strip()
    if len(cleaned) <= max_chars:
        return cleaned

    clipped = cleaned[:max_chars].rstrip()
    sentence_end = max(clipped.rfind("."), clipped.rfind("!"), clipped.rfind("?"))
    if sentence_end > 0:
        return clipped[: sentence_end + 1].strip()
    return clipped


def extract_targeted_paragraph(section_html: str, candidate_names: set[str]) -> Optional[str]:
    """
    Given the HTML of a drug-interactions SPL section and a set of lowercase
    candidate names, return the plain text of the paragraph block(s) that
    mention any candidate name.

    Args:
        section_html: HTML content for the SPL drug-interactions section.
        candidate_names: Lowercased drug names/synonyms to match.
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
    has_heading_structure = any(_tag_name(node) in heading_tags for node in children)

    if has_heading_structure:
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
        fallback_blocks = [[node] for node in children if _tag_name(node) in body_tags]
        scored_blocks: list[tuple[int, str, list[etree._Element]]] = []
        for block in fallback_blocks:
            block_text = _plain_text(block)
            if not block_text:
                continue
            score = _candidate_occurrences(block_text, normalized_candidates)
            if score > 0:
                scored_blocks.append((score, block_text, block))
        if scored_blocks:
            densest_score = max(score for score, _, _ in scored_blocks)
            blocks = [
                block
                for score, block_text, block in scored_blocks
                if score == densest_score and (score > 1 or len(block_text) < 600)
            ]
            if not blocks:
                blocks = [
                    block
                    for score, block_text, block in scored_blocks
                    if score > 1 or len(block_text) < 600
                ]
        else:
            blocks = []

    matches: list[str] = []
    for block in blocks:
        block_text = _clean_spl_text(_plain_text(block))
        lowered = block_text.lower()
        if block_text and any(name in lowered for name in normalized_candidates):
            matches.append(block_text)

    if not matches:
        if not has_heading_structure:
            sentence_match = _extract_by_sentence(
                _clean_spl_text(_plain_text([container])),
                normalized_candidates,
            )
            if sentence_match:
                return _cap_text(sentence_match) or None
        return None
    return _cap_text("\n".join(matches)) or None
