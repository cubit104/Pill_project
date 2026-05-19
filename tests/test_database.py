from __future__ import annotations

import importlib
import os
import sys
from unittest.mock import patch

_ORIGINAL_DATABASE_MODULE = sys.modules.get("database")


def _reload_database_module(*, env: dict[str, str]):
    sys.modules.pop("database", None)
    with patch.dict(
        os.environ,
        {
            "DATABASE_URL": "postgresql://user:password@host:5432/postgres",
            **env,
        },
        clear=False,
    ):
        with patch("sqlalchemy.create_engine") as mock_create_engine:
            module = importlib.import_module("database")
    return module, mock_create_engine


def test_engine_pool_settings_from_env():
    try:
        _, mock_create_engine = _reload_database_module(
            env={
                "DB_POOL_SIZE": "7",
                "DB_MAX_OVERFLOW": "3",
                "DB_POOL_RECYCLE": "123",
                "DB_POOL_TIMEOUT": "9",
                "DB_ECHO_POOL": "true",
            }
        )

        _, kwargs = mock_create_engine.call_args
        assert kwargs["pool_size"] == 7
        assert kwargs["max_overflow"] == 3
        assert kwargs["pool_recycle"] == 123
        assert kwargs["pool_timeout"] == 9
        assert kwargs["echo_pool"] is True
    finally:
        if _ORIGINAL_DATABASE_MODULE is not None:
            sys.modules["database"] = _ORIGINAL_DATABASE_MODULE
        else:
            sys.modules.pop("database", None)


def test_engine_pool_pre_ping_enabled():
    try:
        _, mock_create_engine = _reload_database_module(env={})

        _, kwargs = mock_create_engine.call_args
        assert kwargs["pool_pre_ping"] is True
    finally:
        if _ORIGINAL_DATABASE_MODULE is not None:
            sys.modules["database"] = _ORIGINAL_DATABASE_MODULE
        else:
            sys.modules.pop("database", None)
