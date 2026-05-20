import os
from unittest.mock import MagicMock

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

import routes.details as details


def test_resolve_history_identifier_prefers_matched_ndc_after_empty_canonical(monkeypatch):
    conn = MagicMock()

    monkeypatch.setattr(details, "_get_cached_history_resolution", lambda slug: None)
    monkeypatch.setattr(details, "_set_cached_history_resolution", lambda slug, payload: None)
    monkeypatch.setattr(details, "_resolve_matched_ndc_candidate", lambda canonical_ndc: "00378018101")
    monkeypatch.setattr(details, "_resolve_rxcui_history_candidates", lambda rxcui: ["00002140102"])
    monkeypatch.setattr(details, "_resolve_name_history_candidates", lambda name: ["55111019690"])

    def fake_first_ndc_with_history(_conn, candidates):
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
