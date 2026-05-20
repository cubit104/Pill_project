import os

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from unittest.mock import MagicMock

from routes.details import _resolve_history_identifier


def _conn_stub():
    """Connection stub that returns 0 for any _history_count_for_ndc query."""
    conn = MagicMock()
    conn.execute.return_value.scalar.return_value = 0
    return conn


def test_returns_canonical_ndc_immediately_when_parseable(monkeypatch):
    # Clear the module-level cache to avoid bleed-through between tests.
    import routes.details as details
    details._history_resolution_cache.clear()

    result = _resolve_history_identifier(
        _conn_stub(),
        slug="wegovy-test-1",
        canonical_ndc="0169-4425-31",
        rxcui="12345",
        medicine_name="Wegovy",
    )
    assert result == {"history_ndc": "00169442531", "history_source": "ndc"}


def test_returns_null_when_canonical_unparseable():
    import routes.details as details
    details._history_resolution_cache.clear()

    result = _resolve_history_identifier(
        _conn_stub(),
        slug="truncated-ndc-test",
        canonical_ndc="0169-4425",  # No package segment
        rxcui="12345",
        medicine_name="SomeDrug",
    )
    assert result == {"history_ndc": None, "history_source": None}


def test_does_not_call_any_live_http(monkeypatch):
    """Regression: the resolver must not make live HTTP from this code path."""
    import routes.details as details
    details._history_resolution_cache.clear()

    # Make any accidental call to these blow up the test loudly.
    monkeypatch.setattr(
        details,
        "_history_count_for_ndc",
        lambda conn, ndc: 0,
    )

    result = _resolve_history_identifier(
        _conn_stub(),
        slug="no-http-test",
        canonical_ndc="00024-1171-90",
        rxcui="32968",
        medicine_name="Plavix",
    )
    assert result["history_ndc"] == "00024117190"
    assert result["history_source"] == "ndc"


def test_cache_hit_returns_cached_payload():
    import routes.details as details
    details._history_resolution_cache.clear()

    first = _resolve_history_identifier(
        _conn_stub(),
        slug="cached-slug",
        canonical_ndc="0002-1234-56",
        rxcui=None,
        medicine_name=None,
    )
    second = _resolve_history_identifier(
        _conn_stub(),
        slug="cached-slug",
        canonical_ndc="0002-1234-56",
        rxcui=None,
        medicine_name=None,
    )
    assert first == second
