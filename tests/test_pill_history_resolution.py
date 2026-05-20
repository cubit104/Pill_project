import os
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

import routes.details as details


def test_resolve_history_identifier_prefers_matched_ndc_after_empty_canonical(monkeypatch):
    conn = MagicMock()

    monkeypatch.setattr(details, "_get_cached_history_resolution", lambda slug: None)
    monkeypatch.setattr(details, "_set_cached_history_resolution", lambda slug, payload: None)
    monkeypatch.setattr(details, "_resolve_matched_ndc_candidate", lambda canonical_ndc: "00378018101")
    monkeypatch.setattr(details, "_resolve_rxcui_history_candidates", lambda rxcui: ["00002140102"])
    monkeypatch.setattr(details, "_resolve_name_history_candidates", lambda name: ["55111019690"])

    def fake_first_ndc_with_history(_conn, candidates, probe_live=False):
        if candidates == ["21695066530"]:
            return None
        if candidates == ["00378018101"]:
            return "00378018101"
        return None

    monkeypatch.setattr(details, "_first_ndc_with_history", fake_first_ndc_with_history)

    resolved = details._resolve_history_identifier(
        conn,
        slug="plavix-75-1171",
        canonical_ndc="21695066530",
        rxcui="213169",
        medicine_name="Plavix",
    )

    assert resolved == {"history_ndc": "00378018101", "history_source": "matched_ndc"}


def test_resolve_history_identifier_returns_cached_value(monkeypatch):
    conn = MagicMock()

    monkeypatch.setattr(
        details,
        "_get_cached_history_resolution",
        lambda slug: {"history_ndc": "55111019690", "history_source": "by_name"},
    )
    monkeypatch.setattr(details, "_first_ndc_with_history", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("should not query")))

    resolved = details._resolve_history_identifier(
        conn,
        slug="clopidogrel-75-5511",
        canonical_ndc="55111019690",
        rxcui="32968",
        medicine_name="Clopidogrel",
    )

    assert resolved == {"history_ndc": "55111019690", "history_source": "by_name"}


def test_resolve_history_identifier_probes_live_history_for_matched_ndc_when_cache_is_empty(monkeypatch):
    conn = MagicMock()

    monkeypatch.setattr(details, "_get_cached_history_resolution", lambda slug: None)
    monkeypatch.setattr(details, "_set_cached_history_resolution", lambda slug, payload: None)
    monkeypatch.setattr(details, "_resolve_matched_ndc_candidate", lambda canonical_ndc: "61442017230")
    monkeypatch.setattr(details, "_resolve_rxcui_history_candidates", lambda rxcui: [])
    monkeypatch.setattr(details, "_resolve_name_history_candidates", lambda name: [])
    monkeypatch.setattr(details, "_history_count_for_ndc", lambda _conn, _ndc: 0)

    mock_history = AsyncMock(return_value=[{"ndc": "61442017230", "effective_date": "2026-05-08"}])
    monkeypatch.setattr(details.pricing_service, "get_price_history", mock_history)

    resolved = details._resolve_history_identifier(
        conn,
        slug="cefaclor-cefaclor-500-mg-1",
        canonical_ndc="21695066530",
        rxcui="12345",
        medicine_name="Cefaclor",
    )

    assert resolved == {"history_ndc": "61442017230", "history_source": "matched_ndc"}
    mock_history.assert_awaited_once_with("61442017230", weeks=1)


def test_resolve_history_identifier_returns_equivalent_matched_ndc_even_when_probe_finds_no_history(monkeypatch):
    conn = MagicMock()

    monkeypatch.setattr(details, "_get_cached_history_resolution", lambda slug: None)
    monkeypatch.setattr(details, "_set_cached_history_resolution", lambda slug, payload: None)
    monkeypatch.setattr(details, "_resolve_matched_ndc_candidate", lambda canonical_ndc: "61442017230")
    monkeypatch.setattr(details, "_resolve_rxcui_history_candidates", lambda rxcui: [])
    monkeypatch.setattr(details, "_resolve_name_history_candidates", lambda name: [])
    monkeypatch.setattr(details, "_history_count_for_ndc", lambda _conn, _ndc: 0)

    mock_history = AsyncMock(return_value=[])
    monkeypatch.setattr(details.pricing_service, "get_price_history", mock_history)

    resolved = details._resolve_history_identifier(
        conn,
        slug="cefaclor-cefaclor-500-mg-1",
        canonical_ndc="21695066530",
        rxcui="12345",
        medicine_name="Cefaclor",
    )

    assert resolved == {"history_ndc": "61442017230", "history_source": "matched_ndc"}
    mock_history.assert_awaited_once_with("61442017230", weeks=1)


def test_resolve_history_identifier_caches_negative_results_with_shorter_ttl(monkeypatch):
    conn = MagicMock()
    slug = "missing-history"

    details._history_resolution_cache.clear()
    monkeypatch.setattr(details, "_HISTORY_RESOLUTION_TTL_SECONDS", 3600)
    monkeypatch.setattr(details, "_HISTORY_RESOLUTION_NEGATIVE_TTL_SECONDS", 300)
    monkeypatch.setattr(details, "time", MagicMock(time=lambda: 1000.0))
    monkeypatch.setattr(details, "_resolve_matched_ndc_candidate", lambda canonical_ndc: None)
    monkeypatch.setattr(details, "_resolve_rxcui_history_candidates", lambda rxcui: ["00002140102"])
    monkeypatch.setattr(details, "_resolve_name_history_candidates", lambda name: [])
    monkeypatch.setattr(details, "_history_count_for_ndc", lambda _conn, _ndc: 0)
    monkeypatch.setattr(details.pricing_service, "get_price_history", AsyncMock(return_value=[]))

    resolved = details._resolve_history_identifier(
        conn,
        slug=slug,
        canonical_ndc=None,
        rxcui="12345",
        medicine_name=None,
    )

    assert resolved == {"history_ndc": None, "history_source": None}
    expires_at, payload = details._history_resolution_cache[slug]
    assert payload == {"history_ndc": None, "history_source": None}
    assert expires_at == 1300.0
    assert expires_at != 4600.0
    details._history_resolution_cache.clear()
