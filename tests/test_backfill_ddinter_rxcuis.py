"""Tests for scripts/backfill_ddinter_rxcuis.py — mocked DB, no network."""

import os
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_row(row_id: int, name1: str, name2: str) -> SimpleNamespace:
    return SimpleNamespace(id=row_id, drug_name_1=name1, drug_name_2=name2)


def _build_mock_engine(existing_pairs=None, target_rows=None):
    """Return a mock db_engine and its underlying connection mock."""
    if existing_pairs is None:
        existing_pairs = []
    if target_rows is None:
        target_rows = []

    mock_conn = MagicMock()
    mock_engine = MagicMock()

    # connect() context manager → mock_conn
    mock_cm_connect = MagicMock()
    mock_cm_connect.__enter__.return_value = mock_conn
    mock_cm_connect.__exit__.return_value = False
    mock_engine.connect.return_value = mock_cm_connect

    # begin() context manager (for batch writes)
    mock_cm_begin = MagicMock()
    mock_cm_begin.__enter__.return_value = mock_conn
    mock_cm_begin.__exit__.return_value = False
    mock_engine.begin.return_value = mock_cm_begin

    # conn.execute side_effect: first call returns target rows, rest return existing pairs
    pair_rows = [SimpleNamespace(**{"0": p[0], "1": p[1]}) for p in existing_pairs]
    # We use a list-based side_effect keyed by the SQL text pattern
    call_results = {
        "target": MagicMock(fetchall=lambda: target_rows),
        "existing": MagicMock(fetchall=lambda: pair_rows),
        "synonym_omeprazole": MagicMock(fetchone=lambda: SimpleNamespace(**{"0": "7646"})),
        "synonym_clopidogrel": MagicMock(fetchone=lambda: SimpleNamespace(**{"0": "32968"})),
        "synonym_none": MagicMock(fetchone=lambda: None),
    }
    return mock_engine, mock_conn, call_results


# ---------------------------------------------------------------------------
# Unit tests for the resolution and update logic
# ---------------------------------------------------------------------------


class TestResolveViaSynonyms:
    def test_generic_name_match(self):
        from scripts.backfill_ddinter_rxcuis import _resolve_via_synonyms

        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchone.return_value = ("7646",)
        result = _resolve_via_synonyms(mock_conn, "Omeprazole")
        assert result == "7646"

    def test_empty_name_returns_none(self):
        from scripts.backfill_ddinter_rxcuis import _resolve_via_synonyms

        mock_conn = MagicMock()
        result = _resolve_via_synonyms(mock_conn, "")
        assert result is None
        mock_conn.execute.assert_not_called()

    def test_no_match_returns_none(self):
        from scripts.backfill_ddinter_rxcuis import _resolve_via_synonyms

        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchone.return_value = None
        result = _resolve_via_synonyms(mock_conn, "UnknownDrug")
        assert result is None


class TestLoadExistingPairs:
    def test_returns_set_of_tuples(self):
        from scripts.backfill_ddinter_rxcuis import _load_existing_pairs

        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchall.return_value = [
            ("32968", "7646"),
            ("1234", "5678"),
        ]
        result = _load_existing_pairs(mock_conn)
        assert ("32968", "7646") in result
        assert ("1234", "5678") in result
        assert len(result) == 2


# ---------------------------------------------------------------------------
# Integration-style tests using main() with mocked database
# ---------------------------------------------------------------------------


def _run_main(monkeypatch, target_rows, existing_pairs, synonym_map, extra_args=None):
    """
    Run backfill_ddinter_rxcuis.main() with fully mocked DB.

    synonym_map: dict of lowercase name → rxcui (or None)
    Returns: list of (id, rxcui_1, rxcui_2) from UPDATE calls
    """
    import scripts.backfill_ddinter_rxcuis as mod

    # Build mock connection
    mock_conn = MagicMock()
    mock_engine = MagicMock()

    # connect() context manager
    mock_cm_connect = MagicMock()
    mock_cm_connect.__enter__.return_value = mock_conn
    mock_cm_connect.__exit__.return_value = False
    mock_engine.connect.return_value = mock_cm_connect

    # begin() context manager (for batch writes)
    written_rows = []

    def mock_begin():
        txn = MagicMock()
        txn_cm = MagicMock()
        txn_cm.__enter__.return_value = txn
        txn_cm.__exit__.return_value = False

        def capture_execute(stmt, params=None):
            if params and "rxcui_1" in params:
                written_rows.append((params["id"], params["rxcui_1"], params["rxcui_2"]))

        txn.execute.side_effect = capture_execute
        return txn_cm

    mock_engine.begin.side_effect = mock_begin

    # _fetch_target_rows → return our test rows
    monkeypatch.setattr(mod, "_fetch_target_rows", lambda conn, limit, offset: target_rows)

    # _load_existing_pairs → return our existing pairs
    existing_set = set(existing_pairs)
    monkeypatch.setattr(mod, "_load_existing_pairs", lambda conn: set(existing_set))

    # _resolve_via_synonyms → use synonym_map
    def fake_resolve_synonyms(conn, name):
        return synonym_map.get((name or "").strip().lower())

    monkeypatch.setattr(mod, "_resolve_via_synonyms", fake_resolve_synonyms)

    # Patch database module
    monkeypatch.setattr(mod.database, "db_engine", mock_engine)
    monkeypatch.setattr(mod.database, "connect_to_database", lambda: True)

    argv = ["--dry-run"] if extra_args is None else list(extra_args)
    # If not dry-run, empty list
    if extra_args is not None:
        argv = list(extra_args)
    else:
        argv = []

    mod.main(argv)
    return written_rows


