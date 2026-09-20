"""IV administration card: drafted by AI from the FDA label, checked by machine, approved by a person.

Safety rails, in order:
1. The AI sees ONLY text cut from the drug's own DailyMed label (the sections about giving the drug).
2. Every stated fact must carry a quote. ``verify_card`` looks each quote up in that label text, word for
   word (only case and whitespace are ignored). A fact whose quote is not there is thrown away, so the
   AI cannot invent anything. The same check runs again whenever a reviewer saves or approves a card.
3. A card is a draft until a reviewer approves it in the admin; the public API never returns a draft.

Same idea as the Gemini second reader for pill photos (services/ai_reader.py), whose key and endpoint it shares.
"""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

import requests

from services.ai_reader import API, MODELS, api_key

logger = logging.getLogger(__name__)

DAILYMED_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}.xml"
DEFAULT_MODEL = "gemini-3.1-pro-preview"  # the careful one: a wrong push rate is not worth the saved cent
AI_TIMEOUT_S = 120
LABEL_TIMEOUT_S = 60
MAX_LABEL_CHARS = 60_000
QUOTE_MIN, QUOTE_MAX, VALUE_MAX = 25, 400, 200
STATUSES = ("stated", "not_stated", "not_applicable")

# key -> the question it answers (the prompt and the admin screen both read this)
CARD_FIELDS: Dict[str, str] = {
    "iv_push": "May it be given as a direct IV push or bolus, and how fast? If the label forbids it, say so.",
    "infusion_rate_time": "Usual infusion time and any maximum rate.",
    "reconstitution": "Which diluent, how much, and the resulting concentration.",
    "dilution": "Which fluids, and the final volume or concentration.",
    "filter": "Is a filter required or recommended, and what size.",
    "light_protection": "Must it be protected from light.",
    "line_and_site": "Central or peripheral line, extravasation or irritant warnings, site rotation.",
    "storage_unopened": "Storage of the unopened product.",
    "stability_after_mixing": "How long it keeps after reconstitution or dilution, and at what temperature.",
    "incompatibilities": "Drugs or fluids the label says not to mix with.",
    "monitoring": "What to watch during or right after the infusion.",
}

_NS = "{urn:hl7-org:v3}"
# LOINC codes of the label sections a card is built from
_WANTED_SECTIONS = {
    "34066-1": "Boxed warning",
    "34068-7": "Dosage and administration",
    "34069-5": "How supplied / storage",
    "44425-7": "Storage and handling",
    "59845-8": "Instructions for use",
}
_WARNING_SECTIONS = {"43685-7", "34071-1", "42232-9"}  # warnings and precautions / warnings / precautions
# old-format labels keep these under an unclassified code, so they are found by their title
_WANTED_TITLE_RE = re.compile(r"compatib|stabilit|storage|how supplied|preparation|directions for use|administration", re.I)
_WARNING_LINE_RE = re.compile(
    r"extravasat|vesicant|necrosis|infiltrat|infusion[- ]related|infusion reaction|central (venous|line)|"
    r"rapid (iv|intravenous|injection|administration|infusion)|too rapid|bolus|phlebitis|filter|protect(ed)? from light",
    re.I,
)
_BLOCK_TAGS = {"paragraph", "item", "title", "tr", "caption", "br", "list", "table"}


class CardError(Exception):
    """The card could not be drafted; the message is safe to show in the admin."""


# ---------------------------------------------------------------------------
# Label text
# ---------------------------------------------------------------------------


def _text_of(element) -> str:
    parts: List[str] = []

    def walk(node) -> None:
        tag = node.tag.replace(_NS, "")
        if tag in _BLOCK_TAGS:
            parts.append("\n")
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tail:
                parts.append(child.tail)
        if tag in ("td", "th"):
            parts.append(" | ")

    walk(element)
    text_value = re.sub(r"[ \t]+", " ", "".join(parts).replace("\xa0", " "))
    return re.sub(r"\s*\n\s*", "\n", text_value).strip()


