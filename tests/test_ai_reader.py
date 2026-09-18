"""Second imprint reader: reply parsing, the when-to-call rule, the fallback wiring, settings and stats."""
from __future__ import annotations

import os
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

import pytest

from routes import identify_photo as ip
from routes import site_settings as ss
from services import ai_reader


def _reply(text, tokens_in=2300, tokens_out=40):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}],
            "usageMetadata": {"promptTokenCount": tokens_in, "candidatesTokenCount": tokens_out}}


# ---- parsing ---------------------------------------------------------------------------

def test_parse_reply_cleans_tokens_and_prices_the_call():
    out = ai_reader.parse_reply(_reply('{"side1": "c 73", "side2": "", "confidence": "high"}'), "gemini-3.8-flash")
    assert out["tokens"] == ["C", "73"] and out["side_reads"] == ["C 73"] and out["confidence"] == "high"
    assert out["cost_micros"] == round(2300 * 0.75 + 40 * 3.75)  # millionths of a dollar


def test_parse_reply_handles_two_sides_lists_and_junk():
    two = ai_reader.parse_reply(_reply('[{"side1": "93", "side2": "318", "confidence": "sure"}]'), "gemini-3.1-pro-preview")
    assert two["tokens"] == ["93", "318"] and two["side_reads"] == ["93", "318"] and two["confidence"] == "low"
    prose = ai_reader.parse_reply(_reply('{"side1": "<b>Tylenol!</b> probably acetaminophen 500 mg tablet yes indeed really", "side2": 7}'), "gemini-3.8-flash")
    assert len(prose["tokens"]) <= 12 and all(len(t) <= 12 and t.isascii() for t in prose["tokens"])
    assert "<" not in " ".join(prose["tokens"])
    assert ai_reader.parse_reply(_reply("not json"), "gemini-3.8-flash") is None
    assert ai_reader.parse_reply({}, "gemini-3.8-flash") is None


def test_thinking_tokens_are_billed_as_output():
    data = _reply('{"side1": "A", "side2": ""}', tokens_in=1000, tokens_out=10)
    data["usageMetadata"]["thoughtsTokenCount"] = 90
    assert ai_reader.parse_reply(data, "gemini-3.1-pro-preview")["cost_micros"] == round(1000 * 2.0 + 100 * 12.0)


def test_should_run():
    assert ai_reader.should_run("off", False) is False
    assert ai_reader.should_run("fallback", False) is True
    assert ai_reader.should_run("fallback", True) is False
    assert ai_reader.should_run("always", True) is True


# ---- the call itself -------------------------------------------------------------------

def test_read_is_inert_without_a_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with patch.object(ai_reader.requests, "post") as post:
        assert ai_reader.read([b"x"], "gemini-3.8-flash", 1000) is None
    post.assert_not_called()


