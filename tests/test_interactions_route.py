import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


@pytest.fixture()
def client():
    with patch("main.connect_to_database", return_value=True), patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module

        with TestClient(app_module.app) as c:
            yield c


def _mock_conn_for_interactions(monkeypatch):
    import routes.interactions as interactions

    mock_conn = MagicMock()
    mock_engine = MagicMock()
    mock_cm = MagicMock()
    mock_cm.__enter__.return_value = mock_conn
    mock_cm.__exit__.return_value = False
    mock_engine.begin.return_value = mock_cm
    mock_engine.connect.return_value = mock_cm
    monkeypatch.setattr(interactions.database, "db_engine", mock_engine)
    monkeypatch.setattr(interactions.database, "connect_to_database", lambda: True)
    return interactions, mock_conn


def test_interaction_returns_db_pair(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": "Avoid combination.",
            "confidence": "high",
            "source_kaggle": True,
            "source_openfda": True,
            "source_ddinter": True,
            "management": "Avoid co-administration unless directed by a clinician.",
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: (None, None))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))
    monkeypatch.setattr(interactions, "cache_new_pair_only", lambda *args, **kwargs: None)

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert payload["severity"] == "major"
    assert payload["description"] == "Avoid combination."
    assert payload["spl_text"] is None
    assert payload["reference_text"] is None
    assert payload["management"] == "Avoid co-administration unless directed by a clinician."
    assert payload["source_ddinter"] is True
    assert payload["drug1_generic"] is None
    assert payload["drug2_generic"] is None
    assert payload["drug1_brands"] == []
    assert payload["drug2_brands"] == []


def test_interaction_falls_back_to_live_openfda(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": "template text",
            "confidence": "high",
            "source_kaggle": True,
            "source_openfda": False,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: (None, None))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("Aspirin", "Do not use with ibuprofen"))
    monkeypatch.setattr(
        interactions,
        "cache_new_pair_only",
        lambda *args, **kwargs: None,
    )

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert payload["description"] == "template text"
    assert payload["spl_text"] == "Do not use with ibuprofen"
    assert payload["source_openfda"] is True


def test_interaction_fallback_checks_other_label_with_synonyms(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    def _resolve(conn, name):
        if name == "aspirin":
            return {"rxcui": "1191", "generic_name": "Aspirin", "brand_names": ["Bayer"]}
        return {"rxcui": "5640", "generic_name": "Ibuprofen", "brand_names": ["Advil"]}

    monkeypatch.setattr(interactions, "resolve_drug_name", _resolve)
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": "template text",
            "confidence": "high",
            "source_kaggle": True,
            "source_openfda": False,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: (None, None))

    def _fetch(rxcui, generic_name):
        if rxcui == "1191":
            return "Aspirin", "No interaction listed here."
        return "Ibuprofen", "Avoid combining with Bayer products."

    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", _fetch)
    monkeypatch.setattr(
        interactions,
        "cache_new_pair_only",
        lambda *args, **kwargs: None,
    )

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "advil"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert payload["description"] == "template text"
    assert "Bayer" in payload["spl_text"]


def test_interaction_uses_first_cached_text_when_source_is_unrecognized(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": "template text",
            "confidence": "high",
            "source_kaggle": True,
            "source_openfda": False,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: ("Curated warning text", "manual"))
    fetch_calls = []
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: fetch_calls.append((r, g)) or ("", ""))
    monkeypatch.setattr(interactions, "cache_new_pair_only", lambda *args, **kwargs: None)

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["description"] == "template text"
    assert payload["spl_text"] == "Curated warning text"
    assert fetch_calls == []


def test_interaction_skips_pair_write_when_openfda_pair_already_current(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    cache_calls = []

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": "Current OpenFDA text",
            "confidence": "low",
            "source_kaggle": False,
            "source_openfda": True,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: ("Current OpenFDA text", "openfda"))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))
    monkeypatch.setattr(
        interactions,
        "cache_new_pair_only",
        lambda conn, r1, r2, d1, d2, desc: cache_calls.append((r1, r2, d1, d2, desc)),
    )

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["description"] == "Current OpenFDA text"
    assert payload["spl_text"] == "Current OpenFDA text"
    assert payload["source_openfda"] is True
    assert cache_calls == []


