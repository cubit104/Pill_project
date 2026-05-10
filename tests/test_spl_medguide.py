"""Tests for services.spl_medguide — section selection, HTML rendering, and sanitization."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

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


def _minimal_spl_xml(
    code: str = "42231-1",
    title: str = "MEDICATION GUIDE",
    extra_subsection: bool = False,
) -> bytes:
    """Return a minimal SPL XML document containing one medguide section."""
    subsection_xml = ""
    if extra_subsection:
        subsection_xml = (
            "<component>"
            "<section>"
            "<title>What is the most important information I should know?</title>"
            "<text><paragraph>Read carefully.</paragraph></text>"
            "</section>"
            "</component>"
        )
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section>'
        f'<code code="{code}"/>'
        f'<title>{title}</title>'
        f'<text><paragraph>Read this guide carefully.</paragraph></text>'
        f'{subsection_xml}'
        f'</section>'
        f'</component></structuredBody></component>'
        f'</document>'
    )
    return xml.encode()


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


# ---------------------------------------------------------------------------
# Section selection tests (unchanged behavior)
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


def test_fetch_medguide_html_returns_none_on_http_error():
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(status_code=404)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


def test_fetch_medguide_html_returns_none_on_server_error():
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(status_code=500)):
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
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
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

    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_ErrorClient()):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is None


# ---------------------------------------------------------------------------
# HTML rendering output format
# ---------------------------------------------------------------------------


def test_fetch_medguide_html_returns_article_wrapper():
    """Output starts with <article and contains an <h1> for the medguide title."""
    xml_content = _minimal_spl_xml("42231-1", title="MEDICATION GUIDE")
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml_content)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert result.startswith("<article")
    assert "<h1>" in result
    assert "MEDICATION GUIDE" in result


def test_fetch_medguide_html_no_iframe_no_fda_stylesheet():
    """Output contains no iframe wrapper, no <html>, no <link>, no FDA stylesheet URL."""
    xml_content = _minimal_spl_xml("42231-1")
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml_content)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert "<html" not in result
    assert "<link" not in result
    assert "accessdata.fda.gov" not in result
    assert "<iframe" not in result
    assert 'table border' not in result


def test_fetch_medguide_html_no_img_tags():
    """Output contains no <img> tags (medguide is text-only in v1)."""
    # Include a renderMultiMedia element in the SPL
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section>'
        f'<code code="42231-1"/>'
        f'<title>MEDICATION GUIDE</title>'
        f'<text>'
        f'<renderMultiMedia referencedObject="img1"/>'
        f'<paragraph>Text after image.</paragraph>'
        f'</text>'
        f'</section>'
        f'</component></structuredBody></component>'
        f'</document>'
    ).encode()
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert "<img" not in result
    assert "Text after image." in result


def test_fetch_medguide_html_subsection_titles_become_h2_with_slugified_ids():
    """Subsection <title> elements become <h2 id="..."> with slugified ids."""
    xml_content = _minimal_spl_xml("42231-1", extra_subsection=True)
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml_content)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert '<h2 id="what-is-the-most-important-information-i-should-know">' in result


def test_fetch_medguide_html_slugified_ids_are_unique():
    """When two subsections share the same title, their ids get a -1 suffix."""
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section>'
        f'<code code="42231-1"/>'
        f'<title>MEDICATION GUIDE</title>'
        f'<component>'
        f'<section>'
        f'<title>Important Info</title>'
        f'<text><paragraph>First.</paragraph></text>'
        f'</section>'
        f'</component>'
        f'<component>'
        f'<section>'
        f'<title>Important Info</title>'
        f'<text><paragraph>Second.</paragraph></text>'
        f'</section>'
        f'</component>'
        f'</section>'
        f'</component></structuredBody></component>'
        f'</document>'
    ).encode()
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert 'id="important-info"' in result
    assert 'id="important-info-1"' in result


def test_fetch_medguide_html_paragraphs_become_p_tags():
    """SPL <paragraph> elements are converted to <p> tags."""
    xml_content = _minimal_spl_xml("42231-1")
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml_content)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert "<p>" in result
    assert "Read this guide carefully." in result


def test_fetch_medguide_html_list_becomes_ul():
    """SPL <list><item> elements are converted to <ul><li>."""
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section>'
        f'<code code="42231-1"/>'
        f'<title>MEDICATION GUIDE</title>'
        f'<text>'
        f'<list>'
        f'<item>First item</item>'
        f'<item>Second item</item>'
        f'</list>'
        f'</text>'
        f'</section>'
        f'</component></structuredBody></component>'
        f'</document>'
    ).encode()
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert "<ul>" in result
    assert "<li>First item</li>" in result


def test_fetch_medguide_html_content_bold_becomes_strong():
    """SPL <content styleCode="bold"> becomes <strong>."""
    xml = (
        f'<document xmlns="{_NS}">'
        f'<component><structuredBody><component>'
        f'<section>'
        f'<code code="42231-1"/>'
        f'<title>MEDICATION GUIDE</title>'
        f'<text>'
        f'<paragraph><content styleCode="bold">Important:</content> Read carefully.</paragraph>'
        f'</text>'
        f'</section>'
        f'</component></structuredBody></component>'
        f'</document>'
    ).encode()
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_medguide.fetch_medguide_html("set-abc"))
    assert result is not None
    assert "<strong>Important:</strong>" in result


def test_slugify_basic():
    """_slugify converts text to lowercase hyphenated slug."""
    assert spl_medguide._slugify("What Is The Most Important Information?") == \
        "what-is-the-most-important-information"


def test_slugify_collapses_repeated_separators():
    """Multiple non-alphanumeric chars collapse to a single dash."""
    assert spl_medguide._slugify("Hello  -- World!") == "hello-world"


def test_unique_slug_appends_counter_on_collision():
    """Duplicate slugs get a 1-based counter suffix."""
    seen: dict[str, int] = {}
    slug1 = spl_medguide._unique_slug("Foo Bar", seen)
    slug2 = spl_medguide._unique_slug("Foo Bar", seen)
    slug3 = spl_medguide._unique_slug("Foo Bar", seen)
    assert slug1 == "foo-bar"
    assert slug2 == "foo-bar-1"
    assert slug3 == "foo-bar-2"
