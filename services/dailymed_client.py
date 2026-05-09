"""Client for fetching patient-facing Medication Guide text from DailyMed XML API."""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from typing import Optional

import requests

logger = logging.getLogger(__name__)

DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}.xml"

# Section codes for genuine patient-facing documents only, in priority order:
# 42231-1 = SPL MEDGUIDE SECTION (dedicated FDA Medication Guide, e.g. Ritalin, Trazodone)
# 42230-3 = SPL PATIENT PACKAGE INSERT SECTION (e.g. Reyataz/Atazanavir)
# 42228-7 = Patient Package Insert older format (e.g. Amlodipine/Valsartan branded)
#
# Deliberately excluded:
# 34076-0 = "Information for Patients" — this is a prescriber-label subsection containing
#            clinical pregnancy risk summaries and counseling notes, NOT a patient guide.
# 42227-9 = alternate PPI code that also maps to prescriber-facing content in practice.
_MEDGUIDE_CODES = ("42231-1", "42230-3", "42228-7")


def _clean_text(raw: str) -> str:
    """Collapse whitespace in extracted XML text."""
    return re.sub(r"\s+", " ", raw).strip()


_SECTION_TAG = "{urn:hl7-org:v3}section"
_CODE_TAG = "{urn:hl7-org:v3}code"
_TITLE_TAG = "{urn:hl7-org:v3}title"
_PATIENT_TITLE_KEYWORDS = ("medication guide", "patient information")


def _extract_section_text(section: ET.Element) -> str:
    """Return cleaned text content of a section, or empty string."""
    return _clean_text("".join(section.itertext()))


def _find_section_by_code(tree: ET.Element, code: str) -> ET.Element | None:
    """Return the first ``<section>`` element whose ``<code code="...">`` matches.

    ``xml.etree.ElementTree`` has limited XPath support and does not support
    nested attribute predicates like ``section[code[@code='x']]``, so we
    iterate manually.
    """
    for section in tree.iter(_SECTION_TAG):
        code_el = section.find(_CODE_TAG)
        if code_el is not None and code_el.get("code") == code:
            return section
    return None


def _find_patient_subsection_in_section17(tree: ET.Element) -> ET.Element | None:
    """Look inside Section 17 (34076-0) for a child section titled as a patient guide.

    Some FDA labels (e.g. BENAZEPRIL HYDROCHLORIDE, THEOPHYLLINE) embed the
    patient-facing "Medication Guide" or "Patient Information" as a child
    subsection within Section 17 (Patient Counseling Information) rather than
    as a standalone top-level section.  This helper finds that subsection by
    matching the section title against known patient-guide keywords.

    Note: SPL XML wraps child sections inside ``<component>`` elements, so
    they are not direct ``<section>`` children of ``section17``.  We therefore
    use ``iter()`` to traverse all descendants rather than ``findall()`` which
    only finds direct children.
    """
    section17 = _find_section_by_code(tree, "34076-0")
    if section17 is None:
        return None
    for child in section17.iter(_SECTION_TAG):
        if child is section17:
            continue
        title_el = child.find(_TITLE_TAG)
        if title_el is not None and title_el.text:
            title_lower = title_el.text.strip().lower()
            if any(kw in title_lower for kw in _PATIENT_TITLE_KEYWORDS):
                return child
    return None


class DailyMedClient:
    """Synchronous client for DailyMed SPL XML patient guide retrieval."""

    def __init__(self, timeout: int = 10) -> None:
        self.timeout = timeout

    def fetch_patient_guide(self, spl_set_id: str) -> Optional[dict]:
        """Fetch patient-facing guide text for the given SPL Set ID.

        Tries dedicated patient-facing section codes only (42231-1, 42230-3,
        42228-7). Prescriber-facing sections such as 34076-0 (Information for
        Patients) are intentionally excluded as they contain clinical text not
        suitable for a patient medication guide.

        Args:
            spl_set_id: The SPL Set ID (UUID) for the drug label.

        Returns:
            A dict with key ``full_text`` containing the cleaned guide text,
            or ``None`` if the document is not found or contains no patient
            guide section.
        """
        url = DAILYMED_SPL_XML_URL.format(setid=spl_set_id)
        try:
            response = requests.get(url, timeout=self.timeout)
        except requests.RequestException as exc:
            logger.warning("DailyMed request failed for spl_set_id=%s: %s", spl_set_id, exc)
            return None

        if response.status_code == 404:
            logger.debug("DailyMed returned 404 for spl_set_id=%s", spl_set_id)
            return None

        if response.status_code >= 400:
            logger.warning(
                "DailyMed returned HTTP %s for spl_set_id=%s",
                response.status_code,
                spl_set_id,
            )
            return None

        try:
            tree = ET.fromstring(response.content)
        except ET.ParseError as exc:
            logger.warning("DailyMed XML parse error for spl_set_id=%s: %s", spl_set_id, exc)
            return None

        for code in _MEDGUIDE_CODES:
            section = _find_section_by_code(tree, code)
            if section is not None:
                cleaned = _extract_section_text(section)
                if cleaned:
                    logger.info(
                        "DailyMed section %s found for spl_set_id=%s (%d chars)",
                        code,
                        spl_set_id,
                        len(cleaned),
                    )
                    return {"full_text": cleaned}

        # Fallback: look for a patient guide subsection buried inside Section 17
        # (Patient Counseling Information, code 34076-0).  Some older labels
        # (e.g. BENAZEPRIL HYDROCHLORIDE, THEOPHYLLINE) place the patient-facing
        # "Medication Guide" or "Patient Information" here rather than in a
        # dedicated top-level section.
        section = _find_patient_subsection_in_section17(tree)
        if section is not None:
            cleaned = _extract_section_text(section)
            if cleaned:
                logger.info(
                    "DailyMed Section 17 subsection fallback used for spl_set_id=%s (%d chars)",
                    spl_set_id,
                    len(cleaned),
                )
                return {"full_text": cleaned}

        logger.debug("No patient guide section found in DailyMed XML for spl_set_id=%s", spl_set_id)
        return None
