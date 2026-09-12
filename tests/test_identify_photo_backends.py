"""The two places visual matching can run, and what happens when it is down.

With PILL_MATCH_URL unset the model is loaded in this process (today's
behaviour). With it set, matching is an HTTP call to the matcher service and
this process never loads a model. Either way, a matcher that is unavailable
must degrade to imprint-only results rather than fail the identification.
"""

import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from routes import identify_photo as ip  # noqa: E402


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class _Cand:
    def __init__(self, slug, score):
        self.slug = slug
        self.score = score
        self.medicine_name = slug.replace("-", " ").title()
        self.splimprint = "X;1"
        self.color = "WHITE"
        self.shape = "ROUND"
        self.strength = "10 mg"
        self.image_urls = []


class _TextResult:
    def __init__(self, candidates):
        self.candidates = candidates


@pytest.fixture
def remote(monkeypatch):
    """Point the route at a matcher service and capture what it sends."""
    monkeypatch.setattr(ip, "MATCH_URL", "http://matcher.local/match")
    monkeypatch.setattr(ip, "MATCH_KEY", "s3cret")
    sent = {}

    def fake_post(url, files=None, data=None, headers=None, timeout=None):
        sent.update(url=url, files=files, data=data, headers=headers, timeout=timeout)
        return sent.get("response", _Resp(200, {"matches": []}))

    monkeypatch.setattr(ip.httpx, "post", fake_post)
    return sent


def test_remote_hits_are_parsed_into_slug_score_pairs(remote):
    remote["response"] = _Resp(200, {"matches": [{"slug": "plavix-75-1171", "score": 0.71}, {"slug": "other", "score": 0.5}]})
    assert ip._vision_hits([b"jpeg"], 25) == [("plavix-75-1171", 0.71), ("other", 0.5)]


def test_remote_call_carries_the_shared_secret_and_the_limit(remote):
    ip._vision_hits([b"jpeg"], 25)
    assert remote["headers"]["X-Vision-Key"] == "s3cret"
    assert remote["data"] == {"mode": "match", "limit": "25"}


def test_both_photos_are_forwarded_when_two_are_given(remote):
    ip._vision_hits([b"front", b"back"], 25)
    assert set(remote["files"]) == {"photo", "photo2"}


def test_attrs_mode_sends_one_photo_and_returns_both_heads(remote):
    remote["response"] = _Resp(200, {"shape": {"ROUND": 0.9}, "color": {"WHITE": 0.8}})
    shape_p, color_p = ip._vision_attrs([b"front", b"back"])
    assert remote["data"]["mode"] == "attrs"
    assert set(remote["files"]) == {"photo"}
    assert shape_p == {"ROUND": 0.9} and color_p == {"WHITE": 0.8}


def test_an_unreachable_matcher_is_a_503(monkeypatch, remote):
    def boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(ip.httpx, "post", boom)
    with pytest.raises(HTTPException) as e:
        ip._vision_hits([b"jpeg"], 25)
    assert e.value.status_code == 503


def test_a_matcher_error_is_a_503_not_a_500(remote):
    remote["response"] = _Resp(500, {})
    with pytest.raises(HTTPException) as e:
        ip._vision_hits([b"jpeg"], 25)
    assert e.value.status_code == 503


def test_an_unusable_photo_stays_a_422(remote):
    """422 from the matcher is about the image, so it must not read as an outage."""
    remote["response"] = _Resp(422, {})
    with pytest.raises(HTTPException) as e:
        ip._vision_hits([b"jpeg"], 25)
    assert e.value.status_code == 422


def test_remote_mode_never_loads_a_model_in_this_process(monkeypatch, remote):
    monkeypatch.setattr(ip, "_load", lambda: pytest.fail("the API must not load a model in remote mode"))
    ip._vision_hits([b"jpeg"], 25)
    ip._vision_attrs([b"jpeg"])
    assert ip._index is None


def test_local_mode_uses_the_in_process_core_and_makes_no_http_call(monkeypatch):
    monkeypatch.setattr(ip, "MATCH_URL", "")
    monkeypatch.setattr(ip, "_load", lambda: None)
    monkeypatch.setattr(ip.httpx, "post", lambda *a, **k: pytest.fail("local mode must not call out"))
    monkeypatch.setattr(ip.core, "match", lambda index, raws, limit: [("pill-a", 0.9)])
    assert ip._vision_hits([b"jpeg"], 25) == [("pill-a", 0.9)]


def test_local_mode_maps_a_bad_image_to_422(monkeypatch):
    monkeypatch.setattr(ip, "MATCH_URL", "")
    monkeypatch.setattr(ip, "_load", lambda: None)

    def bad(index, raws, limit):
        raise ip.core.VisionInputError("Image too small to read")

    monkeypatch.setattr(ip.core, "match", bad)
    with pytest.raises(HTTPException) as e:
        ip._vision_hits([b"jpeg"], 25)
    assert e.value.status_code == 422


def test_identification_survives_a_matcher_outage_with_imprint_results(monkeypatch):
    """The reader found the pill; a dead matcher must not lose that answer."""

    async def fake_read(raws):
        return ["X1"], ["X1"]

    monkeypatch.setattr(ip, "_read_imprint", fake_read)
    monkeypatch.setattr(ip, "identify_pill", lambda req: _TextResult([_Cand("pill-a", 0.80), _Cand("pill-b", 0.70)]))
    monkeypatch.setattr(ip, "_vision_attrs", lambda raws: ({}, {}))

    def down(raws, limit):
        raise HTTPException(status_code=503, detail="down")

    monkeypatch.setattr(ip, "_vision_hits", down)

    out = ip._identify_sync([b"jpeg"])
    assert [m["slug"] for m in out["matches"]] == ["pill-a", "pill-b"]
    assert out["imprint_read"] == "X1"
    assert out["disclaimer"]


def test_a_matcher_outage_with_nothing_from_the_reader_still_raises(monkeypatch):
    async def fake_read(raws):
        return [], []

    monkeypatch.setattr(ip, "_read_imprint", fake_read)

    def down(raws, limit):
        raise HTTPException(status_code=503, detail="down")

    monkeypatch.setattr(ip, "_vision_hits", down)
    with pytest.raises(HTTPException) as e:
        ip._identify_sync([b"jpeg"])
    assert e.value.status_code == 503