def test_read_respects_the_daily_cap(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    with patch.object(ai_reader, "calls_last_day", return_value=1000), patch.object(ai_reader.requests, "post") as post:
        assert ai_reader.read([b"x"], "gemini-3.8-flash", 1000) is None
    post.assert_not_called()


def test_read_sends_key_in_header_and_survives_failures(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret-key")
    ok = MagicMock(status_code=200)
    ok.json.return_value = _reply('{"side1": "BX", "side2": "2", "confidence": "high"}')
    with patch.object(ai_reader, "calls_last_day", return_value=0), patch.object(ai_reader.requests, "post", return_value=ok) as post:
        out = ai_reader.read([b"a", b"b", b"c"], "no-such-model", 10)
    assert out["tokens"] == ["BX", "2"]
    url, kwargs = post.call_args[0][0], post.call_args[1]
    assert "secret-key" not in url and kwargs["headers"]["x-goog-api-key"] == "secret-key"
    assert ai_reader.DEFAULT_MODEL in url  # unknown model falls back to the default
    assert len(kwargs["json"]["contents"][0]["parts"]) == 3  # prompt + two photos, never more
    with patch.object(ai_reader, "calls_last_day", return_value=0), patch.object(ai_reader.requests, "post", side_effect=RuntimeError("boom")):
        assert ai_reader.read([b"a"], "gemini-3.8-flash", 10) is None
    with patch.object(ai_reader, "calls_last_day", return_value=0), patch.object(ai_reader.requests, "post", return_value=MagicMock(status_code=429, text="slow down")):
        assert ai_reader.read([b"a"], "gemini-3.8-flash", 10) is None


# ---- wiring in the identification ------------------------------------------------------

def _cand(slug, score):
    return SimpleNamespace(slug=slug, score=score, medicine_name=slug, splimprint="", color="", shape="", strength="", image_urls=[])


@contextmanager
def _pipeline(reader_tokens, catalogue, mode, ai_result, key="k", used=("large",), trust_base=False):
    """catalogue: {"TOKENS JOINED": [(slug, score)]} -> what the text matcher returns for those tokens."""
    def fake_identify(req):
        return SimpleNamespace(candidates=[_cand(s, sc) for s, sc in catalogue.get(" ".join(req.imprint_tokens), [])])

    async def fake_reader(raws):
        return list(reader_tokens), [" ".join(reader_tokens)] if reader_tokens else [], list(used)

    flags = {"ai_reader_mode": mode, "ai_reader_model": "gemini-3.8-flash", "ai_reader_daily_cap": 1000,
             "reader_trust_base": trust_base}
    with patch.dict(os.environ, {"GEMINI_API_KEY": key} if key else {}, clear=False), \
         patch.object(ip, "read_flags", return_value=flags), \
         patch.object(ip, "_read_imprint", fake_reader), \
         patch.object(ip, "identify_pill", fake_identify), \
         patch.object(ip, "_bounded_jpeg", lambda raw: raw), \
         patch.object(ip, "_vision_hits", return_value=[]), \
         patch.object(ip.ai_reader, "read", return_value=ai_result) as ai_read:
        if not key:
            os.environ.pop("GEMINI_API_KEY", None)
        yield ai_read


AI_BX2 = {"tokens": ["BX", "2"], "side_reads": ["BX", "2"], "confidence": "high", "cost_micros": 1800}


def test_fallback_fills_the_gap_and_the_row_keeps_our_read():
    with _pipeline(["BX", "1"], {"BX 2": [("baxlend-bx-2", 1.0)]}, "fallback", AI_BX2) as ai_read:
        out = ip._identify_sync([b"a", b"b"])
    ai_read.assert_called_once()
    assert out["read_source"] == "ai" and out["imprint_read"] == "BX 2"
    assert out["matches"][0]["slug"] == "baxlend-bx-2" and out["matches"][0]["source"] == "imprint"
    assert out["_trace"] == {"reader_read": "BX 1", "ai": AI_BX2, "read_source": "ai", "reader_used": "large"}


def test_fallback_is_not_called_when_our_reader_is_exact():
    with _pipeline(["C", "73"], {"C 73": [("metoprolol-c-73", 1.0)]}, "fallback", AI_BX2) as ai_read:
        out = ip._identify_sync([b"a"])
    ai_read.assert_not_called()
    assert out["read_source"] == "reader" and out["_trace"]["ai"] is None


def test_always_mode_calls_but_never_overrides_our_exact_match():
    with _pipeline(["C", "73"], {"C 73": [("metoprolol-c-73", 1.0)], "BX 2": [("baxlend-bx-2", 1.0)]}, "always", AI_BX2) as ai_read:
        out = ip._identify_sync([b"a"])
    ai_read.assert_called_once()
    assert out["read_source"] == "reader" and out["matches"][0]["slug"] == "metoprolol-c-73"
    assert out["_trace"]["ai"] == AI_BX2  # recorded for the side-by-side


def test_ai_read_that_is_not_in_the_catalogue_is_ignored():
    with _pipeline([], {}, "fallback", {"tokens": ["ZZ", "999"], "side_reads": ["ZZ 999"], "confidence": "high", "cost_micros": 1500}):
        out = ip._identify_sync([b"a"])
    assert out["read_source"] == "none" and out["matches"] == [] and out["imprint_read"] == ""


def test_no_key_means_off_whatever_the_setting_says():
    with _pipeline([], {"BX 2": [("baxlend-bx-2", 1.0)]}, "always", AI_BX2, key="") as ai_read:
        out = ip._identify_sync([b"a"])
    ai_read.assert_not_called()
    assert out["read_source"] == "none"


def test_a_failing_second_reader_never_breaks_identification():
    with _pipeline(["C", "73"], {"C 73": [("metoprolol-c-73", 0.6)]}, "fallback", None) as ai_read:
        ai_read.side_effect = RuntimeError("boom")
        out = ip._identify_sync([b"a"])
    assert out["read_source"] == "none" and out["matches"][0]["slug"] == "metoprolol-c-73"


# ---- settings --------------------------------------------------------------------------

def test_settings_coerce_and_public_view():
    assert ss._coerce("ai_reader_mode", "always") == "always"
    assert ss._coerce("ai_reader_mode", "yes please") == "off"
    assert ss._coerce("ai_reader_model", "gpt-9") == ai_reader.DEFAULT_MODEL
    assert ss._coerce("ai_reader_daily_cap", 250) == 250
    assert ss._coerce("ai_reader_daily_cap", True) == ai_reader.DEFAULT_DAILY_CAP
    assert ss._coerce("ai_reader_daily_cap", -5) == ai_reader.DEFAULT_DAILY_CAP
    with patch.object(ss, "read_flags", return_value=dict(ss.DEFAULTS)):
        assert set(ss.get_features()) == {"photo_id_enabled", "photo_id_reader_mode"}  # nothing about the AI leaks


def test_feature_update_validates():
    with pytest.raises(Exception):
        ss.FeatureUpdate(ai_reader_mode="sometimes")
    with pytest.raises(Exception):
        ss.FeatureUpdate(ai_reader_daily_cap=10**9)
    assert ss.FeatureUpdate(ai_reader_mode="fallback", ai_reader_daily_cap=0).ai_reader_daily_cap == 0


# ---- the capture row and the admin stats ----------------------------------------------

class _FakeEngine:
    def __init__(self, rows=None):
        self.calls, self.rows = [], rows or []

    @contextmanager
    def _cm(self):
        engine = self

        class Conn:
            def execute(self, sql, params=None):
                engine.calls.append((" ".join(str(sql).split()), params or {}))
                res = MagicMock()
                res.fetchall.return_value = engine.rows
                return res

        yield Conn()

    def begin(self):
        return self._cm()

    def connect(self):
        return self._cm()


def test_capture_row_keeps_our_read_and_records_the_second_reader():
    from routes import identify_feedback as fb

    engine = _FakeEngine()
    with patch.object(fb.database, "db_engine", engine):
        cid = fb.record_capture("BX 1", ["BX", "1"], {}, ["baxlend-bx-2"], False, [], None, AI_BX2, "ai", "base")
    assert cid
    sql, params = engine.calls[0]
    assert "ai_read, ai_confidence, ai_cost_micros, read_source" in sql
    assert params["read"] == "BX 1" and params["ai_read"] == "BX 2" and params["ai_confidence"] == "high"
    assert params["ai_cost"] == 1800 and params["read_source"] == "ai" and params["reader_used"] == "base"


def test_capture_row_without_the_second_reader_has_nulls():
    from routes import identify_feedback as fb

    engine = _FakeEngine()
    with patch.object(fb.database, "db_engine", engine):
        fb.record_capture("C 73", ["C", "73"], {}, [], False, [], None, None, "bogus", "nonsense")
    params = engine.calls[0][1]
    assert params["ai_read"] is None and params["ai_cost"] is None and params["read_source"] is None
    assert params["reader_used"] is None


def test_admin_stats_shape():
    from routes.admin import captures

    engine = _FakeEngine(rows=[(1, 40, 40, 22, 6, 18, 9, 32400), (7, 300, 120, 70, 20, 50, 24, 90000)])
    with patch.object(captures, "_db", return_value=engine):
        out = captures.capture_stats(admin={"role": "superuser"})
    assert [w["days"] for w in out["windows"]] == [1, 7]
    assert out["windows"][0] == {"days": 1, "reads": 40, "tracked": 40, "reader_hits": 22, "base_reads": 6,
                                 "ai_calls": 18, "ai_hits": 9, "cost_usd": 0.0324}
    assert "make_interval" in engine.calls[0][0]


def test_the_cap_fails_closed_when_the_database_is_down(monkeypatch):
    """A call we cannot count is a call we cannot record, so it must not be spent."""
    from services import ai_reader as ar

    monkeypatch.setenv("GEMINI_API_KEY", "k")
    with patch.object(ar.database, "db_engine", None), patch.object(ar.database, "connect_to_database", return_value=False):
        assert ar.calls_last_day() > ar.MAX_DAILY_CAP
        with patch.object(ar.requests, "post") as post:
            assert ar.read([b"x"], "gemini-3.8-flash", 1000) is None
        post.assert_not_called()


# ---- the large model decides, base does not ---------------------------------------------

BASE_PHANTOM = ["93", "756", "PLIVA", "448"]  # one pill, two unrelated real imprints: base invented half


def test_a_base_only_read_never_settles_the_answer():
    """The live failure: base's memorised "PLIVA 448" scored exact and showed a confident wrong pill."""
    with _pipeline(BASE_PHANTOM, {" ".join(BASE_PHANTOM): [("piroxicam-93-756", 1.0)], "SPT 25": [("amlodipine", 1.0)]},
                   "fallback", {"tokens": ["SPT", "25"], "side_reads": ["SPT 25"], "confidence": "high", "cost_micros": 1500},
                   used=("base", "base")) as ai_read:
        out = ip._identify_sync([b"a", b"b"])
    ai_read.assert_called_once()  # base no longer blocks the second reader
    assert out["read_source"] == "ai" and out["matches"][0]["slug"] == "amlodipine"
    assert out["_trace"]["reader_read"] == "93 756 PLIVA 448"  # still recorded for the scoreboard
    assert out["_trace"]["reader_used"] == "base"


def test_the_admin_can_trust_base_again():
    with _pipeline(BASE_PHANTOM, {" ".join(BASE_PHANTOM): [("piroxicam-93-756", 1.0)]}, "fallback", AI_BX2,
                   used=("base", "base"), trust_base=True) as ai_read:
        out = ip._identify_sync([b"a"])
    ai_read.assert_not_called()
    assert out["read_source"] == "reader" and out["matches"][0]["slug"] == "piroxicam-93-756"


def test_a_large_read_still_settles_it():
    with _pipeline(["C", "73"], {"C 73": [("metoprolol-c-73", 1.0)]}, "fallback", AI_BX2, used=("large", "blank")) as ai_read:
        out = ip._identify_sync([b"a"])
    ai_read.assert_not_called()
    assert out["read_source"] == "reader" and out["_trace"]["reader_used"] == "large"
