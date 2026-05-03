"""Tests for the GET /api/condition/{slug} endpoint.

Covers:
  1. Valid slug returns 200 + correct response shape
  2. Unknown slug returns 404 + 'available' array
  3. Alias slug returns redirect info (200 with redirect=True + canonical_slug)
  4. Empty drug list still returns 200 with intro paragraphs
  5. Slug normalization (uppercase input)
  6. /api/conditions list endpoint
  7. Drug deduplication — one row per rxcui
  8. Drug with no slug but has generic_name still appears in result
  9. Drug list ordering is alphabetical by medicine_name
  10. Response includes rxcui per drug
"""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


@pytest.fixture(scope="module")
def client():
    """Test client with mocked DB that returns an empty drug list."""
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        # Return empty result set for drug queries
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_conn.execute.return_value = mock_result
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


def _make_drug_row(medicine_name, spl_strength, slug, image_filename, generic_name, brand_name, rxcui):
    """Return a tuple matching the new SELECT column order:
    medicine_name, spl_strength, slug, image_filename, generic_name, brand_name, rxcui
    """
    row = MagicMock()
    row.__getitem__ = lambda self, i: (
        medicine_name, spl_strength, slug, image_filename, generic_name, brand_name, rxcui
    )[i]
    return row


@pytest.fixture(scope="module")
def client_with_drugs():
    """Test client whose DB returns a realistic multi-drug result set.

    Simulates the deduplicated output of the new window-function query:
      - Aspirin (rxcui=111, has slug)
      - Carvedilol (rxcui=222, no slug but has generic_name)
      - Metoprolol (rxcui=333, has slug)
    Returned pre-sorted alphabetically (as the real query ORDER BY medicine_name does).
    """
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        rows = [
            _make_drug_row("Aspirin", "81 mg", "aspirin-81mg", "aspirin.jpg", "aspirin", "Bayer", "111"),
            _make_drug_row("Carvedilol", "6.25 mg", None, None, "carvedilol", "Coreg", "222"),
            _make_drug_row("Metoprolol", "50 mg", "metoprolol-50mg", None, "metoprolol succinate", "Toprol", "333"),
        ]
        mock_result = MagicMock()
        mock_result.fetchall.return_value = rows
        mock_conn.execute.return_value = mock_result
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


