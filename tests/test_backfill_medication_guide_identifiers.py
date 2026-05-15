import os

from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key")

from services.medication_guide_identifier_backfill import run_backfill


class _FakeRow:
    def __init__(self, data):
        self._mapping = dict(data)


class _FakeResult:
    def __init__(self, rows=None, rowcount=0):
        self._rows = rows or []
        self.rowcount = rowcount

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _FakeConn:
    def __init__(self, state):
        self.state = state

    def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}

        if "CREATE TABLE IF NOT EXISTS medication_guide_identifier_backfill_log" in sql:
            return _FakeResult()

        if "FROM medication_guide" in sql and "ORDER BY id" in sql:
            rows = [
                _FakeRow(row)
                for row in self.state["medication_guide"]
                if not (row.get("ndc") or "").strip() or not (row.get("rxcui") or "").strip()
            ]
            offset = params.get("offset", 0)
            limit = params.get("limit", len(rows))
            return _FakeResult(rows[offset : offset + limit])

        if "FROM pillfinder" in sql and "spl_set_id = :spl_set_id" in sql:
            row = next(
                (
                    _FakeRow(candidate)
                    for candidate in self.state["pillfinder"]
                    if candidate.get("deleted_at") is None and candidate.get("spl_set_id") == params.get("spl_set_id")
                ),
                None,
            )
            return _FakeResult([row] if row else [])

        if "FROM pillfinder" in sql and "rxcui = :rxcui" in sql:
            row = next(
                (
                    _FakeRow(candidate)
                    for candidate in self.state["pillfinder"]
                    if candidate.get("deleted_at") is None and candidate.get("rxcui") == params.get("rxcui")
                ),
                None,
            )
            return _FakeResult([row] if row else [])

        if "FROM pillfinder" in sql and "ndc11 = :ndc11" in sql:
            row = next(
                (
                    _FakeRow(candidate)
                    for candidate in self.state["pillfinder"]
                    if candidate.get("deleted_at") is None and candidate.get("ndc11") == params.get("ndc11")
                ),
                None,
            )
            return _FakeResult([row] if row else [])

        if "UPDATE medication_guide" in sql and "SET ndc = :ndc" in sql:
            for row in self.state["medication_guide"]:
                if row["id"] == params["medication_guide_id"] and not (row.get("ndc") or "").strip():
                    row["ndc"] = params["ndc"]
                    return _FakeResult(rowcount=1)
            return _FakeResult(rowcount=0)

        if "UPDATE medication_guide" in sql and "SET rxcui = :rxcui" in sql:
            for row in self.state["medication_guide"]:
                if row["id"] == params["medication_guide_id"] and not (row.get("rxcui") or "").strip():
                    row["rxcui"] = params["rxcui"]
                    return _FakeResult(rowcount=1)
            return _FakeResult(rowcount=0)

        if "INSERT INTO medication_guide_identifier_backfill_log" in sql:
            self.state["logs"].append(dict(params))
            return _FakeResult(rowcount=1)

        raise AssertionError(f"Unexpected SQL: {sql}")


class _FakeContext:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeEngine:
    def __init__(self, state):
        self.conn = _FakeConn(state)

    def connect(self):
        return _FakeContext(self.conn)

    def begin(self):
        return _FakeContext(self.conn)


def _state_with_rows(*, medication_guide_row, pillfinder_row):
    return {
        "medication_guide": [medication_guide_row],
        "pillfinder": [pillfinder_row],
        "logs": [],
    }


def test_backfill_dry_run_does_not_write():
    state = _state_with_rows(
        medication_guide_row={"id": 1, "ndc": None, "rxcui": None, "spl_set_id": "set-1"},
        pillfinder_row={"id": "pill-1", "ndc11": "54868-4735-00", "rxcui": "861689", "spl_set_id": "set-1", "deleted_at": None},
    )

    with patch("services.medication_guide_identifier_backfill.database.db_engine", _FakeEngine(state)):
        summary = run_backfill(limit=10, dry_run=True, sleep_ms=0)

    assert state["medication_guide"][0]["ndc"] is None
    assert state["medication_guide"][0]["rxcui"] is None
    assert state["logs"] == []
    assert summary["rows"][0]["outcome"] == "dry_run"


def test_backfill_live_run_updates_null_only():
    state = _state_with_rows(
        medication_guide_row={"id": 2, "ndc": None, "rxcui": None, "spl_set_id": "set-2"},
        pillfinder_row={"id": "pill-2", "ndc11": "54868-4735-00", "rxcui": "861689", "spl_set_id": "set-2", "deleted_at": None},
    )

    with patch("services.medication_guide_identifier_backfill.database.db_engine", _FakeEngine(state)):
        summary = run_backfill(limit=10, dry_run=False, sleep_ms=0)

    assert state["medication_guide"][0]["ndc"] == "54868-4735-00"
    assert state["medication_guide"][0]["rxcui"] == "861689"
    assert summary["updated"] == 1
    assert state["logs"][0]["outcome"] == "updated"


def test_backfill_never_overwrites_existing():
    state = _state_with_rows(
        medication_guide_row={"id": 3, "ndc": "EXISTING", "rxcui": None, "spl_set_id": "set-3"},
        pillfinder_row={"id": "pill-3", "ndc11": "54868-4735-00", "rxcui": "861689", "spl_set_id": "set-3", "deleted_at": None},
    )

    with patch("services.medication_guide_identifier_backfill.database.db_engine", _FakeEngine(state)):
        summary = run_backfill(limit=10, dry_run=False, sleep_ms=0)

    assert state["medication_guide"][0]["ndc"] == "EXISTING"
    assert state["medication_guide"][0]["rxcui"] == "861689"
    assert summary["updated"] == 1
    assert state["logs"][0]["old_ndc"] == "EXISTING"
    assert state["logs"][0]["new_ndc"] == "EXISTING"
