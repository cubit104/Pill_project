import os
from unittest.mock import MagicMock

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

import routes.details as details


def test_resolve_history_identifier_returns_cached_value(monkeypatch):
    conn = MagicMock()

    monkeypatch.setattr(
        details,
        "_get_cached_history_resolution",
        lambda slug: {"history_ndc": "55111019690", "history_source": "by_name"},
    )

    resolved = details._resolve_history_identifier(
        conn,
        slug="clopidogrel-75-5511",
        canonical_ndc="55111019690",
        rxcui="32968",
        medicine_name="Clopidogrel",
    )

    assert resolved == {"history_ndc": "55111019690", "history_source": "by_name"}
