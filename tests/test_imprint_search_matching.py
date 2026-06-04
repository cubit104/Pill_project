import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

from utils import normalize_imprint
import routes.search as search_routes
import routes.details as details_routes


def _make_engine_with_connection(conn: MagicMock) -> MagicMock:
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    return engine


def test_normalize_imprint_is_order_insensitive_and_sorted():
    assert normalize_imprint("75;1171") == "1171 75"
    assert normalize_imprint("1171 75") == "1171 75"


def test_suggestions_imprint_single_token_uses_word_boundary_regex():
    conn = MagicMock()
    conn.execute.return_value = [("75;1171",)]
    engine = _make_engine_with_connection(conn)

    with patch.object(search_routes.database, "db_engine", engine):
        result = search_routes.get_suggestions(q="1171", search_type="imprint")

    assert result == ["75;1171"]
    sql = str(conn.execute.call_args[0][0])
    params = conn.execute.call_args[0][1]
    assert "~ ('(^| )' || UPPER(:token) || '( |$)')" in sql
    assert params["token"] == "1171"


def test_suggestions_imprint_multi_token_uses_sorted_exact_match():
    conn = MagicMock()
    conn.execute.return_value = [("75;1171",), ("1171 75",)]
    engine = _make_engine_with_connection(conn)

    with patch.object(search_routes.database, "db_engine", engine):
        result = search_routes.get_suggestions(q="75 1171", search_type="imprint")

    assert result == ["75;1171"]
    sql = str(conn.execute.call_args[0][0])
    params = conn.execute.call_args[0][1]
    assert "string_agg(tok, ' ' ORDER BY tok)" in sql
    assert "= UPPER(:sorted_imp)" in sql
    assert params["sorted_imp"] == "1171 75"


def test_api_search_imprint_single_token_uses_boundary_regex_condition():
    conn = MagicMock()
    executed = []

    def execute_side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed.append((sql_str, params or {}))
        result = MagicMock()
        lowered = sql_str.lower()
        if "count(*)" in lowered:
            result.scalar.return_value = 0
        elif "limit :limit offset :offset" in lowered:
            result.fetchall.return_value = []
        else:
            result.scalar.return_value = 0
            result.fetchall.return_value = []
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    conn.execute.side_effect = execute_side_effect
    engine = _make_engine_with_connection(conn)

    with patch.object(search_routes.database, "db_engine", engine):
        payload = search_routes.api_search(
            q="1171", search_type="imprint", color=None, shape=None, page=1, per_page=25
        )

    assert payload["results"] == []
    count_sql, count_params = next(item for item in executed if "count(*)" in item[0].lower())
    assert "~ ('(^| )' || UPPER(:imprint_token) || '( |$)')" in count_sql
    assert count_params["imprint_token"] == "1171"


def test_api_search_imprint_multi_token_uses_sorted_exact_condition():
    conn = MagicMock()
    executed = []

    def execute_side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed.append((sql_str, params or {}))
        result = MagicMock()
        lowered = sql_str.lower()
        if "count(*)" in lowered:
            result.scalar.return_value = 0
        elif "limit :limit offset :offset" in lowered:
            result.fetchall.return_value = []
        else:
            result.scalar.return_value = 0
            result.fetchall.return_value = []
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    conn.execute.side_effect = execute_side_effect
    engine = _make_engine_with_connection(conn)

    with patch.object(search_routes.database, "db_engine", engine):
        payload = search_routes.api_search(
            q="75 1171", search_type="imprint", color=None, shape=None, page=1, per_page=25
        )

    assert payload["results"] == []
    count_sql, count_params = next(item for item in executed if "count(*)" in item[0].lower())
    assert "string_agg(tok, ' ' ORDER BY tok)" in count_sql
    assert "= UPPER(:sorted_imprint)" in count_sql
    assert count_params["sorted_imprint"] == "1171 75"


def test_api_search_imprint_order_by_uses_relevance_case_expression():
    """ORDER BY for imprint search should rank exact match first, then starts-with, then rest."""
    conn = MagicMock()
    executed = []

    def execute_side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed.append((sql_str, params or {}))
        result = MagicMock()
        lowered = sql_str.lower()
        if "count(*)" in lowered:
            result.scalar.return_value = 0
        elif "limit :limit offset :offset" in lowered:
            result.fetchall.return_value = []
        else:
            result.scalar.return_value = 0
            result.fetchall.return_value = []
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    conn.execute.side_effect = execute_side_effect
    engine = _make_engine_with_connection(conn)

    with patch.object(search_routes.database, "db_engine", engine):
        search_routes.api_search(
            q="10", search_type="imprint", color=None, shape=None, page=1, per_page=25
        )

    paginated_sql, paginated_params = next(
        item for item in executed if "limit :limit offset :offset" in item[0].lower()
    )
    assert "CASE" in paginated_sql
    assert ":imprint_rank_q" in paginated_sql
    assert ":imprint_rank_prefix" in paginated_sql
    assert paginated_params["imprint_rank_q"] == "10"
    assert paginated_params["imprint_rank_prefix"] == "10%"


def test_api_search_drug_order_by_uses_medicine_name():
    """ORDER BY for drug search should use medicine_name alphabetically (no CASE expression)."""
    conn = MagicMock()
    executed = []

    def execute_side_effect(sql, params=None, *args, **kwargs):
        sql_str = str(sql)
        executed.append((sql_str, params or {}))
        result = MagicMock()
        lowered = sql_str.lower()
        if "count(*)" in lowered:
            result.scalar.return_value = 0
        elif "limit :limit offset :offset" in lowered:
            result.fetchall.return_value = []
        else:
            result.scalar.return_value = 0
            result.fetchall.return_value = []
            result.__iter__ = MagicMock(return_value=iter([]))
        return result

    conn.execute.side_effect = execute_side_effect
    engine = _make_engine_with_connection(conn)

    with patch.object(search_routes.database, "db_engine", engine):
        search_routes.api_search(
            q="aspirin", search_type="drug", color=None, shape=None, page=1, per_page=25
        )

    paginated_calls = [item for item in executed if "limit :limit offset :offset" in item[0].lower()]
    assert paginated_calls, "Expected at least one paginated query for drug search"
    paginated_sql = paginated_calls[0][0]
    assert "medicine_name" in paginated_sql.lower()
    assert "imprint_rank_q" not in paginated_calls[0][1]


def test_details_imprint_lookup_uses_sorted_normalized_match():
    conn = MagicMock()
    query_result = MagicMock()
    query_result.fetchone.return_value = None
    conn.execute.return_value = query_result
    engine = _make_engine_with_connection(conn)

    with patch.object(details_routes.database, "db_engine", engine):
        with pytest.raises(HTTPException) as exc:
            details_routes.get_pill_details(
                imprint="75 1171", drug_name=None, rxcui=None, ndc=None
            )

    assert exc.value.status_code == 500
    sql = str(conn.execute.call_args[0][0])
    params = conn.execute.call_args[0][1]
    assert "string_agg(tok, ' ' ORDER BY tok)" in sql
    assert params["imprint"] == "1171 75"