def test_interaction_returns_long_description_with_spl_text_present(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    long_description = "A" * 850

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": long_description,
            "confidence": "high",
            "source_kaggle": True,
            "source_openfda": False,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: ("Short SPL warning text.", "spl_professional"))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))
    monkeypatch.setattr(interactions, "cache_new_pair_only", lambda *args, **kwargs: None)

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["description"] == long_description
    assert payload["spl_text"] == "Short SPL warning text."


def test_interaction_uses_spl_text_as_description_when_pair_description_missing(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "major",
            "description": None,
            "confidence": "medium",
            "source_kaggle": False,
            "source_openfda": False,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: ("Targeted SPL text", "spl_professional"))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["description"] == "Targeted SPL text"
    assert payload["reference_text"] == "Targeted SPL text"


def test_batch_interactions_returns_pairs_food_disease_and_summary(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    resolve_calls = []
    pair_call_kwargs = []

    def _resolve(conn, name):
        resolve_calls.append(name)
        return {"rxcui": name.upper(), "generic_name": name.title(), "brand_names": []}

    def _pair(conn, d1, d2, r1, r2, allow_live_openfda=True):
        pair_call_kwargs.append(allow_live_openfda)
        return interactions.InteractionResponse(
            drug1=d1,
            drug2=d2,
            drug1_generic=r1.get("generic_name"),
            drug2_generic=r2.get("generic_name"),
            drug1_brands=[],
            drug2_brands=[],
            drug1_rxcui=r1.get("rxcui"),
            drug2_rxcui=r2.get("rxcui"),
            severity="major" if {d1, d2} == {"aspirin", "warfarin"} else None,
            description="Avoid together." if {d1, d2} == {"aspirin", "warfarin"} else None,
            spl_text=None,
            reference_text=None,
            management="Use alternative therapy." if {d1, d2} == {"aspirin", "warfarin"} else None,
            confidence="high" if {d1, d2} == {"aspirin", "warfarin"} else None,
            source_kaggle=False,
            source_openfda=False,
            source_ddinter={d1, d2} == {"aspirin", "warfarin"},
            found={d1, d2} == {"aspirin", "warfarin"},
            message=None if {d1, d2} == {"aspirin", "warfarin"} else "No interaction data found",
        )

    monkeypatch.setattr(interactions, "resolve_drug_name", _resolve)
    monkeypatch.setattr(interactions, "_pair_interaction_from_resolved", _pair)
    monkeypatch.setattr(
        interactions,
        "_fetch_drug_food_interactions",
        lambda conn, resolved_map: [
            {
                "selected_drug": "aspirin",
                "matched_drug_name": "Aspirin",
                "food_name": "Alcohol",
                "level": "moderate",
                "interaction": "May increase bleeding risk.",
                "management": "Limit alcohol intake.",
                "ref_text": "DDInter ref",
                "source_ddinter": True,
            }
        ],
    )
    monkeypatch.setattr(
        interactions,
        "_fetch_drug_disease_interactions",
        lambda conn, resolved_map: [
            {
                "selected_drug": "warfarin",
                "matched_drug_name": "Warfarin",
                "disease_name": "Liver disease",
                "level": "major",
                "text": "Requires strict monitoring.",
                "ref_text": "DDInter disease ref",
                "source_ddinter": True,
            }
        ],
    )

    response = client.post("/api/interactions/check", json={"drugs": ["aspirin", "warfarin", "aspirin"]})
    assert response.status_code == 200
    payload = response.json()
    assert payload["drugs"] == ["aspirin", "warfarin"]
    sections = payload["summary"]["sections"]
    assert sections["drug_drug"] == 1
    assert sections["drug_food"] == 1
    assert sections["drug_disease"] == 1
    assert sections["food_truncated"] is False
    assert sections["disease_truncated"] is False
    assert payload["summary"]["severity"]["major"] == 1
    assert len(payload["pairs"]) == 1
    assert payload["food_interactions"][0]["food_name"] == "Alcohol"
    assert payload["disease_interactions"][0]["disease_name"] == "Liver disease"
    assert sorted(resolve_calls) == ["aspirin", "warfarin"]
    assert all(v is False for v in pair_call_kwargs), "batch endpoint must pass allow_live_openfda=False"


def test_batch_interactions_requires_at_least_two_unique_drugs(client, monkeypatch):
    _mock_conn_for_interactions(monkeypatch)
    response = client.post("/api/interactions/check", json={"drugs": ["aspirin", "aspirin"]})
    assert response.status_code == 422


def test_fetch_openfda_interaction_text_escapes_generic_quotes(monkeypatch):
    import routes.interactions as interactions

    calls = []

    class _MockResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"results": [{"drug_interactions": ["Use caution"], "openfda": {"generic_name": ["Drug"]}}]}

    def _mock_get(url, params, timeout):
        calls.append((url, params, timeout))
        return _MockResponse()

    monkeypatch.setattr(interactions.httpx, "get", _mock_get)
    interactions.fetch_openfda_interaction_text("123", 'alpha "beta"')

    assert calls
    assert calls[0][1]["search"] == 'openfda.generic_name:"alpha \\"beta\\""'


