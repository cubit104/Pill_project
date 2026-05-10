import re

from lxml import html as lxml_html

_LEADING_BULLET_RE = re.compile(r"^[\s]*[•●▪‧·∙►▶◦‣⁃]+[\s]*")


def _is_blank_text(text: str) -> bool:
    return not " ".join((text or "").split()).strip()


def _serialize_children(root) -> str:
    return ((root.text or "") + "".join(lxml_html.tostring(child, encoding="unicode") for child in root)).strip()


def strip_leading_bullets(text: str) -> str:
    if not text:
        return text
    return _LEADING_BULLET_RE.sub("", text)


def strip_leading_bullets_from_html(html_str: str) -> str:
    if not html_str:
        return html_str

    root = lxml_html.fragment_fromstring(html_str, create_parent="div")
    for el in list(root.xpath(".//p | .//li")):
        text_nodes = el.xpath(".//text()[normalize-space()]")
        if text_nodes:
            first = text_nodes[0]
            stripped = strip_leading_bullets(str(first))
            if stripped != str(first):
                parent = first.getparent()
                is_text = bool(getattr(first, "is_text", False))
                is_tail = bool(getattr(first, "is_tail", False))
                if is_text:
                    parent.text = stripped
                elif is_tail:
                    parent.tail = stripped
                elif parent.text == str(first):
                    parent.text = stripped
                else:
                    parent.tail = stripped
        if _is_blank_text("".join(el.itertext())):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

    return _serialize_children(root)
