"""The storage helper must speak the Supabase Storage REST API exactly like
supabase-js does: delete = DELETE /object/{bucket} with {"prefixes": [...]}."""
from unittest.mock import MagicMock, patch

import pytest

from services import user_photos


@pytest.fixture(autouse=True)
def storage_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")


def test_delete_objects_uses_the_bulk_delete_route():
    ok = MagicMock(status_code=200, text="[]")
    with patch("services.user_photos.requests.delete", return_value=ok) as delete, \
            patch("services.user_photos.requests.post") as post:
        assert user_photos.delete_objects(["a/side1.jpg", "a/side2.jpg", "a/side1.jpg", ""]) is True
    post.assert_not_called()
    delete.assert_called_once()
    url = delete.call_args.args[0]
    kwargs = delete.call_args.kwargs
    assert url == "https://proj.supabase.co/storage/v1/object/user_pill_photos"
    assert kwargs["json"] == {"prefixes": ["a/side1.jpg", "a/side2.jpg"]}
    assert kwargs["headers"]["Authorization"] == "Bearer service-key"


def test_delete_objects_reports_failure():
    bad = MagicMock(status_code=400, text='{"error":"Duplicate"}')
    with patch("services.user_photos.requests.delete", return_value=bad):
        assert user_photos.delete_objects(["a/side1.jpg"]) is False
    with patch("services.user_photos.requests.delete", side_effect=RuntimeError("down")):
        assert user_photos.delete_objects(["a/side1.jpg"]) is False


def test_delete_objects_with_nothing_to_delete():
    with patch("services.user_photos.requests.delete") as delete:
        assert user_photos.delete_objects([]) is True
    delete.assert_not_called()
