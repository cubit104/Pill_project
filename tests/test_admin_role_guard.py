"""Public 'member' accounts (app sign-ups) must never pass the admin dependency."""

import os
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")

import routes.admin.auth as auth


def _engine_with_profile_role(role):
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = (role,) if role is not None else None
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    return engine


@pytest.mark.parametrize("role,expected", [("superuser", "superuser"), ("superadmin", "superuser"), ("editor", "editor"), ("reviewer", "reviewer")])
def test_admin_roles_pass(monkeypatch, role, expected):
    monkeypatch.setattr(auth.database, "db_engine", _engine_with_profile_role(role))
    monkeypatch.setattr(auth, "_verify_jwt", lambda token: {"id": "u1", "email": "a@b.c"})
    request = MagicMock(cookies={})
    out = auth.get_admin_user(request, authorization="Bearer x")
    assert out["role"] == expected


@pytest.mark.parametrize("role", ["member", "viewer", "", None])
def test_non_admin_roles_are_rejected(monkeypatch, role):
    engine = _engine_with_profile_role(role)
    monkeypatch.setattr(auth.database, "db_engine", engine)
    monkeypatch.setattr(auth, "_verify_jwt", lambda token: {"id": "u1", "email": "a@b.c"})
    request = MagicMock(cookies={})
    with pytest.raises(HTTPException) as exc:
        auth.get_admin_user(request, authorization="Bearer x")
    assert exc.value.status_code == 403


def test_normalise_role_has_no_admin_default():
    assert auth._normalise_role(None) is None
    assert auth._normalise_role("") is None
    assert auth._normalise_role("superadmin") == "superuser"