def label_sections(xml: bytes) -> List[Dict[str, str]]:
    """The parts of a DailyMed label that say how to give the drug, as plain text."""
    root = ET.fromstring(xml)
    body = root.find(f"{_NS}component/{_NS}structuredBody")
    if body is None:
        return []
    sections: List[Dict[str, str]] = []
    warning_lines: List[str] = []
    for component in body.findall(f"{_NS}component"):
        section = component.find(f"{_NS}section")
        if section is None:
            continue
        code_el = section.find(f"{_NS}code")
        code = code_el.get("code") if code_el is not None else ""
        title_el = section.find(f"{_NS}title")
        title = _text_of(title_el) if title_el is not None else ""
        if code in _WANTED_SECTIONS:
            sections.append({"name": _WANTED_SECTIONS[code], "text": _text_of(section)})
        elif code in _WARNING_SECTIONS:
            warning_lines += [
                line for line in _text_of(section).split("\n") if _WARNING_LINE_RE.search(line) and 40 < len(line) < 1200
            ]
        elif title and _WANTED_TITLE_RE.search(title):
            sections.append({"name": title.title()[:80], "text": _text_of(section)})
    if warning_lines:
        sections.append(
            {"name": "Warnings (only lines about giving the drug)", "text": "\n".join(dict.fromkeys(warning_lines))}
        )
    return [s for s in sections if s["text"]]


def fetch_label_sections(spl_set_id: str) -> List[Dict[str, str]]:
    try:
        response = requests.get(
            DAILYMED_XML_URL.format(setid=spl_set_id),
            headers={"User-Agent": "Mozilla/5.0 (PillSeek IV card)"},
            timeout=LABEL_TIMEOUT_S,
        )
    except requests.RequestException as exc:
        raise CardError("DailyMed did not answer. Try again in a minute.") from exc
    if response.status_code != 200:
        raise CardError(f"DailyMed returned {response.status_code} for this label.")
    sections = label_sections(response.content)
    if not sections:
        raise CardError("This label has no dosage or storage section to build a card from.")
    return sections


# ---------------------------------------------------------------------------
# The quote check
# ---------------------------------------------------------------------------


def _norm(value: str) -> str:
    value = value.replace("\xa0", " ").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", value).strip().lower()


def verify_card(fields: Dict[str, Any], sections: List[Dict[str, str]]) -> Dict[str, Any]:
    """Clean card fields: every quote that survives is in the label word for word.

    A stated fact with no surviving quote, or an over-long value, becomes ``not_stated`` and is listed in
    ``rejected`` so the reviewer sees what the machine threw out.
    """
    haystack = _norm(" \n ".join(s["text"] for s in sections))
    clean: Dict[str, Dict[str, Any]] = {}
    rejected: List[str] = []
    quotes_checked = 0
    for key in CARD_FIELDS:
        raw = fields.get(key) if isinstance(fields.get(key), dict) else {}
        status = raw.get("status") if raw.get("status") in STATUSES else "not_stated"
        value = str(raw.get("value") or "").strip()
        quotes = []
        for quote in raw.get("quotes") or []:
            text_value = str((quote or {}).get("text") or "").strip()
            quotes_checked += 1
            if QUOTE_MIN <= len(text_value) <= QUOTE_MAX and _norm(text_value) in haystack:
                quotes.append({"section": str(quote.get("section") or "")[:120], "text": text_value})
        if status in ("stated", "not_applicable") and (not quotes or not value or len(value) > VALUE_MAX):
            rejected.append(key)
            status = "not_stated"
        if status == "not_stated":
            value, quotes = "", []
        clean[key] = {"status": status, "value": value, "quotes": quotes}
    return {"fields": clean, "rejected": rejected, "quotes_checked": quotes_checked}


# ---------------------------------------------------------------------------
# The AI draft
# ---------------------------------------------------------------------------


