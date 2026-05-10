import asyncio
import logging
from unittest.mock import MagicMock, patch

from lxml import html as lxml_html

from services import spl_medguide
from services import spl_professional

_NS = "urn:hl7-org:v3"


class _FakeClient:
    def __init__(self, status_code: int = 200, content: bytes = b"<document/>"):
        self._status_code = status_code
        self._content = content

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, _url):
        response = MagicMock()
        response.status_code = self._status_code
        response.content = self._content
        return response


def _section(code: str, heading: str, inner: str = "", *, section_id: str | None = None) -> str:
    id_attr = f' ID="{section_id}"' if section_id else ""
    return (
        f'<section{id_attr}>'
        f'<code code="{code}"/>'
        f'<title>{heading}</title>'
        f'{inner}'
        f'</section>'
    )


def _wrap_document(*sections: str, media: str = "", effective_time: str = "20240501") -> bytes:
    body = "".join(f"<component>{section}</component>" for section in sections)
    xml = (
        f'<document xmlns="{_NS}">'
        f'<effectiveTime value="{effective_time}"/>'
        f'{media}'
        f'<component><structuredBody>{body}</structuredBody></component>'
        f'</document>'
    )
    return xml.encode()


def test_fetch_professional_html_returns_none_on_http_error():
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(status_code=404)):
        result = asyncio.run(spl_professional.fetch_professional_html('set-missing'))
    assert result is None


def test_full_professional_renderer_extracts_highlights_and_all_sections():
    sections = []
    for code, slug, _label, heading in spl_professional.PRO_SECTIONS:
        inner = '<text><paragraph>Body for section.</paragraph></text>'
        if slug == 'highlights':
            inner = '<text><paragraph>Quick summary.</paragraph></text>'
        sections.append(_section(code, heading, inner, section_id=f'{slug}-id'))

    xml = _wrap_document(*sections)
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-all'))
        article_only = asyncio.run(spl_professional.fetch_professional_html('set-all'))

    assert rendered is not None
    assert rendered.highlights_html is not None
    assert 'Highlights of Prescribing Information' in rendered.highlights_html
    assert 'Revised:' in rendered.highlights_html
    assert len(rendered.sections) == len(spl_professional.PRO_SECTIONS) - 1
    assert rendered.article_html.count('<h2 id="') == len(spl_professional.PRO_SECTIONS) - 1
    assert 'id="highlights"' not in rendered.article_html
    assert article_only == rendered.article_html


