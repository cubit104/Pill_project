"""Tests for services.spl_medguide — section selection, XSLT rendering, and image rewriting."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from lxml import etree

from services import spl_medguide


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NS = "urn:hl7-org:v3"


def _make_section(code: str, title: str = "", text: str = "") -> etree._Element:
    """Build a minimal HL7 v3 ``<section>`` element for testing."""
    section = etree.Element(f"{{{_NS}}}section")
    code_el = etree.SubElement(section, f"{{{_NS}}}code")
    code_el.set("code", code)
    if title:
        title_el = etree.SubElement(section, f"{{{_NS}}}title")
        title_el.text = title
    if text:
        text_el = etree.SubElement(section, f"{{{_NS}}}text")
        text_el.text = text
    return section


def _wrap_in_doc(*sections: etree._Element) -> etree._Element:
    """Wrap sections in a minimal SPL document skeleton."""
    doc = etree.Element(f"{{{_NS}}}document")
    component = etree.SubElement(doc, f"{{{_NS}}}component")
    body = etree.SubElement(component, f"{{{_NS}}}structuredBody")
    for sec in sections:
        comp = etree.SubElement(body, f"{{{_NS}}}component")
        comp.append(sec)
    return doc


# ---------------------------------------------------------------------------
# Section selection tests
# ---------------------------------------------------------------------------


def test_select_prefers_42231_1_over_42230_3():
    """42231-1 is found first and returned instead of 42230-3."""
    sec1 = _make_section("42231-1", title="MEDICATION GUIDE")
    sec2 = _make_section("42230-3", title="PATIENT PACKAGE INSERT")
    doc = _wrap_in_doc(sec1, sec2)

    result = spl_medguide._select_medguide_section(doc)
    assert result is not None
    code_el = result.find(f"{{{_NS}}}code")
    assert code_el is not None and code_el.get("code") == "42231-1"


def test_select_falls_back_to_42230_3_when_no_42231_1():
    """42230-3 is returned when 42231-1 is absent."""
    sec = _make_section("42230-3", title="PATIENT PACKAGE INSERT")
    doc = _wrap_in_doc(sec)

    result = spl_medguide._select_medguide_section(doc)
    assert result is not None
    code_el = result.find(f"{{{_NS}}}code")
    assert code_el is not None and code_el.get("code") == "42230-3"


def test_select_falls_back_to_section17_subsection_by_title():
    """When neither primary code is present, a Section-17 subsection with a matching
    title is returned."""
    subsection = _make_section("34567-0", title="Medication Guide")
    # wrap subsection inside section 17
    sec17 = _make_section("34076-0")
    inner_comp = etree.SubElement(sec17, f"{{{_NS}}}component")
    inner_comp.append(subsection)
    doc = _wrap_in_doc(sec17)

    result = spl_medguide._select_medguide_section(doc)
    assert result is not None
    title_el = result.find(f"{{{_NS}}}title")
    assert title_el is not None and "medication guide" in title_el.text.lower()


def test_select_falls_back_to_section17_subsection_by_content():
    """When neither primary code is present, a Section-17 subsection is picked if
    its opening text contains 'medication guide'."""
    subsection = _make_section("99999-9", text="MEDICATION GUIDE for some drug. Read carefully.")
    sec17 = _make_section("34076-0")
    inner_comp = etree.SubElement(sec17, f"{{{_NS}}}component")
    inner_comp.append(subsection)
    doc = _wrap_in_doc(sec17)

    result = spl_medguide._select_medguide_section(doc)
    assert result is not None


def test_select_returns_none_when_no_match():
    """Returns None when the SPL document contains no medguide sections."""
    sec = _make_section("34068-7", title="Dosage and Administration")
    doc = _wrap_in_doc(sec)

    result = spl_medguide._select_medguide_section(doc)
    assert result is None


# ---------------------------------------------------------------------------
# fetch_medguide_html: HTTP / parse error handling
# ---------------------------------------------------------------------------


class _FakeTransformer:
    """Minimal XSLT callable that returns a trivial HTML tree."""

    def __call__(self, _tree, **_kwargs):
        return etree.HTML('<html><body><img src="fig.jpg"></body></html>')


class _FakeClient:
    def __init__(self, status_code: int = 200, content: bytes = b"<document/>"):
        self._status_code = status_code
        self._content = content

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, _url):
        resp = MagicMock()
        resp.status_code = self._status_code
        resp.content = self._content
        return resp


def _minimal_spl_xml(code: str = "42231-1") -> bytes:
    """Return a minimal SPL XML document containing one medguide section."""
    ns = _NS
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section>'
        f'<code code="{code}"/>'
        f'<title>MEDICATION GUIDE</title>'
        f'<text>Read this guide carefully.</text>'
        f'</section>'
        f'</component></structuredBody></component>'
        f'</document>'
    )
    return xml.encode()


def test_fetch_medguide_html_returns_none_on_http_error():
    with patch.object(spl_medguide, "_get_transformer", return_value=_FakeTransformer()), \
         patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(status_code=404)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


def test_fetch_medguide_html_returns_none_on_server_error():
    with patch.object(spl_medguide, "_get_transformer", return_value=_FakeTransformer()), \
         patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(status_code=500)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


def test_fetch_medguide_html_returns_none_when_no_medguide_section():
    # SPL XML has only a non-medguide section
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section><code code="34068-7"/><title>Dosage</title></section>'
        f'</component></structuredBody></component>'
        f'</document>'
    ).encode()
    with patch.object(spl_medguide, "_get_transformer", return_value=_FakeTransformer()), \
         patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


def test_fetch_medguide_html_returns_none_when_transformer_missing():
    with patch.object(spl_medguide, "_get_transformer", return_value=None):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


def test_fetch_medguide_html_returns_none_on_network_exception():
    class _ErrorClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def get(self, _url):
            raise RuntimeError("network failure")

    with patch.object(spl_medguide, "_get_transformer", return_value=_FakeTransformer()), \
         patch.object(spl_medguide.httpx, "AsyncClient", return_value=_ErrorClient()):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


# ---------------------------------------------------------------------------
# Image src rewriting
# ---------------------------------------------------------------------------


def test_fetch_medguide_html_rewrites_image_srcs():
    """Relative image src attrs are rewritten to the DailyMed CDN URL."""
    spl_id = "my-spl-set-id"
    xml_content = _minimal_spl_xml("42231-1")
    with patch.object(spl_medguide, "_get_transformer", return_value=_FakeTransformer()), \
         patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml_content)):
        result = asyncio.run(spl_medguide.fetch_medguide_html(spl_id))
    assert result is not None
    expected_src = f"https://dailymed.nlm.nih.gov/dailymed/image/upload/spl/{spl_id}/fig.jpg"
    assert expected_src in result