def test_resolve_endpoint_returns_resolution_shape(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {
            "rxcui": "1191",
            "generic_name": "Aspirin",
            "brand_names": ["Bayer"],
        },
    )

    response = client.get("/api/interactions/resolve", params={"name": "aspirin"})
    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "name": "aspirin",
        "rxcui": "1191",
        "generic_name": "Aspirin",
        "brand_names": ["Bayer"],
    }


# ---------------------------------------------------------------------------
# Tests for GET /api/interactions/{drug}
# ---------------------------------------------------------------------------

def test_drug_list_returns_interactions(client, monkeypatch):
    """Basic happy path: known drug, has interactions."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": "1191", "generic_name": "Aspirin", "brand_names": ["Bayer"]},
    )
    monkeypatch.setattr(
        interactions,
        "get_interactions_for_drug",
        lambda conn, rxcui, severity, page, per_page: (
            2,
            {"major": 1, "moderate": 1, "minor": 0, "unknown": 0},
            [
                {"drug_name": "Warfarin", "rxcui": "11289", "severity": "major",
                 "description": "Avoid.", "confidence": "medium", "source_kaggle": True, "source_openfda": False},
                {"drug_name": "Ibuprofen", "rxcui": "5640", "severity": "moderate",
                 "description": "Monitor closely.", "confidence": "medium", "source_kaggle": True, "source_openfda": False},
            ],
        ),
    )

    response = client.get("/api/interactions/aspirin")
    assert response.status_code == 200
    payload = response.json()
    assert payload["drug"] == "aspirin"
    assert payload["rxcui"] == "1191"
    assert payload["generic_name"] == "Aspirin"
    assert payload["brand_names"] == ["Bayer"]
    assert payload["total"] == 2
    assert payload["page"] == 1
    assert payload["per_page"] == 20
    assert payload["severity_summary"]["major"] == 1
    assert payload["severity_summary"]["moderate"] == 1
    assert payload["severity_summary"]["minor"] == 0
    assert len(payload["interactions"]) == 2
    assert payload["interactions"][0]["drug_name"] == "Warfarin"
    assert payload["interactions"][0]["severity"] == "major"
    assert payload["interactions"][1]["drug_name"] == "Ibuprofen"


def test_drug_list_unknown_drug_returns_404(client, monkeypatch):
    """Unresolvable drug name should return 404."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": None, "generic_name": None, "brand_names": []},
    )

    response = client.get("/api/interactions/notadrug")
    assert response.status_code == 404
    assert "notadrug" in response.json()["detail"]


def test_drug_list_severity_filter_forwarded(client, monkeypatch):
    """severity query param must be passed through to get_interactions_for_drug,
    and severity_summary must reflect the full unfiltered counts even when the
    interactions list is filtered."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    captured: dict = {}

    def _get_interactions(conn, rxcui, severity, page, per_page):
        captured["severity"] = severity
        # Simulate: 3 total interactions (1 major, 2 moderate) but only 1 is
        # returned after the "major" filter; the summary covers all 3.
        return (
            1,
            {"major": 1, "moderate": 2, "minor": 0, "unknown": 0},
            [{"drug_name": "Warfarin", "rxcui": "11289", "severity": "major",
              "description": "Avoid.", "confidence": "medium", "source_kaggle": True, "source_openfda": False}],
        )

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": "1191", "generic_name": "Aspirin", "brand_names": []},
    )
    monkeypatch.setattr(interactions, "get_interactions_for_drug", _get_interactions)

    response = client.get("/api/interactions/aspirin", params={"severity": "major"})
    assert response.status_code == 200
    assert captured["severity"] == "major"
    data = response.json()
    # severity_summary must reflect the full unfiltered totals, not just the filtered page
    assert data["severity_summary"]["major"] == 1
    assert data["severity_summary"]["moderate"] == 2
    # interactions list is filtered to "major" only
    assert len(data["interactions"]) == 1
    assert data["interactions"][0]["severity"] == "major"


def test_drug_list_invalid_severity_returns_422(client, monkeypatch):
    """Unrecognised severity value should be rejected with 422 before hitting DB."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": "1191", "generic_name": "Aspirin", "brand_names": []},
    )

    response = client.get("/api/interactions/aspirin", params={"severity": "lethal"})
    assert response.status_code == 422


