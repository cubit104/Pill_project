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

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "high"
    assert payload["severity"] == "major"


def test_interaction_falls_back_to_live_openfda(client, monkeypatch):
    interactions, _ = _mock_conn_for_interactions(monkeypatch)
    calls = []

    monkeypatch.setattr(interactions, "resolve_drug_name", lambda conn, name: {"rxcui": "1191" if name == "aspirin" else "5640"})
    monkeypatch.setattr(interactions, "get_interaction_pair", lambda conn, r1, r2: None)
    monkeypatch.setattr(interactions, "search_cached_label_text", lambda conn, r, n: None)
    monkeypatch.setattr(interactions, "fetch_openfda_interaction_text", lambda r: ("Aspirin", "Do not use with ibuprofen"))
    monkeypatch.setattr(
        interactions,
        "cache_low_confidence_interaction",
        lambda conn, r1, r2, d1, d2, desc: calls.append((r1, r2, d1, d2, desc)),
    )

    response = client.get("/api/interactions", params={"drug1": "aspirin", "drug2": "ibuprofen"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["found"] is True
    assert payload["confidence"] == "low"
    assert payload["source_openfda"] is True
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
