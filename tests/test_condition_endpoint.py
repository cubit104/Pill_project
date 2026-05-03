"""Tests for the GET /api/condition/{slug} endpoint.

Covers:
  1. Valid slug returns 200 + correct response shape
  2. Unknown slug returns 404 + 'available' array
  3. Alias slug returns redirect info (200 with redirect=True + canonical_slug)
  4. Empty drug list still returns 200 with intro paragraphs
  5. Slug normalization (uppercase input)
  6. /api/conditions list endpoint
  7. Drug deduplication — one row per medicine_name
  8. Drug with no slug still appears in result (links via medicine_name)
  9. Drug list ordering is alphabetical by medicine_name
  10. Response includes rxcui per drug
  11. SQL does not reference non-existent columns generic_name or brand_name (singular)
  12. SQL uses PARTITION BY LOWER(TRIM(p.medicine_name)) for medicine-name deduplication
  13. SQL includes LIMIT :limit OFFSET :offset for pagination
  14. Response includes total_count, limit, offset, has_more pagination fields
  15. Each drug in response includes image_url field
  16. Pagination query params are forwarded correctly
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
        # Return empty result set for drug queries; 0 for count query
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_result.scalar.return_value = 0
        mock_conn.execute.return_value = mock_result
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


def _make_drug_row(medicine_name, spl_strength, slug, image_filename, brand_names, rxcui):
    """Return a tuple matching the fixed SELECT column order:
    medicine_name, spl_strength, slug, image_filename, brand_names, rxcui
    """
    row = MagicMock()
    row.__getitem__ = lambda self, i: (
        medicine_name, spl_strength, slug, image_filename, brand_names, rxcui
    )[i]
    return row


@pytest.fixture(scope="module")
def client_with_drugs():
    """Test client whose DB returns a realistic multi-drug result set.

    Simulates the deduplicated output of the window-function query (PARTITION BY
    LOWER(TRIM(p.medicine_name))):
      - Aspirin (rxcui=111, has slug and image)
      - Carvedilol (rxcui=222, no slug, no image)
      - Metoprolol (rxcui=333, has slug)
    Returned pre-sorted alphabetically (as the real query ORDER BY medicine_name does).
    The count query returns 3 (distinct medicine names).
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
            _make_drug_row("Aspirin", "81 mg", "aspirin-81mg", "aspirin.jpg", "Bayer", "111"),
            _make_drug_row("Carvedilol", "6.25 mg", None, None, "Coreg", "222"),
            _make_drug_row("Metoprolol", "50 mg", "metoprolol-50mg", None, "Toprol", "333"),
        ]

        count_result = MagicMock()
        count_result.scalar.return_value = 3
        drug_result = MagicMock()
        drug_result.fetchall.return_value = rows

        def _execute_side_effect(sql, params=None):
            """Return count_result for COUNT queries, drug_result for main query."""
            sql_upper = str(sql).upper()
            if "COUNT(DISTINCT" in sql_upper:
                return count_result
            return drug_result

        mock_conn.execute.side_effect = _execute_side_effect
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

    def test_alias_url_preserves_pagination_when_non_default_offset(self, client):
        """Alias redirect url must include pagination params when offset > 0."""
        data = client.get("/api/condition/hypertension?limit=20&offset=40").json()
        assert data.get("redirect") is True
        assert "offset=40" in data["url"]

    def test_alias_url_omits_pagination_at_default_offset(self, client):
        """Alias redirect url must NOT include query params when offset=0 and limit=20."""
        data = client.get("/api/condition/hypertension").json()
        assert data.get("redirect") is True
        assert "?" not in data["url"]


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
    """Drug query deduplication, slug-fallback, ordering, rxcui, image_url, and pagination."""

    def test_drug_list_returns_expected_count(self, client_with_drugs):
        """Three distinct medicine_names → three drugs in response."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        assert data["drug_count"] == 3
        assert len(data["drugs"]) == 3

    def test_drug_with_no_slug_still_included(self, client_with_drugs):
        """Carvedilol has no slug — it must still appear in the drug list."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        names = [d["medicine_name"] for d in data["drugs"]]
        assert "Carvedilol" in names

    def test_drug_with_no_slug_has_medicine_name(self, client_with_drugs):
        """The slug-less drug has medicine_name populated (used as frontend fallback link)."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        carvedilol = next((d for d in data["drugs"] if d["medicine_name"] == "Carvedilol"), None)
        assert carvedilol is not None, "Carvedilol not found in drug list"
        assert carvedilol["medicine_name"] == "Carvedilol"
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
        """Mock data has one row per medicine_name with distinct rxcuis — no duplicates."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        rxcuis = [d["rxcui"] for d in data["drugs"]]
        assert len(rxcuis) == len(set(rxcuis))

    def test_drug_with_slug_has_slug_populated(self, client_with_drugs):
        """Aspirin has a slug — it must be present in the response."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        aspirin = next((d for d in data["drugs"] if d["medicine_name"] == "Aspirin"), None)
        assert aspirin is not None, "Aspirin not found in drug list"
        assert aspirin["slug"] == "aspirin-81mg"

    def test_each_drug_has_image_url_field(self, client_with_drugs):
        """Every drug in the response includes the image_url field (string or null)."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        for drug in data["drugs"]:
            assert "image_url" in drug

    def test_drug_with_image_filename_has_image_url(self, client_with_drugs):
        """Aspirin has an image_filename — its image_url must be a non-empty string."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        aspirin = next((d for d in data["drugs"] if d["medicine_name"] == "Aspirin"), None)
        assert aspirin is not None
        assert aspirin["image_url"] is not None
        assert "aspirin.jpg" in aspirin["image_url"]

    def test_drug_without_image_filename_has_null_image_url(self, client_with_drugs):
        """Carvedilol has no image_filename — its image_url must be null."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        carvedilol = next((d for d in data["drugs"] if d["medicine_name"] == "Carvedilol"), None)
        assert carvedilol is not None
        assert carvedilol["image_url"] is None

    def test_response_includes_total_count(self, client_with_drugs):
        """Response must include total_count from the COUNT query."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        assert "total_count" in data
        assert data["total_count"] == 3

    def test_response_includes_limit(self, client_with_drugs):
        """Response must include the limit used."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        assert "limit" in data
        assert data["limit"] == 20  # default

    def test_response_includes_offset(self, client_with_drugs):
        """Response must include the offset used."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        assert "offset" in data
        assert data["offset"] == 0  # default

    def test_response_includes_has_more(self, client_with_drugs):
        """Response must include has_more (False when drug_count < limit)."""
        data = client_with_drugs.get("/api/condition/heart-failure").json()
        assert "has_more" in data
        assert data["has_more"] is False  # 3 drugs, total_count=3, not more

    def test_custom_limit_is_respected(self, client_with_drugs):
        """?limit=5 should appear in the response's limit field."""
        data = client_with_drugs.get("/api/condition/heart-failure?limit=5").json()
        assert data["limit"] == 5

    def test_custom_offset_is_respected(self, client_with_drugs):
        """?offset=10 should appear in the response's offset field."""
        data = client_with_drugs.get("/api/condition/heart-failure?offset=10").json()
        assert data["offset"] == 10