def test_drug_list_pagination_params_forwarded(client, monkeypatch):
    """page and per_page must be forwarded to helper and reflected in the response."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    captured: dict = {}

    def _get_interactions(conn, rxcui, severity, page, per_page):
        captured["page"] = page
        captured["per_page"] = per_page
        return 0, {"major": 0, "moderate": 0, "minor": 0, "unknown": 0}, []

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": "1191", "generic_name": "Aspirin", "brand_names": []},
    )
    monkeypatch.setattr(interactions, "get_interactions_for_drug", _get_interactions)

    response = client.get("/api/interactions/aspirin", params={"page": 3, "per_page": 50})
    assert response.status_code == 200
    assert captured["page"] == 3
    assert captured["per_page"] == 50
    payload = response.json()
    assert payload["page"] == 3
    assert payload["per_page"] == 50


def test_drug_list_empty_interactions_returns_200(client, monkeypatch):
    """Known drug with zero interactions should return 200 with empty list, not 404."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": "9999", "generic_name": "RareDrug", "brand_names": []},
    )
    monkeypatch.setattr(
        interactions,
        "get_interactions_for_drug",
        lambda conn, rxcui, severity, page, per_page: (
            0, {"major": 0, "moderate": 0, "minor": 0, "unknown": 0}, []
        ),
    )

    response = client.get("/api/interactions/raredrug")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0
    assert payload["interactions"] == []


def test_resolve_route_not_captured_by_drug_path_param(client, monkeypatch):
    """/api/interactions/resolve must NOT be matched by /{drug} path param."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(
        interactions,
        "resolve_drug_name",
        lambda conn, name: {"rxcui": "1191", "generic_name": "Aspirin", "brand_names": ["Bayer"]},
    )

    response = client.get("/api/interactions/resolve", params={"name": "aspirin"})
    assert response.status_code == 200
    payload = response.json()
    # Must have the resolve shape, not the list shape
    assert "rxcui" in payload
    assert "interactions" not in payload
    assert "severity_summary" not in payload


def test_suggestions_endpoint_returns_unique_names(client, monkeypatch):
    _, mock_conn = _mock_conn_for_interactions(monkeypatch)

    mock_conn.execute.return_value.fetchall.return_value = [
        ("Aspirin",),
        ("aspirin ",),
        ("Atorvastatin",),
        ("",),
        (None,),
    ]

    response = client.get("/api/interactions/suggestions", params={"q": "as", "limit": 8})
    assert response.status_code == 200
    assert response.json() == ["Aspirin", "Atorvastatin"]

    _, params = mock_conn.execute.call_args[0]
    assert params["prefix"] == "as%"
    assert params["lim"] == 8


def test_suggestions_short_query_returns_empty(client):
    response = client.get("/api/interactions/suggestions", params={"q": "a"})
    assert response.status_code == 200
    assert response.json() == []


def test_suggestions_route_not_captured_by_drug_path_param(client, monkeypatch):
    _, mock_conn = _mock_conn_for_interactions(monkeypatch)
    mock_conn.execute.return_value.fetchall.return_value = [("Aspirin",)]

    response = client.get("/api/interactions/suggestions", params={"q": "as"})
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)
    assert payload == ["Aspirin"]


def test_suggestions_sql_uses_drug_name_suggestions_table(client, monkeypatch):
    """The suggestions endpoint must query drug_name_suggestions for fast prefix lookup."""
    _, mock_conn = _mock_conn_for_interactions(monkeypatch)
    mock_conn.execute.return_value.fetchall.return_value = [("Lipitor",)]

    response = client.get("/api/interactions/suggestions", params={"q": "li", "limit": 5})
    assert response.status_code == 200
    assert response.json() == ["Lipitor"]

    # Inspect the SQL that was executed — must use the pre-computed table
    executed_sql = str(mock_conn.execute.call_args[0][0])
    assert "drug_name_suggestions" in executed_sql
    assert "lower_name" in executed_sql


# ---------------------------------------------------------------------------
# Tests for interaction_text field
# ---------------------------------------------------------------------------

def test_single_pair_includes_interaction_text_from_cache(client, monkeypatch):
    """interaction_text must be populated from cached label text in the single-pair endpoint."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "moderate",
            "description": "May increase bleeding.",
            "confidence": "high",
            "source_kaggle": True,
            "source_openfda": False,
            "source_ddinter": False,
            "management": None,
        },
    )
    monkeypatch.setattr(
        interactions,
        "search_cached_label_text",
        lambda conn, r, n: ("FDA label paragraph about anticoagulants.", "spl_professional"),
    )
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))
    monkeypatch.setattr(interactions, "cache_new_pair_only", lambda *args, **kwargs: None)

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["interaction_text"] == "FDA label paragraph about anticoagulants."
    assert payload["spl_text"] == "FDA label paragraph about anticoagulants."
    assert payload["reference_text"] == "FDA label paragraph about anticoagulants."


