"""Service for rendering the FDA patient Medication Guide section via the FDA XSLT engine.

Mirrors ``services.spl_professional`` but isolates only the patient-facing
medguide ``<section>`` subtree before rendering, so the consumer Medication
Guide tab shows the FDA-approved patient leaflet rather than the entire SPL.
"""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Optional

import httpx
from lxml import etree

from services.spl_professional import _get_transformer, _rewrite_relative_image_srcs

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


def _build_wrapper_document(section: etree._Element) -> etree._Element:
    """Wrap the selected medguide section in a minimal SPL document skeleton for XSLT."""
    nsmap = {None: _HL7_NS}
    doc = etree.Element(f"{_NS}document", nsmap=nsmap)
    component1 = etree.SubElement(doc, f"{_NS}component")
    body = etree.SubElement(component1, f"{_NS}structuredBody")
    component2 = etree.SubElement(body, f"{_NS}component")
    component2.append(deepcopy(section))
    return doc


async def fetch_medguide_html(spl_set_id: str) -> Optional[str]:
    """Fetch SPL XML, isolate the patient Medication Guide ``<section>``, render via FDA XSLT.

    Returns the rendered HTML string (with FDA stylesheet linked and DailyMed image
    URLs rewritten), or ``None`` on miss / failure.
    """
    spl_set_id = (spl_set_id or "").strip()
    if not spl_set_id:
        return None

    transformer = _get_transformer()
    if transformer is None:
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

        wrapper_doc = _build_wrapper_document(section)
        result = transformer(
            wrapper_doc,
            css=etree.XSLT.strparam("https://www.accessdata.fda.gov/spl/stylesheet/spl.css"),
        )
        html = etree.tostring(result, method="html", encoding="unicode")
        return _rewrite_relative_image_srcs(html, spl_set_id)
    except Exception as exc:
        logger.warning(
            "Failed to render medguide HTML for spl_set_id=%s: %s",
            spl_set_id,
            exc,
            exc_info=True,
        )
        return None
