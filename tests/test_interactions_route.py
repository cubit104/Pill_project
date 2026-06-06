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
        },
    )
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: (None, None))
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r, g: ("", ""))
    monkeypatch.setattr(interactions, "cache_low_confidence_interaction", lambda *args, **kwargs: None)

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert payload["severity"] == "major"
    assert payload["description"] is None
    assert payload["drug1_generic"] is None
    assert payload["drug2_generic"] is None
    assert payload["drug1_brands"] == []
    assert payload["drug2_brands"] == []


def test_interaction_falls_back_to_live_openfda(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    calls = []

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
        "cache_low_confidence_interaction",
        lambda conn, r1, r2, d1, d2, desc: calls.append((r1, r2, d1, d2, desc)),
    )

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert payload["description"] == "Do not use with ibuprofen"
    assert payload["source_openfda"] is True
    assert calls, "expected low-confidence cache helper to be called"


def test_interaction_fallback_checks_other_label_with_synonyms(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    calls = []

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
        "cache_low_confidence_interaction",
        lambda conn, r1, r2, d1, d2, desc: calls.append((r1, r2, d1, d2, desc)),
    )

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "advil"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert "Bayer" in payload["description"]
    assert calls, "expected low-confidence cache helper to be called"


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


def test_suggestions_sql_includes_brand_names_and_generic(client, monkeypatch):
    """The suggestions SQL must query drug_synonyms brand_names and generic_name
    in addition to drug_interactions drug_name_1/2."""
    _, mock_conn = _mock_conn_for_interactions(monkeypatch)
    mock_conn.execute.return_value.fetchall.return_value = [("Lipitor",)]

    response = client.get("/api/interactions/suggestions", params={"q": "li", "limit": 5})
    assert response.status_code == 200
    assert response.json() == ["Lipitor"]

    # Inspect the SQL that was executed
    executed_sql = str(mock_conn.execute.call_args[0][0])
    assert "drug_synonyms" in executed_sql
    assert "unnest(brand_names)" in executed_sql
    assert "generic_name" in executed_sql


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
