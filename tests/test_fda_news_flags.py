"""The three "Latest from the FDA" switches in Admin → Settings (routes/site_settings.py)."""

from __future__ import annotations

import os
from contextlib import contextmanager
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")

from routes import site_settings as ss  # noqa: E402

KEYS = ("fda_news_recalls_enabled", "fda_news_approvals_enabled", "fda_news_shortages_enabled")


def test_on_by_default_and_public():
    for key in KEYS:
        assert ss.DEFAULTS[key] is True
    with patch.object(ss, "read_flags", return_value=dict(ss.DEFAULTS)):
        public = ss.get_features()
    assert all(public[key] is True for key in KEYS)


def test_stored_values_read_back_and_junk_keeps_them_on():
    assert ss._coerce("fda_news_recalls_enabled", False) is False
    assert ss._coerce("fda_news_approvals_enabled", "false") is False
    assert ss._coerce("fda_news_shortages_enabled", "no") is True  # unreadable -> the default, on
    assert ss._coerce("fda_news_shortages_enabled", None) is True


class _Engine:
    """Records the SQL the admin save runs."""

    def __init__(self):
        self.calls = []

    @contextmanager
    def begin(self):
        engine = self

        class Conn:
            def execute(self, sql, params=None):
                engine.calls.append((" ".join(str(sql).split()), params or {}))

        yield Conn()


def test_superuser_can_switch_one_off():
    engine = _Engine()
    with patch.object(ss.database, "db_engine", engine), patch.object(ss, "read_flags", return_value={**ss.DEFAULTS, "fda_news_recalls_enabled": False}):
        out = ss.update_features(ss.FeatureUpdate(fda_news_recalls_enabled=False), admin={"email": "boss@example.com"})
    assert len(engine.calls) == 1
    sql, params = engine.calls[0]
    assert sql.startswith("INSERT INTO site_settings")
    assert params == {"key": "fda_news_recalls_enabled", "value": "false", "by": "boss@example.com"}
    assert out["fda_news_recalls_enabled"] is False and out["fda_news_approvals_enabled"] is True
