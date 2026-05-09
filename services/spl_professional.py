import logging
import re
from pathlib import Path
from threading import Lock
from typing import Optional

import httpx
from lxml import etree

logger = logging.getLogger(__name__)

_DAILYMED_SPL_XML_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{spl_set_id}.xml"
_DAILYMED_IMAGE_BASE = "https://dailymed.nlm.nih.gov/dailymed/image/upload/spl/{spl_set_id}/"
_XSL_PATH = Path(__file__).resolve().parent.parent / "Final_xml_to_web" / "FDA_Engine" / "spl.xsl"

_transformer: Optional[etree.XSLT] = None
_transformer_failed = False
_transformer_lock = Lock()

_SRC_ATTR_RE = re.compile(r"(\bsrc\s*=\s*)([\"'])([^\"']+)(\2)", re.IGNORECASE)


def _get_transformer() -> Optional[etree.XSLT]:
    global _transformer, _transformer_failed
    if _transformer is not None:
        return _transformer
    if _transformer_failed:
        return None

    with _transformer_lock:
        if _transformer is not None:
            return _transformer
        try:
            xslt_tree = etree.parse(str(_XSL_PATH))
            _transformer = etree.XSLT(xslt_tree)
            return _transformer
        except Exception as exc:
            _transformer_failed = True
            logger.warning("Failed to load SPL XSLT from %s: %s", _XSL_PATH, exc, exc_info=True)
            return None


def _rewrite_relative_image_srcs(html: str, spl_set_id: str) -> str:
    image_base = _DAILYMED_IMAGE_BASE.format(spl_set_id=spl_set_id)

    def _replace(match: re.Match[str]) -> str:
        prefix, quote, src, suffix = match.groups()
        src_stripped = src.strip()
        lower = src_stripped.lower()
        if (
            lower.startswith("http://")
            or lower.startswith("https://")
            or lower.startswith("data:")
            or lower.startswith("//")
            or lower.startswith("/")
            or lower.startswith("#")
        ):
            return match.group(0)

        filename = src_stripped.split("/")[-1]
        if not filename:
            return match.group(0)
        return f"{prefix}{quote}{image_base}{filename}{suffix}"

    return _SRC_ATTR_RE.sub(_replace, html)


async def fetch_professional_html(spl_set_id: str) -> Optional[str]:
    spl_set_id = (spl_set_id or "").strip()
    if not spl_set_id:
        return None

    transformer = _get_transformer()
    if transformer is None:
        return None

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(_DAILYMED_SPL_XML_URL.format(spl_set_id=spl_set_id))
        if response.status_code >= 400:
            return None

        parser = etree.XMLParser(recover=True)
        xml_tree = etree.fromstring(response.content, parser=parser)
        result = transformer(
            xml_tree,
            css=etree.XSLT.strparam("https://www.accessdata.fda.gov/spl/stylesheet/spl.css"),
        )
        html = etree.tostring(result, method="html", encoding="unicode")
        return _rewrite_relative_image_srcs(html, spl_set_id)
    except Exception as exc:
        logger.warning(
            "Failed to render professional SPL HTML for spl_set_id=%s: %s",
            spl_set_id,
            exc,
            exc_info=True,
        )
        return None
