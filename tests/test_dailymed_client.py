"""Unit tests for services.dailymed_client."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services.dailymed_client import DailyMedClient


def _xml_with_section(code: str, text: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="{code}" codeSystem="2.16.840.1.113883.6.1"/>
          <title>Medication Guide</title>
          <text><paragraph>{text}</paragraph></text>
        </section>
      </component>
    </structuredBody>
  </component>
</document>""".encode()


def _xml_no_patient_sections() -> bytes:
    return b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="34090-1" codeSystem="2.16.840.1.113883.6.1"/>
          <text><paragraph>Clinical pharmacology only.</paragraph></text>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""


def _mock_response(status_code: int, content: bytes) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.content = content
    return resp


def test_fetch_patient_guide_medguide_section():
    """Returns full_text when section 42231-1 (SPL MEDGUIDE SECTION) is present."""
    client = DailyMedClient()
    xml_content = _xml_with_section("42231-1", "Take this medicine exactly as prescribed.")

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("abc-123")

    assert result is not None
    assert "Take this medicine exactly as prescribed." in result["full_text"]


def test_fetch_patient_guide_falls_back_to_patient_package_insert():
    """Falls back to section 42230-3 when 42231-1 is absent."""
    client = DailyMedClient()
    xml_content = _xml_with_section("42230-3", "Read this leaflet carefully.")

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("def-456")

    assert result is not None
    assert "Read this leaflet carefully." in result["full_text"]


def test_fetch_patient_guide_returns_none_on_404():
    """Returns None when DailyMed returns 404."""
    client = DailyMedClient()

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(404, b"")):
        result = client.fetch_patient_guide("not-found")

    assert result is None


def test_fetch_patient_guide_returns_none_on_5xx():
    """Returns None on server errors."""
    client = DailyMedClient()

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(500, b"error")):
        result = client.fetch_patient_guide("bad-server")

    assert result is None


def test_fetch_patient_guide_returns_none_on_network_error():
    """Returns None when a network error occurs."""
    import requests as req_lib

    client = DailyMedClient()

    with patch("services.dailymed_client.requests.get", side_effect=req_lib.RequestException("timeout")):
        result = client.fetch_patient_guide("error-id")

    assert result is None


def test_fetch_patient_guide_returns_none_when_no_patient_sections():
    """Returns None when XML has no patient guide sections."""
    client = DailyMedClient()

    with patch(
        "services.dailymed_client.requests.get",
        return_value=_mock_response(200, _xml_no_patient_sections()),
    ):
        result = client.fetch_patient_guide("no-sections")

    assert result is None


def test_fetch_patient_guide_returns_none_on_invalid_xml():
    """Returns None when XML is malformed."""
    client = DailyMedClient()

    with patch(
        "services.dailymed_client.requests.get",
        return_value=_mock_response(200, b"<not valid xml <<"),
    ):
        result = client.fetch_patient_guide("bad-xml")

    assert result is None


def test_fetch_patient_guide_cleans_whitespace():
    """Whitespace in extracted text is collapsed to single spaces."""
    client = DailyMedClient()
    xml_content = _xml_with_section("42231-1", "Take   this\n\n  medicine.")

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("ws-test")

    assert result is not None
    # Multiple spaces and newlines should be collapsed
    assert "  " not in result["full_text"]
    assert "\n" not in result["full_text"]


def test_fetch_patient_guide_ignores_42228_7_pregnancy_section():
    """Section 42228-7 (maps to pregnancy sections) is NOT treated as a patient guide."""
    client = DailyMedClient()
    # This code now maps to "8.1 Pregnancy" in many labels — not a patient guide.
    xml_content = _xml_with_section("42228-7", "8.1 Pregnancy: Risk summary for prescribers.")

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("amlodipine-set-id")

    assert result is None


def test_fetch_patient_guide_falls_back_to_information_for_patients():
    """Falls back to a subsection within Section 17 (34076-0) when its title contains 'Medication Guide'."""
    client = DailyMedClient()
    # Simulate a label where the patient guide lives as a child of Section 17
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="34076-0" codeSystem="2.16.840.1.113883.6.1"/>
          <title>Patient Counseling Information</title>
          <text><paragraph>Counsel patients about fetal risk.</paragraph></text>
          <component>
            <section>
              <title>Medication Guide</title>
              <text><paragraph>Information for patients taking this drug.</paragraph></text>
            </section>
          </component>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("theophylline-set-id")

    assert result is not None
    assert "Information for patients taking this drug." in result["full_text"]