def test_single_pair_interaction_text_none_when_no_cache(client, monkeypatch):
    """interaction_text must be None when no cached label text is available."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(
        interactions,
        "get_interaction_pair",
        lambda conn, r1, r2: {
            "severity": "minor",
            "description": "Minor interaction.",
            "confidence": "medium",
            "source_kaggle": True,
            "source_openfda": False,
            "source_ddinter": False,
            "management": None,
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: (None, None))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))
    monkeypatch.setattr(interactions, "cache_new_pair_only", lambda *args, **kwargs: None)

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["interaction_text"] is None
    assert payload["spl_text"] is None


def test_batch_pair_includes_interaction_text_from_cache(client, monkeypatch):
    """interaction_text must be present in batch pair responses when cached label text matches."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    def _resolve(conn, name):
        return {"rxcui": name.upper(), "generic_name": name.title(), "brand_names": []}

    def _pair(conn, d1, d2, r1, r2, allow_live_openfda=True):
        return interactions.InteractionResponse(
            drug1=d1, drug2=d2,
            drug1_generic=r1.get("generic_name"), drug2_generic=r2.get("generic_name"),
            drug1_brands=[], drug2_brands=[],
            drug1_rxcui=r1.get("rxcui"), drug2_rxcui=r2.get("rxcui"),
            severity="moderate",
            description="Kaggle description text.",
            interaction_text="Cached FDA interaction paragraph.",
            spl_text="Cached FDA interaction paragraph.",
            reference_text="Cached FDA interaction paragraph.",
            management=None,
            confidence="high",
            source_kaggle=True, source_openfda=False, source_ddinter=False,
            found=True, message=None,
        )

    monkeypatch.setattr(interactions, "resolve_drug_name", _resolve)
    monkeypatch.setattr(interactions, "_pair_interaction_from_resolved", _pair)
    monkeypatch.setattr(interactions, "_fetch_drug_food_interactions", lambda conn, rm: [])
    monkeypatch.setattr(interactions, "_fetch_drug_disease_interactions", lambda conn, rm: [])

    response = client.post("/api/interactions/check", json={"drugs": ["aspirin", "warfarin"]})
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["pairs"]) == 1
    pair = payload["pairs"][0]
    assert pair["interaction_text"] == "Cached FDA interaction paragraph."
    assert pair["description"] == "Kaggle description text."