class TestConditionEndpointValidSlug:
    """Valid slug → 200 with correct response shape."""

    def test_valid_slug_returns_200(self, client):
        response = client.get("/api/condition/diabetes")
        assert response.status_code == 200

    def test_valid_slug_has_tag_field(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert data["tag"] == "diabetes"

    def test_valid_slug_has_title(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert data["title"] == "Medications for Diabetes"

    def test_valid_slug_has_two_paragraphs(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert "paragraphs" in data
        assert len(data["paragraphs"]) == 2
        for p in data["paragraphs"]:
            assert isinstance(p, str) and len(p) > 50

    def test_valid_slug_has_drugs_list(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert "drugs" in data
        assert isinstance(data["drugs"], list)

    def test_valid_slug_has_drug_count(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert "drug_count" in data
        assert data["drug_count"] == len(data["drugs"])

    def test_valid_slug_has_related(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert "related" in data
        assert isinstance(data["related"], list)

    def test_valid_slug_has_last_reviewed(self, client):
        data = client.get("/api/condition/diabetes").json()
        assert data["last_reviewed"] == "2026-05-03"

    def test_valid_slug_has_cache_header(self, client):
        response = client.get("/api/condition/diabetes")
        assert "cache-control" in response.headers
        assert "max-age" in response.headers["cache-control"]

    def test_apostrophe_slug_parkinsons(self, client):
        """parkinson's disease → slug parkinsons-disease (apostrophe stripped)."""
        response = client.get("/api/condition/parkinsons-disease")
        assert response.status_code == 200
        data = response.json()
        assert "parkinson" in data["title"].lower()

    def test_apostrophe_slug_alzheimers(self, client):
        """alzheimer's disease → slug alzheimers-disease."""
        response = client.get("/api/condition/alzheimers-disease")
        assert response.status_code == 200
        data = response.json()
        assert "alzheimer" in data["title"].lower()


class TestConditionEndpointUnknownSlug:
    """Unknown slug → 404 + available array."""

    def test_unknown_slug_returns_404(self, client):
        response = client.get("/api/condition/unknown-disease-xyz")
        assert response.status_code == 404

    def test_unknown_slug_has_error_field(self, client):
        data = client.get("/api/condition/unknown-disease-xyz").json()
        detail = data.get("detail", data)
        assert "error" in detail or "condition_not_found" in str(detail)

    def test_unknown_slug_has_available_list(self, client):
        data = client.get("/api/condition/unknown-disease-xyz").json()
        detail = data.get("detail", data)
        assert "available" in detail
        assert isinstance(detail["available"], list)
        assert len(detail["available"]) == 32

    def test_available_list_contains_known_slugs(self, client):
        data = client.get("/api/condition/not-a-real-condition").json()
        detail = data.get("detail", data)
        available = detail["available"]
        assert "diabetes" in available
        assert "anxiety" in available
        assert "heart-attack" in available


class TestConditionEndpointAlias:
    """Alias slug → redirect response."""

    def test_alias_hypertension_returns_200(self, client):
        response = client.get("/api/condition/hypertension")
        assert response.status_code == 200

    def test_alias_hypertension_has_redirect_flag(self, client):
        data = client.get("/api/condition/hypertension").json()
        assert data.get("redirect") is True

    def test_alias_hypertension_canonical_slug(self, client):
        data = client.get("/api/condition/hypertension").json()
        assert data["canonical_slug"] == "high-blood-pressure"

    def test_alias_gerd_redirects_to_acid_reflux(self, client):
        data = client.get("/api/condition/gerd").json()
        assert data.get("redirect") is True
        assert data["canonical_slug"] == "acid-reflux"

    def test_alias_afib_redirects_to_atrial_fibrillation(self, client):
        data = client.get("/api/condition/afib").json()
        assert data.get("redirect") is True
        assert data["canonical_slug"] == "atrial-fibrillation"

    def test_alias_epilepsy_redirects_to_seizures(self, client):
        data = client.get("/api/condition/epilepsy").json()
        assert data.get("redirect") is True
        assert data["canonical_slug"] == "seizures"


class TestConditionEndpointEmptyDrugs:
    """Empty drug list → 200 with intro paragraphs still present."""

    def test_empty_drugs_returns_200(self, client):
        # Mock returns empty drug list — all valid conditions should still 200.
        response = client.get("/api/condition/osteoporosis")
        assert response.status_code == 200

    def test_empty_drugs_has_paragraphs(self, client):
        data = client.get("/api/condition/osteoporosis").json()
        assert len(data["paragraphs"]) == 2

    def test_empty_drugs_count_is_zero(self, client):
        data = client.get("/api/condition/osteoporosis").json()
        assert data["drug_count"] == 0
        assert data["drugs"] == []


class TestConditionEndpointSlugNormalization:
    """Input slug is normalized (lowercased, trimmed)."""

    def test_uppercase_slug_normalized(self, client):
        """Backend normalizes slug to lowercase."""
        # Note: the test client URL goes through the route as-is.
        # Lowercase is applied inside the handler.
        response = client.get("/api/condition/DIABETES")
        # The slug DIABETES is lowercased to 'diabetes' inside the handler.
        assert response.status_code == 200


class TestConditionsListEndpoint:
    """GET /api/conditions — list all 32 conditions."""

    def test_returns_200(self, client):
        response = client.get("/api/conditions")
        assert response.status_code == 200

    def test_returns_32_conditions(self, client):
        data = client.get("/api/conditions").json()
        assert len(data["conditions"]) == 32

    def test_each_condition_has_slug_and_title(self, client):
        data = client.get("/api/conditions").json()
        for cond in data["conditions"]:
            assert "slug" in cond
            assert "title" in cond
            assert "tag" in cond

    def test_diabetes_in_list(self, client):
        data = client.get("/api/conditions").json()
        slugs = [c["slug"] for c in data["conditions"]]
        assert "diabetes" in slugs


class TestConditionDrugDeduplication:
    """Drug query deduplication, slug-fallback, ordering, and rxcui in response."""

    def test_drug_list_returns_expected_count(self, client_with_drugs):
        """Three distinct rxcuis → three drugs in response."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        assert data["drug_count"] == 3
        assert len(data["drugs"]) == 3

    def test_drug_with_no_slug_still_included(self, client_with_drugs):
        """Carvedilol has no slug but a generic_name — it must still appear."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        names = [d["medicine_name"] for d in data["drugs"]]
        assert "Carvedilol" in names

    def test_drug_with_no_slug_has_generic_name(self, client_with_drugs):
        """The slug-less drug has generic_name populated for frontend fallback."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        carvedilol = next((d for d in data["drugs"] if d["medicine_name"] == "Carvedilol"), None)
        assert carvedilol is not None, "Carvedilol not found in drug list"
        assert carvedilol["generic_name"] == "carvedilol"
        assert not carvedilol["slug"]

    def test_drug_list_ordered_alphabetically(self, client_with_drugs):
        """Drugs are returned sorted alphabetically by medicine_name."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        names = [d["medicine_name"] for d in data["drugs"]]
        assert names == sorted(names)

    def test_each_drug_has_rxcui_field(self, client_with_drugs):
        """Every drug in the response includes the rxcui field."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        for drug in data["drugs"]:
            assert "rxcui" in drug

    def test_drug_rxcui_values_are_distinct(self, client_with_drugs):
        """One row per rxcui — no duplicates."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        rxcuis = [d["rxcui"] for d in data["drugs"]]
        assert len(rxcuis) == len(set(rxcuis))

    def test_drug_with_slug_has_slug_populated(self, client_with_drugs):
        """Aspirin has a slug — it must be present in the response."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        aspirin = next((d for d in data["drugs"] if d["medicine_name"] == "Aspirin"), None)
        assert aspirin is not None, "Aspirin not found in drug list"
        assert aspirin["slug"] == "aspirin-81mg"
