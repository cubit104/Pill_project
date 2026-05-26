import time
from unittest.mock import MagicMock

from services.synonym_resolver import (
    _fetch_json,
    ensure_synonym_mapping,
    filter_self_from_brands,
    get_synonyms_for_rxcui,
)


def test_filter_self_from_brands_case_insensitive_match():
    assert filter_self_from_brands(["Bayer", "Bufferin", "Ecotrin"], "bayer") == ["Bufferin", "Ecotrin"]


def test_filter_self_from_brands_empty_input():
    assert filter_self_from_brands([], "Plavix") == []


def test_filter_self_from_brands_single_self():
    assert filter_self_from_brands(["Plavix"], "Plavix") == []


def test_filter_self_from_brands_no_match():
    assert filter_self_from_brands(["Bayer", "Ecotrin"], "Unknown") == ["Bayer", "Ecotrin"]


def test_filter_self_from_brands_case_insensitive_phrase():
    assert filter_self_from_brands(["BAYER ASPIRIN", "Bufferin"], "Bayer Aspirin") == ["Bufferin"]


def test_ensure_synonym_mapping_happy_path(monkeypatch):
    calls = []

    def fake_fetch(url, params=None, timeout=15, client=None, deadline=None):
        calls.append(url)
        if "related.json?tty=IN+MIN" in url:
            return {
                "relatedGroup": {
                    "conceptGroup": [
                        {"tty": "IN", "conceptProperties": [{"rxcui": "1191", "name": "ASPIRIN"}]}
                    ]
                }
            }
        if url.endswith("/rxcui/123/properties.json"):
            return {"properties": {"tty": "SBD"}}
        if url.endswith("/rxcui/1191/properties.json"):
            return {"properties": {"name": "ASPIRIN"}}
        if "related.json?tty=BN" in url:
            return {
                "relatedGroup": {
                    "conceptGroup": [
                        {
                            "tty": "BN",
                            "conceptProperties": [
                                {"name": "Bufferin"},
                                {"name": "BAYER"},
                                {"name": "bayer"},
                            ],
                        }
                    ]
                }
            }
        return None

    monkeypatch.setattr("services.synonym_resolver._fetch_json", fake_fetch)

    conn = MagicMock()
    executed = []

    def execute(sql, params=None):
        sql_str = str(sql)
        executed.append((sql_str, params or {}))
        res = MagicMock()
        if "FROM rxcui_to_ingredient" in sql_str and "SELECT ingredient_rxcui" in sql_str:
            res.fetchone.return_value = None
        elif "FROM drug_synonyms" in sql_str and "SELECT 1" in sql_str:
            res.fetchone.return_value = None
        else:
            res.fetchone.return_value = None
        return res

    conn.execute.side_effect = execute
    ensure_synonym_mapping(conn, "123")

    syn_inserts = [p for s, p in executed if "INSERT INTO drug_synonyms" in s]
    map_inserts = [p for s, p in executed if "INSERT INTO rxcui_to_ingredient" in s]
    assert syn_inserts, "should insert synonym row"
    assert map_inserts, "should insert mapping row"
    assert syn_inserts[0]["bn"] == ["Bayer", "Bufferin"]
    assert any("related.json?tty=BN" in c for c in calls)


def test_ensure_synonym_mapping_no_match(monkeypatch):
    def fake_fetch(url, params=None, timeout=15, client=None, deadline=None):
        if "related.json?tty=IN+MIN" in url:
            return {"relatedGroup": {"conceptGroup": []}}
        return None

    monkeypatch.setattr("services.synonym_resolver._fetch_json", fake_fetch)

    conn = MagicMock()
    executed = []

    def execute(sql, params=None):
        sql_str = str(sql)
        executed.append(sql_str)
        res = MagicMock()
        res.fetchone.return_value = None
        return res

    conn.execute.side_effect = execute
    ensure_synonym_mapping(conn, "999")

    assert not any("INSERT INTO drug_synonyms" in s for s in executed)
    assert not any("INSERT INTO rxcui_to_ingredient" in s for s in executed)


def test_fetch_json_skips_retry_when_deadline_is_nearly_exhausted(monkeypatch):
    class FakeResponse:
        status_code = 500

    class FakeClient:
        def __init__(self):
            self.calls = 0

        def get(self, url, params=None, timeout=None):
            self.calls += 1
            return FakeResponse()

    sleep_calls = []
    monkeypatch.setattr("services.synonym_resolver.time.sleep", lambda seconds: sleep_calls.append(seconds))

    client = FakeClient()
    assert _fetch_json("https://example.test/fail", client=client, deadline=time.monotonic() + 0.1) is None
    assert client.calls == 1
    assert sleep_calls == []


def test_get_synonyms_for_rxcui_sorts_brands():
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = (
        "1191",
        "Aspirin",
        ["zeta", "Bufferin", "alpha"],
        "SBD",
    )

    out = get_synonyms_for_rxcui(conn, "123")
    assert out["brand_names"] == ["alpha", "Bufferin", "zeta"]