class TestConditionDrugQueryShape:
    """Verify that the drug-fetch SQL sent to the DB has the correct critical properties.

    These tests capture the actual SQL text passed to conn.execute() and assert the
    key behaviors introduced in this PR — normalized JOIN, no slug filter,
    deduplication via PARTITION BY LOWER(TRIM(p.medicine_name)), and pagination via
    LIMIT :limit OFFSET :offset. They would catch regressions that reintroduce
    the old broken query even if the mocked response fixture still returns rows.
    """

    def _get_executed_sql(self, client) -> str:
        """Make one condition request and return the drug query SQL text that was executed.

        After pagination was added, conn.execute is called twice per request:
          1. The COUNT query (scalar())
          2. The main drug query (fetchall())
        We return the drug query SQL (the last call = call_args).
        """
        import database as db_module
        from unittest.mock import MagicMock

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        count_result = MagicMock()
        count_result.scalar.return_value = 0
        drug_result = MagicMock()
        drug_result.fetchall.return_value = []

        def _execute_side_effect(sql, params=None):
            sql_upper = str(sql).upper()
            if "COUNT(DISTINCT" in sql_upper:
                return count_result
            return drug_result

        mock_conn.execute.side_effect = _execute_side_effect
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        client.get("/api/condition/diabetes")

        # Retrieve the SQL text of the last execute call (the drug query).
        call_args = mock_conn.execute.call_args
        sql_arg = call_args[0][0]  # first positional arg = sqlalchemy text()
        return str(sql_arg)

    def _get_count_sql(self, client) -> str:
        """Make one condition request and return the COUNT query SQL text."""
        import database as db_module
        from unittest.mock import MagicMock

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        count_result = MagicMock()
        count_result.scalar.return_value = 0
        drug_result = MagicMock()
        drug_result.fetchall.return_value = []

        def _execute_side_effect(sql, params=None):
            sql_upper = str(sql).upper()
            if "COUNT(DISTINCT" in sql_upper:
                return count_result
            return drug_result

        mock_conn.execute.side_effect = _execute_side_effect
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        client.get("/api/condition/diabetes")

        # Retrieve the SQL text of the first execute call (the count query).
        first_call_args = mock_conn.execute.call_args_list[0]
        sql_arg = first_call_args[0][0]
        return str(sql_arg)

    def test_sql_uses_trim_cast_join(self, client):
        """JOIN must normalize rxcui via TRIM and cast to text on both sides."""
        sql = self._get_executed_sql(client)
        assert "TRIM" in sql.upper()
        assert "::text" in sql.lower() or "::TEXT" in sql

    def test_sql_has_partition_by_medicine_name(self, client):
        """Window function must partition by LOWER(TRIM(p.medicine_name)) for per-drug dedup."""
        sql = self._get_executed_sql(client)
        assert "PARTITION BY" in sql.upper()
        assert "lower(trim(p.medicine_name))" in sql.lower()

    def test_sql_has_row_number(self, client):
        """ROW_NUMBER window function must be present."""
        sql = self._get_executed_sql(client)
        assert "ROW_NUMBER" in sql.upper()

    def test_sql_has_limit_and_offset(self, client):
        """Drug query must include LIMIT :limit OFFSET :offset for pagination."""
        sql = self._get_executed_sql(client)
        sql_lower = sql.lower()
        assert "limit :limit" in sql_lower
        assert "offset :offset" in sql_lower

    def test_sql_does_not_filter_out_slugless_rows(self, client):
        """The old WHERE-clause slug filter must NOT appear in the query.

        The phrase 'slug is not null' still legitimately appears inside the
        ROW_NUMBER ORDER BY expression (to prefer rows with a slug), so we
        check that there is no WHERE-level slug filter by asserting the slug
        condition only appears within a parenthesised boolean expression, not
        as a bare AND condition at the WHERE level.
        """
        sql = self._get_executed_sql(client)
        normalised = " ".join(sql.lower().split())
        # Old broken filter was: "and p.slug is not null and p.slug != ''"
        # at the WHERE level (bare, not inside parentheses).
        assert "and p.slug is not null and p.slug !=" not in normalised

    def test_sql_selects_rxcui(self, client):
        """rxcui must be in the SELECT so it appears in the API response."""
        sql = self._get_executed_sql(client)
        assert "rxcui" in sql.lower()

    def test_sql_does_not_reference_generic_name(self, client):
        """generic_name does not exist in pillfinder — query must not reference it."""
        sql = self._get_executed_sql(client)
        assert "generic_name" not in sql.lower()

    def test_sql_does_not_reference_brand_name_singular(self, client):
        """brand_name (singular) does not exist in pillfinder — query must use brand_names."""
        sql = self._get_executed_sql(client)
        # brand_names (plural) is fine; brand_name without trailing 's' is the bug
        # Strip 'brand_names' occurrences first then check for bare 'brand_name'
        sql_without_plural = sql.lower().replace("brand_names", "")
        assert "brand_name" not in sql_without_plural

    def test_count_sql_uses_distinct_medicine_name(self, client):
        """COUNT query must use COUNT(DISTINCT LOWER(TRIM(p.medicine_name)))."""
        sql = self._get_count_sql(client)
        sql_upper = sql.upper()
        assert "COUNT(DISTINCT" in sql_upper
        assert "lower(trim(p.medicine_name))" in sql.lower()
