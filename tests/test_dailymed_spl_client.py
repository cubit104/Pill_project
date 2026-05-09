"""Unit tests for services.dailymed_spl_client."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from services.dailymed_spl_client import (
    LOINC_TO_SECTION,
    _section_text_to_html,
    _to_html,
    fetch_spl_sections,
)
from lxml import etree


NS = "urn:hl7-org:v3"


def _parse(xml: str) -> etree._Element:
    return etree.fromstring(xml.encode())


def _make_spl(sections: list[dict]) -> bytes:
    """Build a minimal SPL XML document with the given sections.

    Each section dict has keys: code, title, text_body (raw XML).
    """
    parts = []
    for s in sections:
        parts.append(f"""
      <component>
        <section>
          <code code="{s['code']}" codeSystem="2.16.840.1.113883.6.1"/>
          <title>{s.get('title', '')}</title>
          <text>{s['text_body']}</text>
        </section>
      </component>""")

    doc = f"""<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="urn:hl7-org:v3">
  <component>
    <structuredBody>
      {''.join(parts)}
    </structuredBody>
  </component>
</document>"""
    return doc.encode()


# ── _to_html unit tests ────────────────────────────────────────────────────

def test_to_html_paragraph():
    el = _parse(f'<paragraph xmlns="{NS}">Hello world</paragraph>')
    assert _to_html(el) == "<p>Hello world</p>"


def test_to_html_paragraph_escapes_html():
    el = _parse(f'<paragraph xmlns="{NS}">A &amp; B &lt;br&gt;</paragraph>')
    result = _to_html(el)
    # html.escape converts & → &amp; and < → &lt; so both must appear
    assert "A &amp; B &lt;br&gt;" in result


def test_to_html_unordered_list():
    xml = f"""<list xmlns="{NS}" styleCode="Disc">
      <item>Item one</item>
      <item>Item two</item>
    </list>"""
    el = _parse(xml)
    result = _to_html(el)
    assert result.startswith("<ul>")
    assert "<li>Item one</li>" in result
    assert "<li>Item two</li>" in result


def test_to_html_ordered_list():
    xml = f"""<list xmlns="{NS}" styleCode="Arabic">
      <item>First</item>
      <item>Second</item>
    </list>"""
    el = _parse(xml)
    result = _to_html(el)
    assert result.startswith("<ol>")
    assert "<li>First</li>" in result


def test_to_html_list_with_caption():
    xml = f"""<list xmlns="{NS}" styleCode="Disc">
      <caption>Side effects include:</caption>
      <item>Nausea</item>
    </list>"""
    el = _parse(xml)
    result = _to_html(el)
    assert "<strong>Side effects include:</strong>" in result
    assert "<li>Nausea</li>" in result


def test_to_html_nested_list():
    xml = f"""<list xmlns="{NS}" styleCode="Disc">
      <item>Outer item
        <list xmlns="{NS}" styleCode="Disc">
          <item>Inner item</item>
        </list>
      </item>
    </list>"""
    el = _parse(xml)
    result = _to_html(el)
    assert "<ul>" in result
    assert "Inner item" in result


def test_to_html_bold_content():
    xml = f'<content xmlns="{NS}" styleCode="Bold">Important text</content>'
    el = _parse(xml)
    assert _to_html(el) == "<strong>Important text</strong>"


def test_to_html_italic_content():
    xml = f'<content xmlns="{NS}" styleCode="Italics">Slanted text</content>'
    el = _parse(xml)
    assert _to_html(el) == "<em>Slanted text</em>"


def test_to_html_underline_content():
    xml = f'<content xmlns="{NS}" styleCode="Underline">Underlined</content>'
    el = _parse(xml)
    assert _to_html(el) == "<u>Underlined</u>"


def test_to_html_linkhtml_stripped():
    xml = f'<linkHtml xmlns="{NS}" href="http://example.com">click here</linkHtml>'
    el = _parse(xml)
    result = _to_html(el)
    # tag stripped, text kept
    assert "click here" in result
    assert "<a" not in result


def test_to_html_rendermultimedia_skipped():
    xml = f'<renderMultiMedia xmlns="{NS}" referencedObject="fig1"/>'
    el = _parse(xml)
    assert _to_html(el) == ""


def test_to_html_br():
    xml = f'<br xmlns="{NS}"/>'
    el = _parse(xml)
    assert _to_html(el) == "<br>"


def test_to_html_table():
    xml = f"""<table xmlns="{NS}">
      <thead><tr><th>Header</th></tr></thead>
      <tbody><tr><td>Cell</td></tr></tbody>
    </table>"""
    el = _parse(xml)
    result = _to_html(el)
    assert "<table>" in result
    assert "<th>" in result
    assert "<td>Cell</td>" in result


# ── _section_text_to_html ─────────────────────────────────────────────────

def test_section_text_to_html_basic():
    xml = f"""<text xmlns="{NS}">
      <paragraph>Use as directed.</paragraph>
    </text>"""
    el = _parse(xml)
    result = _section_text_to_html(el)
    assert "<p>Use as directed.</p>" in result


def test_section_text_to_html_sanitizes_unknown_tags():
    """bleach should strip disallowed tags."""
    xml = f"""<text xmlns="{NS}">
      <paragraph><script>alert('xss')</script>Safe text</paragraph>
    </text>"""
    el = _parse(xml)
    result = _section_text_to_html(el)
    assert "<script" not in result
    assert "Safe text" in result


def test_section_text_to_html_allows_hr():
    xml = f"""<text xmlns="{NS}">
      <paragraph>First</paragraph>
    </text>"""
    el = _parse(xml)
    result = _section_text_to_html(el)
    # hr is in ALLOWED_TAGS; the function itself doesn't add <hr>, bleach shouldn't strip it
    combined = result + "\n<hr>\n" + result
    # bleach should leave <hr> intact when we clean it
    import bleach
    from services.dailymed_spl_client import ALLOWED_TAGS, ALLOWED_ATTRS
    cleaned = bleach.clean(combined, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)
    assert "<hr>" in cleaned


# ── fetch_spl_sections ─────────────────────────────────────────────────────

def test_fetch_spl_sections_returns_empty_on_404():
    mock_resp = MagicMock()
    mock_resp.status_code = 404

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("nonexistent-id"))

    assert result == {}


def test_fetch_spl_sections_returns_empty_on_network_error():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=Exception("Network error"))

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("error-id"))

    assert result == {}


def test_fetch_spl_sections_parses_indications_section():
    xml_bytes = _make_spl([{
        "code": "34067-9",  # Indications & Usage → "uses"
        "title": "INDICATIONS AND USAGE",
        "text_body": "<paragraph>For treatment of epilepsy.</paragraph>",
    }])

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = xml_bytes

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("fake-set-id"))

    assert "uses" in result
    assert "epilepsy" in result["uses"]
    assert result["uses"].startswith("<p>") or "<p>" in result["uses"]


def test_fetch_spl_sections_sets_has_boxed_warning():
    xml_bytes = _make_spl([{
        "code": "34066-1",  # Boxed Warning → "warnings"
        "title": "BOXED WARNING",
        "text_body": "<paragraph>SERIOUS RISK: May cause liver failure.</paragraph>",
    }])

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = xml_bytes

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("fake-set-id"))

    assert result.get("_has_boxed_warning") is True
    assert "warnings" in result


def test_fetch_spl_sections_merges_multiple_loinc_codes():
    """Two sections mapping to the same key should be merged with <hr>."""
    xml_bytes = _make_spl([
        {
            "code": "34068-7",  # Dosage & Administration → "dosage"
            "title": "DOSAGE AND ADMINISTRATION",
            "text_body": "<paragraph>Take 10 mg once daily.</paragraph>",
        },
        {
            "code": "43678-2",  # Dosage Forms & Strengths → "dosage" (merge)
            "title": "DOSAGE FORMS AND STRENGTHS",
            "text_body": "<paragraph>Tablets: 10 mg, 20 mg.</paragraph>",
        },
    ])

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = xml_bytes

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("fake-set-id"))

    assert "dosage" in result
    dosage_html = result["dosage"]
    assert "10 mg once daily" in dosage_html
    assert "Tablets" in dosage_html
    assert "<hr>" in dosage_html


def test_fetch_spl_sections_returns_empty_on_xml_parse_error():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b"not valid xml <<<"

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("bad-xml-id"))

    assert result == {}


def test_fetch_spl_sections_ignores_unknown_loinc_codes():
    xml_bytes = _make_spl([{
        "code": "99999-9",  # unknown LOINC
        "title": "UNKNOWN SECTION",
        "text_body": "<paragraph>This should be ignored.</paragraph>",
    }])

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = xml_bytes

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.dailymed_spl_client.httpx.AsyncClient", return_value=mock_client):
        result = asyncio.run(fetch_spl_sections("fake-set-id"))

    # No section keys (other than _has_boxed_warning) should be present
    content_keys = [k for k in result if not k.startswith("_")]
    assert content_keys == []
