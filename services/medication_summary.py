from __future__ import annotations

from html import escape
from typing import Any

from lxml import etree
from lxml import html as lxml_html

SUMMARY_SOURCE_NOTICE = (
    "No separate FDA Medication Guide was found for this label. "
    "This summary is based on FDA/DailyMed prescribing information."
)

SAFETY_NOTICE = (
    "This patient-friendly summary is based on FDA/DailyMed prescribing information. "
    "It is not a substitute for medical advice. "
    "Not every medication has a separate FDA Medication Guide."
)

MISSING_SECTION_FALLBACK = "The FDA/DailyMed label should be reviewed for complete details."

SUMMARY_QUESTIONS = [
    "What is this medication?",
    "What is this medication used for?",
    "What should I know before taking it?",
    "What important warnings are listed?",
    "How is this medication usually taken?",
    "What side effects are listed?",
    "What interactions are listed?",
    "Where can I find the official prescribing information?",
]


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text_value = str(value).strip()
    if not text_value:
        return ""
    if "<" in text_value and ">" in text_value:
        try:
            root = lxml_html.fromstring(f"<div>{text_value}</div>")
            text_value = " ".join(root.text_content().split())
        except (etree.ParserError, etree.XMLSyntaxError, ValueError, TypeError):
            text_value = " ".join(text_value.replace("<", " ").replace(">", " ").split())
    return " ".join(text_value.split())


def _truncate(text: str, limit: int = 700) -> str:
    stripped = text.strip()
    if len(stripped) <= limit:
        return stripped
    clipped = stripped[:limit]
    if " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0]
    if clipped.endswith((".", "!", "?")):
        return clipped
    return f"{clipped}."


def _first_non_empty(*values: Any) -> str:
    for value in values:
        cleaned = _clean_text(value)
        if cleaned:
            return cleaned
    return ""


def _extract_professional_section(professional_html: Any, keywords: tuple[str, ...]) -> str:
    html_text = _clean_text(professional_html)
    if not html_text:
        return ""

    try:
        root = lxml_html.fromstring(f"<div>{professional_html}</div>")
    except (etree.ParserError, etree.XMLSyntaxError, ValueError, TypeError):
        return ""

    heading_xpath = ".//h1|.//h2|.//h3|.//h4"
    heading_tags = {"h1", "h2", "h3", "h4"}

    for heading in root.xpath(heading_xpath):
        heading_text = " ".join(heading.text_content().lower().split())
        if not any(keyword in heading_text for keyword in keywords):
            continue

        parts: list[str] = []
        node = heading.getnext()
        while node is not None:
            if isinstance(node.tag, str) and node.tag.lower() in heading_tags:
                break
            parts.append(_clean_text(node.text_content()))
            node = node.getnext()

        section_text = " ".join(part for part in parts if part)
        if section_text:
            return section_text

    return ""


def _answer_or_fallback(text: str) -> str:
    cleaned = _truncate(text)
    return cleaned or MISSING_SECTION_FALLBACK


def generate_medication_summary(row: dict[str, Any]) -> tuple[dict[str, Any], str]:
    drug_name = _first_non_empty(
        row.get("brand_name"),
        row.get("generic_name"),
        row.get("display_name"),
        row.get("name"),
        "This medication",
    )

    professional_html = row.get("professional_html")

    used_for = _first_non_empty(
        row.get("uses"),
        _extract_professional_section(professional_html, ("indications", "usage", "use")),
    )
    before_taking = _first_non_empty(
        row.get("contraindications"),
        row.get("special_populations"),
        _extract_professional_section(professional_html, ("contraindications", "before", "do not")),
    )
    warnings = _first_non_empty(
        row.get("boxed_warning_html"),
        row.get("warnings"),
        _extract_professional_section(professional_html, ("warning", "caution")),
    )
    how_taken = _first_non_empty(
        row.get("dosage"),
        row.get("how_to_take"),
        _extract_professional_section(professional_html, ("dosage", "administration", "how supplied")),
    )
    side_effects = _first_non_empty(
        row.get("side_effects"),
        _extract_professional_section(professional_html, ("adverse", "side effect")),
    )
    interactions = _first_non_empty(
        row.get("interactions"),
        _extract_professional_section(professional_html, ("interaction",)),
    )

    source_url = _first_non_empty(row.get("source_url"), "https://dailymed.nlm.nih.gov/dailymed/")
    official_info = (
        f"Review the full prescribing information on DailyMed: {source_url}"
        if source_url
        else MISSING_SECTION_FALLBACK
    )

    qa_items = [
        {
            "question": SUMMARY_QUESTIONS[0],
            "answer": _answer_or_fallback(
                f"{drug_name} is described in FDA/DailyMed prescribing information. {SUMMARY_SOURCE_NOTICE}"
            ),
        },
        {"question": SUMMARY_QUESTIONS[1], "answer": _answer_or_fallback(used_for)},
        {"question": SUMMARY_QUESTIONS[2], "answer": _answer_or_fallback(before_taking)},
        {"question": SUMMARY_QUESTIONS[3], "answer": _answer_or_fallback(warnings)},
        {"question": SUMMARY_QUESTIONS[4], "answer": _answer_or_fallback(how_taken)},
        {"question": SUMMARY_QUESTIONS[5], "answer": _answer_or_fallback(side_effects)},
        {"question": SUMMARY_QUESTIONS[6], "answer": _answer_or_fallback(interactions)},
        {"question": SUMMARY_QUESTIONS[7], "answer": _answer_or_fallback(official_info)},
    ]

    summary_json = {
        "notice": SUMMARY_SOURCE_NOTICE,
        "safety_notice": SAFETY_NOTICE,
        "questions": qa_items,
    }

    sections = "".join(
        (
            f"<section class=\"summary-item\">"
            f"<h2>{escape(item['question'])}</h2>"
            f"<p>{escape(item['answer'])}</p>"
            "</section>"
        )
        for item in qa_items
    )
    summary_html = (
        f"<div class=\"medication-summary\">"
        f"<p>{escape(SUMMARY_SOURCE_NOTICE)}</p>"
        f"{sections}"
        "</div>"
    )

    return summary_json, summary_html