def build_prompt(drug_name: str, sections: List[Dict[str, str]]) -> str:
    label_text = "\n\n".join(f"=== SECTION: {s['name']} ===\n{s['text']}" for s in sections)[:MAX_LABEL_CHARS]
    questions = "\n".join(f'- "{key}": {question}' for key, question in CARD_FIELDS.items())
    return (
        f"You fill an IV administration card for nurses about {drug_name}, using ONLY the FDA label text below.\n\n"
        "Rules:\n"
        "1. Use only the label text. No outside knowledge, no memory of the drug, no guessing.\n"
        "2. Every stated fact needs at least one quote: ONE continuous span copied character for character from a "
        f"section (same words, numbers and punctuation; no '...', no fixing typos), {QUOTE_MIN} to {QUOTE_MAX} characters. "
        "A program checks each quote against the label and throws away any fact whose quote is not found.\n"
        '3. If the label does not say it: "status": "not_stated", empty value, no quotes. If the question does not apply '
        '(e.g. reconstitution of a ready-to-use solution): "status": "not_applicable", a short value saying why, and a quote showing it.\n'
        f"4. value: plain English for a nurse, at most 160 characters, nothing the quotes do not support; keep the label's "
        "numbers and units exactly.\n"
        "5. Adult intravenous use only. Ignore intramuscular, subcutaneous, epidural, oral and paediatric details unless "
        "the label gives nothing else, and then say so in the value.\n\n"
        f"Fields:\n{questions}\n\n"
        'Reply with JSON only: {"fields": {"<key>": {"status": "stated|not_stated|not_applicable", "value": "...", '
        '"quotes": [{"section": "<section name>", "text": "..."}]}, ...all 11 keys...}, '
        '"notes_for_reviewer": "anything odd about this label, e.g. it is a premixed bag, or has no adult dosing"}\n\n'
        f"FDA LABEL TEXT:\n{label_text}"
    )


def ask_ai(prompt: str, model: str = DEFAULT_MODEL) -> Dict[str, Any]:
    key = api_key()
    if not key:
        raise CardError("GEMINI_API_KEY is not set on this server, so a card cannot be drafted here.")
    if model not in MODELS:
        model = DEFAULT_MODEL
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    try:
        # The key travels in a header, never in the URL, so it cannot end up in logs.
        response = requests.post(API.format(model=model), headers={"x-goog-api-key": key}, json=body, timeout=AI_TIMEOUT_S)
    except requests.RequestException as exc:
        raise CardError("The AI service did not answer. Try again.") from exc
    if response.status_code != 200:
        logger.warning("iv card: AI HTTP %s %s", response.status_code, response.text[:200])
        raise CardError(f"The AI service returned {response.status_code}.")
    try:
        parts = response.json()["candidates"][0]["content"]["parts"]
        reply = json.loads("".join(p.get("text", "") for p in parts))
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise CardError("The AI reply could not be read. Try again.") from exc
    if not isinstance(reply, dict) or not isinstance(reply.get("fields"), dict):
        raise CardError("The AI reply had no card in it. Try again.")
    return reply


def draft_card(drug_name: str, spl_set_id: str, model: str = DEFAULT_MODEL) -> Dict[str, Any]:
    """A machine-checked draft, ready to store in iv_drugs.card."""
    sections = fetch_label_sections(spl_set_id)
    reply = ask_ai(build_prompt(drug_name, sections), model)
    checked = verify_card(reply["fields"], sections)
    return {
        "fields": checked["fields"],
        "notes_for_reviewer": str(reply.get("notes_for_reviewer") or "")[:1000],
        "rejected_by_check": checked["rejected"],
        "quotes_checked": checked["quotes_checked"],
        "source": model if model in MODELS else DEFAULT_MODEL,
        "label_setid": spl_set_id,
    }


def recheck_card(card: Optional[Dict[str, Any]], spl_set_id: str) -> Dict[str, Any]:
    """Run the quote check again on a card a reviewer edited (before saving or approving it)."""
    card = card or {}
    checked = verify_card(card.get("fields") or {}, fetch_label_sections(spl_set_id))
    return {
        **{k: v for k, v in card.items() if k not in ("fields", "rejected_by_check", "quotes_checked")},
        "fields": checked["fields"],
        "rejected_by_check": checked["rejected"],
        "quotes_checked": checked["quotes_checked"],
        "label_setid": spl_set_id,
    }
