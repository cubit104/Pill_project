"""Tests for the drug-level search endpoints (routes/drug_search.py).

Database access is mocked; these cover request validation, response shaping,
the NDC display format and the stale-view refresh guard.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


@pytest.fixture()
def client():
    with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None), patch(
        "routes.pill_views.get_pill_views_table_status",
        return_value={"pill_views_table_exists": True, "row_count": 0},
    ):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


class _Row:
    """Row stand-in with tuple indexing and a ._mapping like SQLAlchemy rows."""

    def __init__(self, values, keys=None):
        self._values = list(values)
        self._mapping = dict(zip(keys, values)) if keys else {}

    def __getitem__(self, i):
        return self._values[i]


DRUG_KEYS = ["key", "name", "brand_names", "ingredients", "pill_count", "strengths", "image_filename", "slug", "rxcui"]


def _drug_row(name="Lisinopril", strengths=("2.5 mg", "5 mg", "10 mg"), count=134):
    return _Row([name.lower(), name, "Prinivil", "LISINOPRIL", count, list(strengths), "00093227234.jpg", "lisinopril-20-mg", "314076"], DRUG_KEYS)


def _mock_conn(monkeypatch, execute_side_effect):
    import routes.drug_search as ds

    conn = MagicMock()
    conn.execute.side_effect = execute_side_effect
    cm = MagicMock()
    cm.__enter__.return_value = conn
    cm.__exit__.return_value = False
    engine = MagicMock()
    engine.begin.return_value = cm
    engine.connect.return_value = cm
    monkeypatch.setattr(ds.database, "db_engine", engine)
    monkeypatch.setattr(ds.database, "connect_to_database", lambda: True)
    return conn


def _result(scalar=None, rows=None, fetchone=None):
    r = MagicMock()
    r.scalar.return_value = scalar
    r.fetchall.return_value = rows or []
    r.fetchone.return_value = fetchone
    return r


def test_lookup_groups_drugs_and_paginates(client, monkeypatch):
    # stale flag, count, rows
    conn = _mock_conn(monkeypatch, [_result(scalar=False), _result(scalar=2), _result(rows=[_drug_row(), _drug_row("Lisinopril and Hydrochlorothiazide", ("10 mg / 12.5 mg",), 40)])])
    res = client.get("/api/drugs/lookup?q=lisin&per_page=25")
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 2 and body["total_pages"] == 1
    first = body["results"][0]
    assert first["name"] == "Lisinopril"
    assert first["strengths"] == ["2.5 mg", "5 mg", "10 mg"]
    assert first["pill_count"] == 134
    assert first["image_url"].endswith("/00093227234.jpg")
    # no refresh was attempted because the view was fresh
    executed_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "refresh_drug_summary" not in executed_sql


def test_lookup_refreshes_when_stale(client, monkeypatch):
    conn = _mock_conn(monkeypatch, [_result(scalar=True), _result(scalar=True), _result(scalar=None), _result(scalar=0), _result(rows=[])])
    res = client.get("/api/drugs/lookup?q=abc")
    assert res.status_code == 200
    executed_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "pg_try_advisory_xact_lock" in executed_sql
    assert "refresh_drug_summary" in executed_sql


def test_lookup_short_query_returns_empty_without_db(client, monkeypatch):
    conn = _mock_conn(monkeypatch, [])
    res = client.get("/api/drugs/lookup?q=a")
    assert res.status_code == 200
    assert res.json()["results"] == []
    conn.execute.assert_not_called()


def test_suggest_ndc_formats_bare_digits_and_ignores_dashes(client, monkeypatch):
    conn = _mock_conn(
        monkeypatch,
        [_result(rows=[_Row(["00024117190", "0024-1171", "Plavix", "300 mg", "300;1332", "plavix-300-1332", "x.jpg"]), _Row(["0024-1596-01", "0024-1596", "Primaquine Phosphate", "26.3 mg", "", "primaquine", None])])],
    )
    res = client.get("/api/drugs/suggest?q=00-24&mode=ndc")
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "ndc" and body["drugs"] == []
    assert [n["ndc"] for n in body["ndcs"]] == ["00024-1171-90", "0024-1596-01"]
    assert body["ndcs"][0]["drug_name"] == "Plavix" and body["ndcs"][0]["strength"] == "300 mg"
    assert body["ndcs"][1]["image_url"] is None
    params = conn.execute.call_args_list[0].args[1]
    assert params["like_q"] == "0024%"


def test_suggest_ndc_needs_three_digits(client, monkeypatch):
    conn = _mock_conn(monkeypatch, [])
    res = client.get("/api/drugs/suggest?q=00&mode=ndc")
    assert res.status_code == 200 and res.json()["ndcs"] == []
    conn.execute.assert_not_called()


def test_suggest_drug_returns_summary_rows(client, monkeypatch):
    _mock_conn(monkeypatch, [_result(scalar=False), _result(rows=[_drug_row()])])
    res = client.get("/api/drugs/suggest?q=Lis&limit=5")
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "drug" and body["ndcs"] == []
    assert body["drugs"][0]["name"] == "Lisinopril"


def test_suggest_rejects_unknown_mode(client):
    assert client.get("/api/drugs/suggest?q=abc&mode=imprint").status_code == 422


def test_drug_pills_filters_by_strength_and_shapes_rows(client, monkeypatch):
    pill = _Row(["Lisinopril", "E101", "PINK", "OVAL", "62135-642-90", "314076", "lisinopril-e101", "10 mg", "Chartwell RX, LLC", "a.jpg,b.jpg"])
    conn = _mock_conn(monkeypatch, [_result(scalar=False), _result(fetchone=_drug_row()), _result(scalar=1), _result(rows=[pill])])
    res = client.get("/api/drugs/pills?name=Lisinopril&strength=10%20MG")
    assert res.status_code == 200
    body = res.json()
    assert body["drug"]["name"] == "Lisinopril"
    assert body["total"] == 1
    row = body["results"][0]
    assert row["slug"] == "lisinopril-e101" and row["strength"] == "10 mg" and row["manufacturer"] == "Chartwell RX, LLC"
    assert row["has_multiple_images"] is True and len(row["images"]) == 2
    params = conn.execute.call_args_list[2].args[1]
    assert params["key"] == "lisinopril" and params["strength"] == "10 mg"


def test_drug_pills_503_when_view_missing(client, monkeypatch):
    from sqlalchemy.exc import ProgrammingError

    def boom(*_a, **_k):
        raise ProgrammingError("SELECT stale", {}, Exception('relation "drug_summary_state" does not exist'))

    _mock_conn(monkeypatch, boom)
    res = client.get("/api/drugs/pills?name=Lisinopril")
    assert res.status_code == 503
    assert "migration" in res.json()["detail"]


def test_format_ndc():
    from routes.drug_search import format_ndc

    assert format_ndc("00024117190") == "00024-1171-90"
    assert format_ndc("0024-1171-90") == "0024-1171-90"
    assert format_ndc(" ") is None
    assert format_ndc(None) is None