class TestMainBothNamesResolveNameOrder:
    """Both names resolve, (a,b) slot free → written in name order."""

    def test_written_in_name_order(self, monkeypatch):
        target_rows = [_make_row(1, "Omeprazole", "Clopidogrel")]
        synonym_map = {"omeprazole": "7646", "clopidogrel": "32968"}

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=set(),
            synonym_map=synonym_map,
        )
        assert len(written) == 1
        row_id, r1, r2 = written[0]
        assert row_id == 1
        # name order: omeprazole=7646 → rxcui_1, clopidogrel=32968 → rxcui_2
        assert r1 == "7646"
        assert r2 == "32968"


class TestMainCollisionReversed:
    """(a,b) taken, (b,a) free → written reversed."""

    def test_reversed_when_forward_taken(self, monkeypatch):
        target_rows = [_make_row(2, "Omeprazole", "Clopidogrel")]
        synonym_map = {"omeprazole": "7646", "clopidogrel": "32968"}
        # Forward pair already exists
        existing_pairs = {("7646", "32968")}

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=existing_pairs,
            synonym_map=synonym_map,
        )
        assert len(written) == 1
        _, r1, r2 = written[0]
        assert r1 == "32968"
        assert r2 == "7646"


class TestMainBothOrdersTaken:
    """Both orders taken → skipped_collision, no write."""

    def test_skipped_when_both_orders_taken(self, monkeypatch):
        target_rows = [_make_row(3, "Omeprazole", "Clopidogrel")]
        synonym_map = {"omeprazole": "7646", "clopidogrel": "32968"}
        existing_pairs = {("7646", "32968"), ("32968", "7646")}

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=existing_pairs,
            synonym_map=synonym_map,
        )
        assert written == []


class TestMainOneNameUnresolved:
    """One name unresolved → skipped (no write)."""

    def test_skipped_when_one_unresolved(self, monkeypatch):
        target_rows = [_make_row(4, "Omeprazole", "UnknownDrug")]
        synonym_map = {"omeprazole": "7646"}  # UnknownDrug not present

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=set(),
            synonym_map=synonym_map,
        )
        assert written == []


class TestMainSelfPair:
    """a == b → skipped_self_pair, no write."""

    def test_skipped_self_pair(self, monkeypatch):
        target_rows = [_make_row(5, "Omeprazole", "Omeprazole")]
        synonym_map = {"omeprazole": "7646"}

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=set(),
            synonym_map=synonym_map,
        )
        assert written == []


class TestMainDryRun:
    """--dry-run resolves everything but executes no UPDATEs."""

    def test_no_updates_in_dry_run(self, monkeypatch):
        target_rows = [
            _make_row(6, "Omeprazole", "Clopidogrel"),
            _make_row(7, "Aspirin", "Ibuprofen"),
        ]
        synonym_map = {
            "omeprazole": "7646",
            "clopidogrel": "32968",
            "aspirin": "1191",
            "ibuprofen": "5640",
        }

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=set(),
            synonym_map=synonym_map,
            extra_args=["--dry-run"],
        )
        # Dry-run must write nothing
        assert written == []


class TestMainIntraRunDeduplication:
    """Two rows with the same resolved pair: first written, second skipped as collision."""

    def test_second_duplicate_skipped(self, monkeypatch):
        target_rows = [
            _make_row(10, "Omeprazole", "Clopidogrel"),
            _make_row(11, "Omeprazole", "Clopidogrel"),  # duplicate within same run
        ]
        synonym_map = {"omeprazole": "7646", "clopidogrel": "32968"}

        written = _run_main(
            monkeypatch,
            target_rows=target_rows,
            existing_pairs=set(),
            synonym_map=synonym_map,
        )
        # Only the first row should be written
        assert len(written) == 1
        assert written[0][0] == 10
