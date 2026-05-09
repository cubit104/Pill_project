import asyncio
from lxml import etree

from services import spl_professional


def test_rewrite_relative_image_srcs_rewrites_only_relative():
    html = (
        '<img src="figure1.jpg">'
        '<img src="./figure2.png">'
        '<img src="https://example.com/figure3.jpg">'
        '<img src="data:image/png;base64,abc">'
    )
    out = spl_professional._rewrite_relative_image_srcs(html, 'set-123')

    assert 'src="https://dailymed.nlm.nih.gov/dailymed/image/upload/spl/set-123/figure1.jpg"' in out
    assert 'src="https://dailymed.nlm.nih.gov/dailymed/image/upload/spl/set-123/figure2.png"' in out
    assert 'src="https://example.com/figure3.jpg"' in out
    assert 'src="data:image/png;base64,abc"' in out


def test_fetch_professional_html_returns_none_when_transformer_missing(monkeypatch):
    monkeypatch.setattr(spl_professional, '_get_transformer', lambda: None)
    result = asyncio.run(spl_professional.fetch_professional_html('abc'))
    assert result is None


def test_fetch_professional_html_renders_and_rewrites(monkeypatch):
    class DummyTransformer:
        def __call__(self, _xml_tree, **_kwargs):
            return etree.HTML('<html><body><img src="figure1.jpg"><img src="https://example.com/a.jpg"></body></html>')

    class DummyResponse:
        status_code = 200
        content = b'<document></document>'

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, _url):
            return DummyResponse()

    monkeypatch.setattr(spl_professional, '_get_transformer', lambda: DummyTransformer())
    monkeypatch.setattr(spl_professional.httpx, 'AsyncClient', lambda timeout: DummyClient())

    out = asyncio.run(spl_professional.fetch_professional_html('set-xyz'))
    assert out is not None
    assert 'https://dailymed.nlm.nih.gov/dailymed/image/upload/spl/set-xyz/figure1.jpg' in out
    assert 'https://example.com/a.jpg' in out
