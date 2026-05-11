from lxml import etree

from services import spl_medguide

_NS = "urn:hl7-org:v3"


def _boxed_section(text_inner: str) -> etree._Element:
    section = etree.Element(f"{{{_NS}}}section")
    code_el = etree.SubElement(section, f"{{{_NS}}}code")
    code_el.set("code", "34066-1")
    text_el = etree.SubElement(section, f"{{{_NS}}}text")
    parsed = etree.fromstring(f"<root xmlns='{_NS}'>{text_inner}</root>")
    text_el.append(parsed[0])
    for child in parsed[1:]:
        text_el.append(child)
    return section


def test_dedupe_duplicate_list_items():
    section = _boxed_section(
        "<list>"
        "<item>X</item><item>Y</item>"
        "</list>"
        "<paragraph>WARNING: FETAL TOXICITY</paragraph>"
        "<list>"
        "<item>X</item><item>Y</item>"
        "</list>"
    )
    rendered = spl_medguide._render_boxed_warning_section(section)

    assert rendered.count("<li>X</li>") == 1
    assert rendered.count("<li>Y</li>") == 1


def test_warning_paragraph_emits_h3():
    section = _boxed_section("<paragraph>WARNING: FETAL TOXICITY</paragraph>")
    rendered = spl_medguide._render_boxed_warning_section(section)

    assert '<h3 class="boxed-warning-heading">WARNING: FETAL TOXICITY</h3>' in rendered
