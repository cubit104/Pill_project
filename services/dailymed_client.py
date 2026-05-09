"""Client for fetching patient-facing Medication Guide text from DailyMed XML API."""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from typing import Optional

import requests

logger = logging.getLogger(__name__)

DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{setid}.xml"

# Section codes in priority order:
# 42231-1 = SPL MEDGUIDE SECTION (dedicated FDA Medication Guide, highest priority)
# 42230-3 = SPL PATIENT PACKAGE INSERT SECTION
# 42228-7 = Patient Package Insert (older format, e.g. Amlodipine/Valsartan)
# 34076-0 = Information for Patients
# 42227-9 = Patient Package Insert (alternate code used by some manufacturers)
_MEDGUIDE_CODES = ("42231-1", "42230-3", "42228-7", "34076-0", "42227-9")


def _clean_text(raw: str) -> str:
    """Collapse whitespace in extracted XML text."""
    return re.sub(r"\s+", " ", raw).strip()


_SECTION_TAG = "{urn:hl7-org:v3}section"
_CODE_TAG = "{urn:hl7-org:v3}code"


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


class DailyMedClient:
    """Synchronous client for DailyMed SPL XML patient guide retrieval."""

    def __init__(self, timeout: int = 10) -> None:
        self.timeout = timeout

    def fetch_patient_guide(self, spl_set_id: str) -> Optional[dict]:
        """Fetch patient-facing guide text for the given SPL Set ID.

        Tries each patient-facing section code in priority order: 42231-1
        (SPL MEDGUIDE SECTION), 42230-3 (SPL PATIENT PACKAGE INSERT),
        42228-7 (Patient Package Insert, older format), 34076-0 (Information
        for Patients), and 42227-9 (Patient Package Insert, alternate code).

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
                raw_text = "".join(section.itertext())
                cleaned = _clean_text(raw_text)
                if cleaned:
                    logger.debug(
                        "DailyMed section %s found for spl_set_id=%s (%d chars)",
                        code,
                        spl_set_id,
                        len(cleaned),
                    )
                    return {"full_text": cleaned}

        logger.debug("No patient guide section found in DailyMed XML for spl_set_id=%s", spl_set_id)
        return None
