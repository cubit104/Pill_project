"""Unit tests for scripts/backfill_ddinter_rxcuis.py.

Tests cover the pure logic in process_rows() and the collision-detection
helper _choose_order(), using mocked DB connections — no live database
required.  Mocking style follows tests/test_backfill_medication_guide_identifiers.py.
"""

import os
import sys

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

# Ensure the scripts directory is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from backfill_ddinter_rxcuis import _choose_order, process_rows  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rowcount=0):
        self.rowcount = rowcount


class _FakeConn:
    """Minimal fake connection that records UPDATE calls."""

    def __init__(self):
        self.updates: list[dict] = []

    def execute(self, statement, params=None):
        sql = str(statement)
        if "UPDATE drug_interactions" in sql and "SET rxcui_1" in sql:
            self.updates.append(dict(params or {}))
        return _FakeResult(rowcount=1)


def _make_row(row_id: int, name1: str, name2: str):
    """Return a tuple mimicking a SQLAlchemy Row (id, drug_name_1, drug_name_2)."""
    return (row_id, name1, name2)


# ---------------------------------------------------------------------------
# _choose_order tests
# ---------------------------------------------------------------------------


def test_choose_order_prefers_name_order():
    occupied: set = set()
    result = _choose_order("100", "200", occupied)
    assert result == ("100", "200")


def test_choose_order_falls_back_to_reversed():
    occupied = {("100", "200")}
    result = _choose_order("100", "200", occupied)
    assert result == ("200", "100")


def test_choose_order_returns_none_when_both_taken():
    occupied = {("100", "200"), ("200", "100")}
    result = _choose_order("100", "200", occupied)
    assert result is None


# ---------------------------------------------------------------------------
# process_rows tests
# ---------------------------------------------------------------------------


def test_both_names_resolve_row_updated_in_name_order():
    """Both names resolve, (a, b) is free → row updated in name order."""
    rows = [_make_row(1, "Omeprazole", "Clopidogrel")]
    cache = {"omeprazole": "7646", "clopidogrel": "32968"}
    occupied: set = set()
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 1
    assert stats["skipped_unresolved"] == 0
    assert len(conn.updates) == 1
    update = conn.updates[0]
    assert update["r1"] == "7646"   # Omeprazole order
    assert update["r2"] == "32968"  # Clopidogrel order
    assert ("7646", "32968") in occupied


def test_ab_taken_ba_free_written_reversed():
    """(a, b) occupied, (b, a) free → written in reversed order."""
    rows = [_make_row(2, "Omeprazole", "Clopidogrel")]
    cache = {"omeprazole": "7646", "clopidogrel": "32968"}
    occupied = {("7646", "32968")}
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 1
    assert len(conn.updates) == 1
    update = conn.updates[0]
    assert update["r1"] == "32968"
    assert update["r2"] == "7646"
    assert ("32968", "7646") in occupied


def test_both_orders_taken_skipped_collision():
    """Both (a, b) and (b, a) occupied → skipped_collision, no update."""
    rows = [_make_row(3, "Omeprazole", "Clopidogrel")]
    cache = {"omeprazole": "7646", "clopidogrel": "32968"}
    occupied = {("7646", "32968"), ("32968", "7646")}
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 0
    assert stats["skipped_collision"] == 1
    assert conn.updates == []


def test_one_name_unresolved_row_skipped():
    """One name has no rxcui → row skipped, counted as skipped_unresolved."""
    rows = [_make_row(4, "Omeprazole", "UnknownDrug")]
    cache = {"omeprazole": "7646", "unknowndrug": None}
    occupied: set = set()
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 0
    assert stats["skipped_unresolved"] == 1
    assert conn.updates == []


def test_self_pair_skipped():
    """a == b (same ingredient on both sides) → skipped_self_pair."""
    rows = [_make_row(5, "Ibuprofen", "Advil")]
    # Both names resolve to the same rxcui (brand and generic of same drug)
    cache = {"ibuprofen": "5640", "advil": "5640"}
    occupied: set = set()
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 0
    assert stats["skipped_self_pair"] == 1
    assert conn.updates == []


def test_dry_run_no_updates_executed():
    """dry_run=True → no UPDATE statements issued even when pair would be valid."""
    rows = [_make_row(6, "Omeprazole", "Clopidogrel")]
    cache = {"omeprazole": "7646", "clopidogrel": "32968"}
    occupied: set = set()
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=True, conn=conn)

    # The resolved pair is counted
    assert stats["updated"] == 1
    # But the occupied set IS updated in-memory (so intra-run duplicates are caught)
    assert ("7646", "32968") in occupied
    # And no SQL UPDATE was executed
    assert conn.updates == []


def test_intra_run_duplicate_caught():
    """Two DDInter rows resolving to the same pair: first is written, second skipped."""
    rows = [
        _make_row(7, "Omeprazole", "Clopidogrel"),
        _make_row(8, "Omeprazole", "Clopidogrel"),  # duplicate pair
    ]
    cache = {"omeprazole": "7646", "clopidogrel": "32968"}
    occupied: set = set()
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 1
    assert stats["skipped_collision"] == 1
    assert len(conn.updates) == 1


def test_mixed_batch_all_outcomes():
    """A batch with all four outcome types produces correct aggregate counts."""
    rows = [
        _make_row(10, "Omeprazole", "Clopidogrel"),   # → updated (a,b free)
        _make_row(11, "Omeprazole", "Clopidogrel"),   # → skipped_collision (both taken now)
        _make_row(12, "Aspirin", "UnknownDrug"),      # → skipped_unresolved
        _make_row(13, "Ibuprofen", "Advil"),          # → skipped_self_pair
    ]
    # Pre-occupy (32968, 7646) so row 11 can't use the reversed order either
    occupied = {("32968", "7646")}
    cache = {
        "omeprazole": "7646",
        "clopidogrel": "32968",
        "aspirin": "1191",
        "unknowndrug": None,
        "ibuprofen": "5640",
        "advil": "5640",
    }
    conn = _FakeConn()

    stats = process_rows(rows, cache, occupied, dry_run=False, conn=conn)

    assert stats["updated"] == 1
    assert stats["skipped_collision"] == 1
    assert stats["skipped_unresolved"] == 1
    assert stats["skipped_self_pair"] == 1