def test_batch_pair_interaction_text_field_present_when_none(client, monkeypatch):
    """interaction_text field must always be present in batch pair responses (None when missing)."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    def _resolve(conn, name):
        return {"rxcui": name.upper(), "generic_name": name.title(), "brand_names": []}

    def _pair(conn, d1, d2, r1, r2, allow_live_openfda=True):
        return interactions.InteractionResponse(
            drug1=d1, drug2=d2,
            drug1_generic=None, drug2_generic=None,
            drug1_brands=[], drug2_brands=[],
            drug1_rxcui=r1.get("rxcui"), drug2_rxcui=r2.get("rxcui"),
            severity=None,
            description=None,
            interaction_text=None,
            spl_text=None,
            reference_text=None,
            management=None,
            confidence=None,
            source_kaggle=False, source_openfda=False, source_ddinter=False,
            found=False, message="No interaction data found",
        )

    monkeypatch.setattr(interactions, "resolve_drug_name", _resolve)
    monkeypatch.setattr(interactions, "_pair_interaction_from_resolved", _pair)
    monkeypatch.setattr(interactions, "_fetch_drug_food_interactions", lambda conn, rm: [])
    monkeypatch.setattr(interactions, "_fetch_drug_disease_interactions", lambda conn, rm: [])

    response = client.post("/api/interactions/check", json={"drugs": ["aspirin", "warfarin"]})
    assert response.status_code == 200
    payload = response.json()
    pair = payload["pairs"][0]
    assert "interaction_text" in pair
    assert pair["interaction_text"] is None


# ---------------------------------------------------------------------------
# Tests for _resolve_to_ingredient_rxcui
# ---------------------------------------------------------------------------

def test_resolve_to_ingredient_rxcui_returns_ingredient():
    """Should return the first ingredient RXCUI from RxNorm related endpoint."""
    import routes.interactions as interactions
    from unittest.mock import patch, MagicMock

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "relatedGroup": {
            "conceptGroup": [
                {"conceptProperties": [{"rxcui": "7646", "name": "omeprazole"}]}
            ]
        }
    }

    with patch("routes.interactions.httpx.get", return_value=mock_response) as mock_get:
        result = interactions._resolve_to_ingredient_rxcui("40790")

    assert result == "7646"
    mock_get.assert_called_once()
    call_args = mock_get.call_args
    assert "40790" in call_args[0][0]
    assert call_args[1]["params"] == {"tty": "IN"}


def test_resolve_to_ingredient_rxcui_falls_back_on_empty():
    """Should return original RXCUI when API returns no ingredient concepts."""
    import routes.interactions as interactions
    from unittest.mock import patch, MagicMock

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "relatedGroup": {"conceptGroup": []}
    }

    with patch("routes.interactions.httpx.get", return_value=mock_response):
        result = interactions._resolve_to_ingredient_rxcui("40790")

    assert result == "40790"


def test_resolve_to_ingredient_rxcui_falls_back_on_http_error():
    """Should return original RXCUI when HTTP call fails."""
    import routes.interactions as interactions
    from unittest.mock import patch, MagicMock

    mock_response = MagicMock()
    mock_response.status_code = 500

    with patch("routes.interactions.httpx.get", return_value=mock_response):
        result = interactions._resolve_to_ingredient_rxcui("40790")

    assert result == "40790"


def test_resolve_to_ingredient_rxcui_falls_back_on_exception():
    """Should return original RXCUI when an exception is raised."""
    import routes.interactions as interactions
    from unittest.mock import patch

    with patch("routes.interactions.httpx.get", side_effect=Exception("network error")):
        result = interactions._resolve_to_ingredient_rxcui("40790")

    assert result == "40790"


def test_resolve_rxcui_from_rxnorm_resolves_to_ingredient():
    """resolve_rxcui_from_rxnorm should resolve brand RXCUI to ingredient RXCUI."""
    import routes.interactions as interactions
    from unittest.mock import patch, MagicMock

    rxnorm_response = MagicMock()
    rxnorm_response.status_code = 200
    rxnorm_response.json.return_value = {"idGroup": {"rxnormId": ["40790"]}}

    ingredient_response = MagicMock()
    ingredient_response.status_code = 200
    ingredient_response.json.return_value = {
        "relatedGroup": {
            "conceptGroup": [
                {"conceptProperties": [{"rxcui": "7646", "name": "omeprazole"}]}
            ]
        }
    }

    with patch("routes.interactions.httpx.get", side_effect=[rxnorm_response, ingredient_response]):
        result = interactions.resolve_rxcui_from_rxnorm("prilosec")

    assert result == "7646"


# ---------------------------------------------------------------------------
# Tests for normalize_severity numeric levels (Requirement 1)
# ---------------------------------------------------------------------------

def test_normalize_severity_numeric_3_is_major():
    from routes.interactions import normalize_severity
    assert normalize_severity("3") == "major"


def test_normalize_severity_numeric_2_is_moderate():
    from routes.interactions import normalize_severity
    assert normalize_severity("2") == "moderate"


def test_normalize_severity_numeric_1_is_minor():
    from routes.interactions import normalize_severity
    assert normalize_severity("1") == "minor"


def test_normalize_severity_numeric_with_whitespace():
    from routes.interactions import normalize_severity
    assert normalize_severity(" 3 ") == "major"


def test_normalize_severity_unknown_value_returns_unknown():
    from routes.interactions import normalize_severity
    assert normalize_severity("99") == "unknown"
    assert normalize_severity("serious") == "unknown"
    assert normalize_severity("") == "unknown"
    assert normalize_severity(None) == "unknown"


def test_normalize_severity_existing_word_mappings_unchanged():
    from routes.interactions import normalize_severity
    assert normalize_severity("major") == "major"
    assert normalize_severity("moderate") == "moderate"
    assert normalize_severity("minor") == "minor"
    assert normalize_severity("unknown") == "unknown"
    assert normalize_severity("contraindicated") == "major"
    assert normalize_severity("high") == "major"
    assert normalize_severity("medium") == "moderate"
    assert normalize_severity("low") == "minor"


# ---------------------------------------------------------------------------
# Tests for get_interaction_pair both-order merge (Requirement 2)
# ---------------------------------------------------------------------------

def test_get_interaction_pair_merges_two_rows():
    """Two rows — Kaggle canonical (moderate, no management) + DDInter reversed
    (major, with management) — must be merged: severity=major, management set,
    both source flags true, confidence=high."""
    from routes.interactions import get_interaction_pair
    from unittest.mock import MagicMock

    # Simulate two DB rows returned by the OR query
    row_kaggle = ("100", "200", "Clopidogrel", "Omeprazole",
                  "Kaggle description text", "moderate", "medium",
                  True, False, False, None)  # source_kaggle, no management
    row_ddinter = ("200", "100", "Omeprazole", "Clopidogrel",
                   None, "major", None,
                   False, False, True, "Avoid concurrent use.")  # source_ddinter, with management

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = [row_kaggle, row_ddinter]

    result = get_interaction_pair(mock_conn, "100", "200")
    assert result is not None
    assert result["severity"] == "major"
    assert result["description"] == "Kaggle description text"
    assert result["management"] == "Avoid concurrent use."
    assert result["source_kaggle"] is True
    assert result["source_ddinter"] is True
    assert result["confidence"] == "high"


def test_get_interaction_pair_single_row_passthrough():
    """Single row must behave identically to old code."""
    from routes.interactions import get_interaction_pair
    from unittest.mock import MagicMock

    row = ("100", "200", "DrugA", "DrugB", "Some description", "moderate", "medium",
           True, False, False, None)

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = [row]

    result = get_interaction_pair(mock_conn, "100", "200")
    assert result is not None
    assert result["severity"] == "moderate"
    assert result["description"] == "Some description"
    assert result["source_kaggle"] is True
    assert result["source_ddinter"] is False
    assert result["management"] is None


def test_get_interaction_pair_returns_none_when_no_rows():
    from routes.interactions import get_interaction_pair
    from unittest.mock import MagicMock

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = []

    result = get_interaction_pair(mock_conn, "100", "200")
    assert result is None


def test_get_interaction_pair_ddinter_unknown_falls_back_to_kaggle_severity():
    """If DDInter row has unknown severity, use Kaggle row's severity."""
    from routes.interactions import get_interaction_pair
    from unittest.mock import MagicMock

    row_kaggle = ("100", "200", "DrugA", "DrugB", "Kaggle text", "moderate", "medium",
                  True, False, False, None)
    row_ddinter = ("200", "100", "DrugB", "DrugA", None, "unknown", None,
                   False, False, True, "Take care.")

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = [row_kaggle, row_ddinter]

    result = get_interaction_pair(mock_conn, "100", "200")
    assert result["severity"] == "moderate"
    assert result["management"] == "Take care."
    assert result["source_kaggle"] is True
    assert result["source_ddinter"] is True