def test_sparse_professional_renderer_only_includes_present_sections():
    xml = _wrap_document(
        _section('34067-9', 'Indications and Usage', '<text><paragraph>Indications.</paragraph></text>'),
        _section('34068-7', 'Dosage and Administration', '<text><paragraph>Dosage.</paragraph></text>'),
        _section('34070-3', 'Contraindications', '<text><paragraph>Contra.</paragraph></text>'),
        _section('34084-4', 'Adverse Reactions', '<text><paragraph>Adverse.</paragraph></text>'),
        _section('34069-5', 'How Supplied', '<text><paragraph>Supply.</paragraph></text>'),
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-sparse'))

    assert rendered is not None
    assert rendered.highlights_html is None
    assert rendered.article_html.count('<h2 id="') == 5
    assert rendered.sections == [
        ('indications', 'Indications'),
        ('dosage', 'Dosage'),
        ('contraindications', 'Contraindications'),
        ('adverse-reactions', 'Adverse Reactions'),
        ('how-supplied', 'How Supplied'),
    ]


def test_walker_returns_html_when_sections_present():
    xml = _wrap_document(
        _section(
            '34067-9',
            'Indications and Usage',
            '<text><paragraph>Indications.</paragraph></text>',
        )
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_professional.fetch_professional_html('set-indications'))

    assert result is not None
    assert '<h2 id="indications">Indications and Usage</h2>' in result


def test_walker_returns_none_when_zero_sections_match():
    xml = _wrap_document(
        _section(
            '99999-9',
            'Non-matching section',
            '<text><paragraph>No professional section match.</paragraph></text>',
        )
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        result = asyncio.run(spl_professional.fetch_professional_html('set-no-match'))

    assert result is None


def test_professional_renderer_preserves_real_data_tables():
    xml = _wrap_document(
        _section(
            '34090-1',
            'Clinical Pharmacology',
            '<text><table><thead><tr><th>Parameter</th><th>Value</th></tr></thead>'
            '<tbody><tr><td>Half-life</td><td>12 hours</td></tr></tbody></table></text>',
        )
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-table'))

    assert rendered is not None
    assert '<table>' in rendered.article_html
    assert '<th>Parameter</th>' in rendered.article_html
    assert '<td>12 hours</td>' in rendered.article_html


def test_professional_renderer_hotlinks_images_to_dailymed():
    media = (
        '<observationMedia ID="MM1">'
        '<value><reference value="figure1.jpg"/></value>'
        '</observationMedia>'
    )
    xml = _wrap_document(
        _section(
            '34092-7',
            'Clinical Studies',
            '<text><paragraph>Study figure.</paragraph><renderMultiMedia referencedObject="MM1"/>'
            '<caption>Figure 1. Study design.</caption></text>',
        ),
        media=media,
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-img'))

    assert rendered is not None
    assert '<figure class="pro-figure my-4">' in rendered.article_html
    assert (
        'src="https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=set-img&amp;type=img&amp;name=figure1.jpg"'
        in rendered.article_html
    )
    assert 'loading="lazy"' in rendered.article_html
    assert 'Figure 1. Study design.' in rendered.article_html


def test_sanitize_html_blocks_off_cdn_images():
    cleaned = spl_professional._sanitize_html(
        '<section>'
        '<img src="http://evil.example.com/x.jpg" alt="bad" />'
        '<img src="https://dailymed.nlm.nih.gov.evil.com/x.jpg" alt="bad2" />'
        '<img src="https://dailymed.nlm.nih.gov/image.jpg" alt="ok" />'
        '</section>'
    )

    assert 'evil.example.com' not in cleaned
    assert 'dailymed.nlm.nih.gov.evil.com' not in cleaned
    assert 'https://dailymed.nlm.nih.gov/image.jpg' in cleaned


def test_professional_renderer_wraps_list_caption_in_list_item():
    xml = _wrap_document(
        _section(
            '34068-7',
            'Dosage and Administration',
            '<text><list><caption>Adults</caption><item>Take once daily.</item></list></text>',
        )
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-list-caption'))

    assert rendered is not None
    assert '<ul><li><strong>Adults</strong></li><li>Take once daily.</li></ul>' in rendered.article_html


def test_professional_renderer_resolves_in_page_links():
    xml = _wrap_document(
        _section(
            '34066-1',
            'Boxed Warning',
            '<text><paragraph><linkHtml href="#section1">see (1)</linkHtml></paragraph></text>',
        ),
        _section('34067-9', 'Indications and Usage', '<text><paragraph>Indications.</paragraph></text>', section_id='section1'),
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-links'))

    assert rendered is not None
    assert '<a href="#indications">see (1)</a>' in rendered.article_html


def test_pro_boxed_warning_wrapped_in_callout():
    xml = _wrap_document(
        _section(
            "34066-1",
            "Boxed Warning",
            "<text><paragraph>WARNING: FETAL TOXICITY</paragraph><list><item>Item one.</item></list></text>",
        ),
        _section("34067-9", "Indications and Usage", "<text><paragraph>Indications.</paragraph></text>"),
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-boxed-callout"))

    assert rendered is not None
    assert '<aside class="pro-boxed-warning-callout" role="note" aria-label="Boxed Warning">' in rendered.article_html


def test_professional_renderer_strips_unknown_link_targets():
    xml = _wrap_document(
        _section(
            '34068-7',
            'Dosage and Administration',
            '<text><paragraph><linkHtml href="#missing">see dosage</linkHtml></paragraph></text>',
        )
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-unknown-link'))

    assert rendered is not None
    assert '<a href=' not in rendered.article_html
    assert 'see dosage' in rendered.article_html


def test_highlights_are_extracted_from_main_article():
    xml = _wrap_document(
        _section('42229-5', 'Highlights of Prescribing Information', '<text><paragraph>Quick summary.</paragraph></text>'),
        _section('34067-9', 'Indications and Usage', '<text><paragraph>Main section.</paragraph></text>'),
    )
    with patch.object(spl_professional.httpx, 'AsyncClient', return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered('set-highlights'))

    assert rendered is not None
    assert rendered.highlights_html is not None
    assert 'Quick summary.' in rendered.highlights_html
    article_text = lxml_html.fromstring(f'<div>{rendered.article_html}</div>').text_content()
    assert 'Highlights of Prescribing Information' not in article_text
    assert rendered.sections == [('indications', 'Indications')]


def test_strip_leading_bullets_in_highlights():
    xml = _wrap_document(
        _section(
            "42229-5",
            "Highlights of Prescribing Information",
            "<text><paragraph>• Prior to initiation of WEGOVY injection</paragraph>"
            "<list><item>• List point</item></list></text>",
        ),
        _section("34067-9", "Indications and Usage", "<text><paragraph>Main section.</paragraph></text>"),
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-bullets"))

    assert rendered is not None
    assert rendered.highlights_html is not None
    assert "<p>Prior to initiation of WEGOVY injection</p>" in rendered.highlights_html
    assert "<li>List point</li>" in rendered.highlights_html
    assert "• Prior to initiation" not in rendered.highlights_html
    assert "• List point" not in rendered.highlights_html


def test_highlights_header_has_separator_classes():
    xml = _wrap_document(
        _section("42229-5", "Highlights of Prescribing Information", "<text><paragraph>Quick summary.</paragraph></text>"),
        _section("34067-9", "Indications and Usage", "<text><paragraph>Main section.</paragraph></text>"),
        effective_time="20260319",
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-header"))

    assert rendered is not None
    assert rendered.highlights_html is not None
    assert 'class="pro-highlights-title"' in rendered.highlights_html
    assert 'class="pro-highlights-meta"' in rendered.highlights_html


def test_highlights_header_meta_omitted_when_no_date():
    xml = _wrap_document(
        _section("42229-5", "Highlights of Prescribing Information", "<text><paragraph>Quick summary.</paragraph></text>"),
        _section("34067-9", "Indications and Usage", "<text><paragraph>Main section.</paragraph></text>"),
        effective_time="",
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-header-nodate"))

    assert rendered is not None
    assert rendered.highlights_html is not None
    assert 'class="pro-highlights-title"' in rendered.highlights_html
    assert 'class="pro-highlights-meta"' not in rendered.highlights_html


def test_linkify_numbered_section_ref():
    html_str = "[see Warnings and Precautions (5.4)]"
    output = spl_professional._linkify_section_refs(html_str)
    assert output == '<a href="#warnings-precautions" class="pro-section-ref">[see Warnings and Precautions (5.4)]</a>'


def test_linkify_multi_numbered_ref_uses_first():
    html_str = "[see Contraindications (4), Warnings and Precautions (5.1)]"
    output = spl_professional._linkify_section_refs(html_str)
    assert output == '<a href="#contraindications" class="pro-section-ref">[see Contraindications (4), Warnings and Precautions (5.1)]</a>'


def test_linkify_descriptive_only_ref():
    html_str = "[see Boxed Warning]"
    output = spl_professional._linkify_section_refs(html_str)
    assert output == '<a href="#boxed-warning" class="pro-section-ref">[see Boxed Warning]</a>'


def test_linkify_unknown_ref_kept_as_text():
    html_str = "[see Section Foo]"
    output = spl_professional._linkify_section_refs(html_str)
    assert output == html_str


def test_linkify_does_not_match_inline_brackets():
    html_str = "[bracketed clarification]"
    output = spl_professional._linkify_section_refs(html_str)
    assert output == html_str


def test_pro_article_body_also_linkified():
    xml = _wrap_document(
        _section(
            "34084-4",
            "Adverse Reactions",
            "<text><paragraph><content styleCode=\"italics\">[see Adverse Reactions (6.1)]</content></paragraph></text>",
        )
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-pro-linkified"))

    assert rendered is not None
    assert '<a href="#adverse-reactions" class="pro-section-ref">[see Adverse Reactions (6.1)]</a>' in rendered.article_html


def test_consumer_medguide_not_linkified():
    medguide_xml = (
        f'<document xmlns="{_NS}">'
        '<effectiveTime value="20240501"/>'
        '<component><structuredBody>'
        '<component><section>'
        '<code code="42230-3"/>'
        '<title>Medication Guide</title>'
        '<text><paragraph>[see Warnings and Precautions (5.4)]</paragraph></text>'
        '</section></component>'
        '</structuredBody></component>'
        '</document>'
    ).encode()
    with patch.object(spl_medguide.httpx, "AsyncClient", return_value=_FakeClient(content=medguide_xml)):
        rendered = asyncio.run(spl_medguide.fetch_medguide_html("set-medguide-link-check"))

    assert rendered is not None
    assert "[see Warnings and Precautions (5.4)]" in rendered
    assert "pro-section-ref" not in rendered
    assert 'href="#warnings-precautions"' not in rendered


def test_professional_renderer_unwraps_outer_layout_table_and_drops_fda_contents_block():
    outer_layout = (
        "<text><table><tbody>"
        "<tr>"
        "<td>"
        "<paragraph>FULL PRESCRIBING INFORMATION: CONTENTS*</paragraph>"
        "<list>"
        "<item><linkHtml href=\"#section1.1\">1.1 Acute Coronary Syndrome (ACS)</linkHtml></item>"
        "<item><linkHtml href=\"#section14.1\">14.1 Acute Coronary Syndrome</linkHtml></item>"
        "</list>"
        "<paragraph>* Sections or subsections omitted from the full prescribing information are not listed.</paragraph>"
        "</td>"
        "<td><paragraph>----------</paragraph><paragraph>WARNING: Serious adverse effects.</paragraph></td>"
        "</tr>"
        "</tbody></table></text>"
    )
    xml = _wrap_document(
        _section("42229-5", "Highlights of Prescribing Information", "<text><paragraph>Quick summary.</paragraph></text>"),
        _section("34066-1", "Boxed Warning", outer_layout),
        _section("34067-9", "Indications and Usage", "<text><paragraph>Indications body.</paragraph></text>", section_id="section1.1"),
        _section("34092-7", "Clinical Studies", "<text><paragraph>Study body.</paragraph></text>", section_id="section14.1"),
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-layout"))

    assert rendered is not None
    assert "<table>" not in rendered.article_html
    assert "FULL PRESCRIBING INFORMATION: CONTENTS" not in rendered.article_html
    assert "Sections or subsections omitted from the full prescribing information are not listed" not in rendered.article_html
    assert "WARNING: Serious adverse effects." in rendered.article_html
    assert "----------" not in rendered.article_html


def test_professional_renderer_drops_contents_link_table():
    xml = _wrap_document(
        _section(
            "34068-7",
            "Dosage and Administration",
            "<text><table><tbody><tr><td>"
            "<list><item><linkHtml href=\"#section1\">1 Indications</linkHtml></item></list>"
            "</td></tr></tbody></table></text>",
        )
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-contents-table"))

    assert rendered is not None
    assert "<table>" not in rendered.article_html
    assert "1 Indications" not in rendered.article_html


def test_professional_renderer_logs_warning_and_skips_missing_multimedia(caplog):
    xml = _wrap_document(
        _section(
            "34092-7",
            "Clinical Studies",
            "<text><paragraph>Study figure.</paragraph><renderMultiMedia referencedObject=\"MM_MISSING\"/></text>",
        )
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        with caplog.at_level(logging.WARNING):
            rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-missing-img"))

    assert rendered is not None
    assert "<img " not in rendered.article_html
    assert any("multimedia reference unresolved" in message.lower() for message in caplog.messages)


def test_professional_renderer_uses_expected_subsection_slug():
    xml = _wrap_document(
        _section(
            "34067-9",
            "Indications and Usage",
            "<text><paragraph>Indications body.</paragraph></text>"
            "<component><section><title>1.1 Acute Coronary Syndrome (ACS)</title>"
            "<text><paragraph>Subsection body.</paragraph></text></section></component>",
        )
    )
    with patch.object(spl_professional.httpx, "AsyncClient", return_value=_FakeClient(content=xml)):
        rendered = asyncio.run(spl_professional.fetch_professional_rendered("set-subslug"))

    assert rendered is not None
    assert (
        '<h3 id="indications-acute-coronary-syndrome-acs">1.1 Acute Coronary Syndrome (ACS)</h3>'
        in rendered.article_html
    )
