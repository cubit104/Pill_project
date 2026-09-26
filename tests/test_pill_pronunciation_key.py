"""A brand pill's "pronounced as" is kept under its own name, not the generic's.

Before, the editor saved whatever was typed on a Zestril pill under "lisinopril" (the first lookup key), and every
lisinopril page then read "ZES-tril". Generic pills are unchanged.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
import main as app_module  # noqa: E402
from routes.admin.auth import get_admin_user  # noqa: E402
from services.drug_pronunciation import find_pill_pronunciation, pill_pronunciation_key, pill_pronunciations  # noqa: E402

EDITOR = {"id": "u-1", "email": "team@test.com", "role": "editor"}


class _Conn:
    """rxcui_to_ingredient knows the product's type (SBD = brand) and its generic; drug_pronunciations has `rows`."""

    def __init__(self, tty=None, generic=None, brands=(), rows=None, pill=None):
        self.tty, self.generic, self.brands, self.rows, self.pill = tty, generic, list(brands), rows or {}, pill
        self.log: list = []

    @contextmanager
    def begin_nested(self):
        yield self

    def execute(self, sql, params=None):
        s = " ".join(str(sql).lower().split())
        params = params or {}
        self.log.append((s, params))
        result = MagicMock()
        result.fetchall.return_value = []
        if s.startswith("select r.product_rxcui"):  # the grid's one query for every pill
            result.fetchall.return_value = [(r, self.tty, self.generic, self.brands) for r in params["rxcuis"]] if self.tty else []
            return result
        if s.startswith("select drug_name_lower"):
            result.fetchall.return_value = [(k, *self.rows[k]) for k in params["keys"] if k in self.rows]
            return result
        if s.startswith("select product_tty from rxcui_to_ingredient"):
            one = (self.tty,) if self.tty else None
        elif "from rxcui_to_ingredient" in s:
            one = (self.generic, self.brands) if self.generic else None
        elif "from drug_pronunciations" in s:
            one = self.rows.get(params.get("drug_name_lower"))
        elif "from pillfinder" in s:
            one = self.pill
        else:
            one = None
        result.fetchone.return_value = one
        return result


def test_a_brand_pill_keeps_its_own_generic_pills_keep_the_generic():
    assert pill_pronunciation_key(_Conn(tty="SBD", generic="lisinopril", brands=["Zestril"]), "ZESTRIL", "104377") == "zestril"
    assert pill_pronunciation_key(_Conn(tty="BPCK", generic="x"), "Some Pack", "1") == "some pack"
    assert pill_pronunciation_key(_Conn(tty="SCD", generic="lisinopril", brands=["Zestril"]), "Lisinopril 10mg", "314077") == "lisinopril"
    assert pill_pronunciation_key(_Conn(), "Lisinopril 10mg", None) == "lisinopril 10mg"  # no RxCUI: as before
    assert pill_pronunciation_key(_Conn(), "  ", None) is None


def test_a_brand_pill_shows_its_own_and_until_then_the_generics():
    rows = {"zestril": ("ZES-tril", None, "manual"), "lisinopril": ("lye-SIN-oh-pril", "https://a/l.mp3", "medlineplus")}
    own = find_pill_pronunciation(_Conn(tty="SBD", generic="lisinopril", rows=rows), "ZESTRIL", "104377", include_meta=True)
    assert own == {"pronunciation_text": "ZES-tril", "audio_url": None, "source": "manual", "drug_name_matched": "zestril"}
    del rows["zestril"]
    fallback = find_pill_pronunciation(_Conn(tty="SBD", generic="lisinopril", rows=rows), "ZESTRIL", "104377", include_meta=True)
    assert fallback["pronunciation_text"] == "lye-SIN-oh-pril" and fallback["drug_name_matched"] == "lisinopril"
    generic = find_pill_pronunciation(_Conn(tty="SCD", generic="lisinopril", rows=rows), "Lisinopril", "314077", include_meta=True)
    assert generic["drug_name_matched"] == "lisinopril"


@contextmanager
def _client(conn):
    engine = MagicMock()

    @contextmanager
    def cm():
        yield conn

    engine.connect.side_effect = cm
    engine.begin.side_effect = cm
    app_module.app.dependency_overrides[get_admin_user] = lambda: EDITOR
    original = database.db_engine
    database.db_engine = engine
    try:
        with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
            with TestClient(app_module.app) as client:
                yield client
    finally:
        database.db_engine = original
        app_module.app.dependency_overrides.pop(get_admin_user, None)


def test_the_editor_saves_a_brand_pills_pronunciation_under_the_brand():
    conn = _Conn(tty="SBD", generic="lisinopril", brands=["Zestril"], pill=("ZESTRIL", "104377"))
    with _client(conn) as client:
        resp = client.put("/api/admin/pills/p1/pronunciation", json={"pronunciation_text": "ZES-tril"})
    assert resp.status_code == 200, resp.text
    saved = next(p for s, p in conn.log if s.startswith("insert into drug_pronunciations"))
    assert saved["drug_name_lower"] == "zestril" and saved["pronunciation_text"] == "ZES-tril"


def test_the_editor_still_saves_a_generic_pills_pronunciation_under_the_generic():
    conn = _Conn(tty="SCD", generic="lisinopril", brands=["Zestril"], pill=("Lisinopril 10mg", "314077"))
    with _client(conn) as client:
        assert client.put("/api/admin/pills/p1/pronunciation", json={"pronunciation_text": "lye-SIN-oh-pril"}).status_code == 200
    saved = next(p for s, p in conn.log if s.startswith("insert into drug_pronunciations"))
    assert saved["drug_name_lower"] == "lisinopril"


def test_the_editor_shows_a_brand_pills_own_pronunciation():
    conn = _Conn(tty="SBD", generic="lisinopril", pill=("ZESTRIL", "104377"),
                 rows={"zestril": ("ZES-tril", None, "manual"), "lisinopril": ("lye-SIN-oh-pril", None, "medlineplus")})  # fmt: skip
    with _client(conn) as client:
        body = client.get("/api/admin/pills/p1/pronunciation").json()
    assert body["pronunciation_text"] == "ZES-tril" and body["drug_name_matched"] == "zestril"


def test_the_grid_finds_the_same_as_the_editor_one_pill_at_a_time():
    rows = {"zestril": ("ZES-tril", None, "manual"), "lisinopril": (" lye-SIN-oh-pril ", "https://a/l.mp3", "medlineplus")}
    cases = [
        (dict(tty="SBD", generic="lisinopril", brands=["Zestril"], rows=rows), ("ZESTRIL", "104377")),  # brand, its own
        (dict(tty="SBD", generic="lisinopril", brands=["Zestril"], rows={"lisinopril": rows["lisinopril"]}), ("ZESTRIL", "104377")),
        (dict(tty="SCD", generic="lisinopril", brands=["Zestril"], rows=rows), ("Lisinopril 10mg", "314077")),  # generic
        (dict(tty="SCD", generic=None, rows=rows), ("Lisinopril E101 Tab", "314077")),  # no synonyms: name variants
        (dict(rows=rows), ("Lisinopril 10mg", None)),  # no RxCUI
        (dict(rows={}), ("Unknown", "1")),  # nothing saved
    ]
    for setup, (name, rxcui) in cases:
        conn = _Conn(**setup)
        single = {"key": pill_pronunciation_key(conn, name, rxcui), "found": find_pill_pronunciation(conn, name, rxcui, include_meta=True)}
        assert pill_pronunciations(_Conn(**setup), [(name, rxcui)]) == [single], (setup, name)
    assert pill_pronunciations(_Conn(), []) == []