# ---------------------------------------------------------------------------
# Tests for food dedup (Requirement 3)
# ---------------------------------------------------------------------------

def test_fetch_drug_food_interactions_deduplicates():
    """Multiple rows for the same (selected_drug, food_name_lower) must be
    collapsed into one, keeping the row with the highest severity."""
    from routes.interactions import _fetch_drug_food_interactions
    from unittest.mock import MagicMock

    # Five duplicate rows for Dolutegravir/food (level 1 = minor)
    dup_rows = [
        ("Dolutegravir", "food", "1", "Take with food.", None, None),
        ("Dolutegravir", "food", "1", "Take with food.", None, None),
        ("Dolutegravir", "food", "1", "Take with food.", None, None),
        ("Dolutegravir", "food", "1", "Take with food.", None, None),
        ("Dolutegravir", "food", "1", "Take with food.", None, None),
    ]

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = dup_rows

    resolved_map = {
        "dolutegravir": {
            "rxcui": "1234",
            "generic_name": "Dolutegravir",
            "brand_names": [],
        }
    }

    result = _fetch_drug_food_interactions(mock_conn, resolved_map)
    assert len(result) == 1
    assert result[0]["level"] == "minor"
    assert result[0]["food_name"] == "food"


def test_fetch_drug_food_interactions_keeps_highest_severity():
    """When duplicates have different severity, keep the highest."""
    from routes.interactions import _fetch_drug_food_interactions
    from unittest.mock import MagicMock

    rows = [
        ("Warfarin", "Grapefruit", "1", "Minor note.", None, None),       # minor
        ("Warfarin", "Grapefruit", "3", "Major warning.", None, None),     # major
        ("Warfarin", "grapefruit", "2", "Moderate warning.", None, None),  # moderate (same food, lowercase)
    ]

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchall.return_value = rows

    resolved_map = {
        "warfarin": {
            "rxcui": "11289",
            "generic_name": "Warfarin",
            "brand_names": [],
        }
    }

    result = _fetch_drug_food_interactions(mock_conn, resolved_map)
    assert len(result) == 1
    assert result[0]["level"] == "major"
    assert result[0]["interaction"] == "Major warning."


