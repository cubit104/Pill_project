import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "******localhost:5432/testdb")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")


@pytest.fixture(scope="module")
def client():
    with patch("main.connect_to_database", return_value=True), \
         patch("main.warmup_system", return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


def test_editorial_team_uses_reviewers_table_and_sorts_by_name(client):
    import database as db_module

    executed_sqls: list[str] = []
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [
        (
            "2",
            "zed-reviewer",
            "Zed Reviewer",
            "PharmD",
            "medical_reviewer",
            "Oncology",
            "Bio",
            None,
            None,
            [],
            [],
            None,
            True,
            "2024-01-02T00:00:00Z",
            "2024-01-03T00:00:00Z",
        ),
        (
            "1",
            "amy-reviewer",
            "Amy Reviewer",
            "MD",
            "medical_reviewer",
            "Cardiology",
            "Bio",
            None,
            None,
            [],
            [],
            None,
            True,
            "2024-01-01T00:00:00Z",
            "2024-01-04T00:00:00Z",
        ),
        (
            "3",
            "author-reviewer",
            "Author Reviewer",
            None,
            "author",
            None,
            None,
            None,
            None,
            None,
            None,
            True,
            "2024-01-05T00:00:00Z",
            "2024-01-06T00:00:00Z",
        ),
    ]

    def side_effect(sql, *args, **kwargs):
        executed_sqls.append(str(sql).lower())
        return mock_result

    db_module.db_engine.connect.return_value.__enter__.return_value.execute.side_effect = side_effect
    response = client.get("/api/editorial-team")

    assert response.status_code == 200
    data = response.json()
    assert [row["name"] for row in data] == ["Amy Reviewer", "Zed Reviewer", "Author Reviewer"]
    assert "full_name" not in data[0]
    assert any("from public.reviewers" in sql for sql in executed_sqls)
    assert any("is_public = true and is_active = true" in sql for sql in executed_sqls)


def test_editorial_team_member_returns_real_schema_fields(client):
    import database as db_module

    mock_result = MagicMock()
    mock_result.fetchone.return_value = (
        "1",
        "amy-reviewer",
        "Amy Reviewer",
        "MD",
        "medical_reviewer",
        "Cardiology",
        "Bio",
        "https://cdn.example.com/avatar.jpg",
        "https://www.linkedin.com/in/amy-reviewer",
        [{"degree": "MD", "institution": "Example University"}],
        ["https://orcid.org/0000-0000-0000-0000"],
        "CA License",
        True,
        "2024-01-01T00:00:00Z",
        "2024-01-04T00:00:00Z",
    )
    execute = db_module.db_engine.connect.return_value.__enter__.return_value.execute
    execute.side_effect = None
    execute.return_value = mock_result

    response = client.get("/api/editorial-team/amy-reviewer")

    assert response.status_code == 200
    assert response.json() == {
        "id": "1",
        "slug": "amy-reviewer",
        "name": "Amy Reviewer",
        "credentials": "MD",
        "role": "medical_reviewer",
        "specialty": "Cardiology",
        "bio": "Bio",
        "avatar_url": "https://cdn.example.com/avatar.jpg",
        "linkedin_url": "https://www.linkedin.com/in/amy-reviewer",
        "education": [{"degree": "MD", "institution": "Example University"}],
        "same_as": ["https://orcid.org/0000-0000-0000-0000"],
        "license_info": "CA License",
        "is_active": True,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-04T00:00:00Z",
    }
