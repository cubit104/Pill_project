from lxml import etree

from services import spl_medguide

_NS = "urn:hl7-org:v3"


def _boxed_section(inner_xml: str) -> etree._Element:
    section = etree.fromstring(
        (
            f'<section xmlns="{_NS}">'
            '<code code="34066-1"/>'
            "<title>BOXED WARNING</title>"
            f"{inner_xml}"
            "</section>"
        ).encode()
    )
    return section


def test_dedupe_duplicate_list_items():
    section = _boxed_section(
        "<text>"
        "<list><item>X</item><item>Y</item></list>"
        "<paragraph>WARNING: FETAL TOXICITY</paragraph>"
        "<list><item>X</item><item>Y</item></list>"
        "</text>"
    )
    rendered = spl_medguide._render_boxed_warning_section(section)
    assert rendered.count("<li>X</li>") == 1
    assert rendered.count("<li>Y</li>") == 1


def test_warning_paragraph_emits_h3():
    section = _boxed_section("<text><paragraph>WARNING: FETAL TOXICITY</paragraph></text>")
    rendered = spl_medguide._render_boxed_warning_section(section)
    assert '<h3 class="boxed-warning-heading">WARNING: FETAL TOXICITY</h3>' in rendered