# ---------------------------------------------------------------------------
# Tests for disease cap and true totals (Requirement 4)
# ---------------------------------------------------------------------------

def test_batch_interactions_disease_cap_and_true_total(client, monkeypatch):
    """More than 100 disease rows → response capped at 100, summary reports true total
    and disease_truncated=True."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {
        "rxcui": "9999", "generic_name": "Dexamethasone", "brand_names": []
    })
    monkeypatch.setattr(interactions, "_pair_interaction_from_resolved", lambda *a, **kw:
        interactions.InteractionResponse(
            drug1=a[1], drug2=a[2],
            drug1_generic=None, drug2_generic=None, drug1_brands=[], drug2_brands=[],
            drug1_rxcui=None, drug2_rxcui=None,
            severity=None, description=None, spl_text=None, reference_text=None,
            management=None, confidence=None,
            source_kaggle=False, source_openfda=False, source_ddinter=False,
            found=False, message="No interaction data found",
        )
    )
    monkeypatch.setattr(interactions, "_fetch_drug_food_interactions", lambda conn, rm: [])

    # Build 150 unique disease rows
    disease_rows = [
        {
            "selected_drug": "dexamethasone",
            "matched_drug_name": "Dexamethasone",
            "disease_name": f"Disease {i:03d}",
            "level": "minor",
            "text": "Some text.",
            "ref_text": None,
            "source_ddinter": True,
        }
        for i in range(150)
    ]
    monkeypatch.setattr(interactions, "_fetch_drug_disease_interactions", lambda conn, rm: disease_rows)

    response = client.post("/api/interactions/check", json={"drugs": ["dexamethasone", "prednisone"]})
    assert response.status_code == 200
    payload = response.json()

    # True total in summary
    assert payload["summary"]["sections"]["drug_disease"] == 150
    # Cap applied in returned list
    assert len(payload["disease_interactions"]) == 100
    # Truncation flag
    assert payload["summary"]["sections"]["disease_truncated"] is True
    # Food not truncated
    assert payload["summary"]["sections"]["food_truncated"] is False


def test_batch_interactions_no_truncation_when_under_cap(client, monkeypatch):
    """Fewer than 100 results → truncation flags are False."""
    interactions, _ = _mock_conn_for_interactions(monkeypatch)

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {
        "rxcui": "9999", "generic_name": "Aspirin", "brand_names": []
    })
    monkeypatch.setattr(interactions, "_pair_interaction_from_resolved", lambda *a, **kw:
        interactions.InteractionResponse(
            drug1=a[1], drug2=a[2],
            drug1_generic=None, drug2_generic=None, drug1_brands=[], drug2_brands=[],
            drug1_rxcui=None, drug2_rxcui=None,
            severity=None, description=None, spl_text=None, reference_text=None,
            management=None, confidence=None,
            source_kaggle=False, source_openfda=False, source_ddinter=False,
            found=False, message="No interaction data found",
        )
    )
    monkeypatch.setattr(interactions, "_fetch_drug_food_interactions", lambda conn, rm: [
        {"selected_drug": "aspirin", "matched_drug_name": "Aspirin",
         "food_name": "Alcohol", "level": "moderate",
         "interaction": "Risk.", "management": None, "ref_text": None, "source_ddinter": True}
    ])
    monkeypatch.setattr(interactions, "_fetch_drug_disease_interactions", lambda conn, rm: [])

    response = client.post("/api/interactions/check", json={"drugs": ["aspirin", "warfarin"]})
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["sections"]["food_truncated"] is False
    assert payload["summary"]["sections"]["disease_truncated"] is False
    assert payload["summary"]["sections"]["drug_food"] == 1
