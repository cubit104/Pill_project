"""record_capture must remember every candidate the app showed (not just six),
so "This is my pill" works on visual matches further down the list."""

import json
import os
from unittest.mock import MagicMock

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

import routes.identify_feedback as fb


def _mock_engine(monkeypatch):
    conn = MagicMock()
    cm = MagicMock()
    cm.__enter__.return_value = conn
    cm.__exit__.return_value = False
    engine = MagicMock()
    engine.begin.return_value = cm
    monkeypatch.setattr(fb.database, "db_engine", engine)
    monkeypatch.setattr(fb.database, "connect_to_database", lambda: True)
    return conn


def test_record_capture_stores_all_shown_candidates_deduped_and_capped(monkeypatch):
    conn = _mock_engine(monkeypatch)
    shown = [f"pill-{i}" for i in range(12)] + ["pill-3", "", "pill-40"]
    capture_id = fb.record_capture("UM20 EXIUM", ["UM20", "EXIUM"], {"color": "purple"}, shown, False, [])
    assert capture_id
    params = conn.execute.call_args[0][1]
    stored = json.loads(params["top"])
    assert stored == [f"pill-{i}" for i in range(12)] + ["pill-40"]  # order kept, dupes and blanks dropped
    assert len(json.loads(params["top"])) <= 30


def test_record_capture_caps_at_thirty(monkeypatch):
    conn = _mock_engine(monkeypatch)
    fb.record_capture("X", ["X"], {}, [f"p{i}" for i in range(50)], False, [])
    assert len(json.loads(conn.execute.call_args[0][1]["top"])) == 30