def test_fetch_patient_guide_falls_back_to_alternate_ppi_code():
    """Falls back to a subsection within Section 17 (34076-0) when its title contains 'Patient Information'."""
    client = DailyMedClient()
    # Simulate a label where the patient guide lives as a child of Section 17 with a "Patient Information" title
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="34076-0" codeSystem="2.16.840.1.113883.6.1"/>
          <title>Patient Counseling Information</title>
          <text><paragraph>Clinical counseling notes for prescribers.</paragraph></text>
          <component>
            <section>
              <title>Patient Information</title>
              <text><paragraph>Patient package insert alternate code text.</paragraph></text>
            </section>
          </component>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("minocycline-set-id")

    assert result is not None
    assert "Patient package insert alternate code text." in result["full_text"]


def test_fetch_patient_guide_detects_patient_guide_by_content_in_42229_5():
    """Detects patient guide via content keywords in an untitled 42229-5 subsection of Section 17.

    Simulates AMLODIPINE AND VALSARTAN where the real patient info lives inside
    a 42229-5 (SPL Unclassified Section) child of Section 17 with no title.
    """
    client = DailyMedClient()
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="34076-0" codeSystem="2.16.840.1.113883.6.1"/>
          <title>17 PATIENT COUNSELING INFORMATION</title>
          <text><paragraph>Advise the patient to read the FDA-approved patient labeling.</paragraph></text>
          <component>
            <section>
              <code code="42229-5" codeSystem="2.16.840.1.113883.6.1"/>
              <text><paragraph>Patient Information: Amlodipine and Valsartan Tablets. Read this medication guide carefully before you start taking this medicine.</paragraph></text>
            </section>
          </component>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("amlodipine-valsartan-set-id")

    assert result is not None
    assert "Patient Information" in result["full_text"]
    assert "Amlodipine and Valsartan" in result["full_text"]


def test_fetch_patient_guide_content_detection_ignores_non_patient_subsections():
    """Content-based detection does NOT match generic Section 17 text without patient-guide keywords."""
    client = DailyMedClient()
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="34076-0" codeSystem="2.16.840.1.113883.6.1"/>
          <title>17 PATIENT COUNSELING INFORMATION</title>
          <component>
            <section>
              <title>8.1 Pregnancy</title>
              <text><paragraph>Risk summary: Based on animal data, may cause fetal harm.</paragraph></text>
            </section>
          </component>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("no-guide-set-id")

    assert result is None


def test_fetch_patient_guide_detects_patient_guide_by_content_keyword_no_title():
    """Content-based detection finds a patient guide subsection with no title but patient-guide content."""
    client = DailyMedClient()
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="34076-0" codeSystem="2.16.840.1.113883.6.1"/>
          <title>17 PATIENT COUNSELING INFORMATION</title>
          <component>
            <section>
              <text><paragraph>MEDICATION GUIDE. Important information about this drug. Read this medication guide before you start taking this medicine and each time you get a refill.</paragraph></text>
            </section>
          </component>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_content)):
        result = client.fetch_patient_guide("content-only-set-id")

    assert result is not None
    assert "MEDICATION GUIDE" in result["full_text"]


def test_fetch_patient_guide_prefers_medguide_over_ppi():
    """Section 42231-1 is preferred over 42230-3 when both are present."""
    client = DailyMedClient()
    xml_both = b"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      <component>
        <section>
          <code code="42230-3" codeSystem="2.16.840.1.113883.6.1"/>
          <text><paragraph>Patient package insert text.</paragraph></text>
        </section>
      </component>
      <component>
        <section>
          <code code="42231-1" codeSystem="2.16.840.1.113883.6.1"/>
          <text><paragraph>Dedicated medication guide text.</paragraph></text>
        </section>
      </component>
    </structuredBody>
  </component>
</document>"""

    with patch("services.dailymed_client.requests.get", return_value=_mock_response(200, xml_both)):
        result = client.fetch_patient_guide("both-sections")

    assert result is not None
    assert "Dedicated medication guide text." in result["full_text"]
    assert "Patient package insert" not in result["full_text"]
