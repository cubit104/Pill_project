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
