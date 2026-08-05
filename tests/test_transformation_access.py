from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from api.auth.types import AuthenticatedUser
from api.transformation_access import (
    access_flags,
    assert_can_delete,
    assert_can_edit,
    assert_can_restore,
    stamp_on_create,
)
from open_notebook.domain.transformation import Transformation


def _user(role: str = "user", user_id: str = "user:1") -> AuthenticatedUser:
    return AuthenticatedUser(
        id=user_id,
        email="u@example.com",
        display_name="U",
        role=role,  # type: ignore[arg-type]
        entra_oid="oid",
        client_id="local",
    )


def _request(user: AuthenticatedUser | None) -> MagicMock:
    request = MagicMock()
    request.state.user = user
    return request


def _transformation(**kwargs) -> Transformation:
    data = dict(
        id="transformation:1",
        name="Custom",
        title="Custom",
        description="d",
        prompt="p",
        apply_default=False,
        is_builtin=False,
        user_id=None,
        deleted_at=None,
        created=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    data.update(kwargs)
    return Transformation(**data)


def _auth_on(monkeypatch) -> None:
    monkeypatch.setattr(
        "api.transformation_access.auth_enforces_ownership", lambda: True
    )


def test_access_flags_shared_admin_can_mutate(monkeypatch):
    monkeypatch.setattr(
        "api.transformation_access.auth_enforces_ownership", lambda: True
    )
    t = _transformation(is_builtin=True)
    assert access_flags(t, _user("admin")) == (True, True, False)


def test_access_flags_shared_user_cannot_mutate(monkeypatch):
    monkeypatch.setattr(
        "api.transformation_access.auth_enforces_ownership", lambda: True
    )
    t = _transformation(is_builtin=True)
    assert access_flags(t, _user("user")) == (False, False, False)


def test_access_flags_personal_owner_only(monkeypatch):
    monkeypatch.setattr(
        "api.transformation_access.auth_enforces_ownership", lambda: True
    )
    t = _transformation(user_id="user:1")
    assert access_flags(t, _user("user", "user:1")) == (True, True, False)
    assert access_flags(t, _user("user", "user:2")) == (False, False, False)
    assert access_flags(t, _user("admin", "user:admin")) == (False, False, False)


def test_access_flags_soft_deleted_builtin_restorable_by_admin(monkeypatch):
    monkeypatch.setattr(
        "api.transformation_access.auth_enforces_ownership", lambda: True
    )
    t = _transformation(
        is_builtin=True,
        deleted_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )
    assert access_flags(t, _user("admin")) == (False, False, True)
    assert access_flags(t, _user("user")) == (False, False, False)


def test_stamp_on_create_admin_shared_user_personal(monkeypatch):
    monkeypatch.setattr(
        "api.transformation_access.auth_enforces_ownership", lambda: True
    )
    admin_t = _transformation()
    stamp_on_create(admin_t, _user("admin", "user:admin"))
    assert admin_t.user_id is None
    assert admin_t.is_builtin is False

    user_t = _transformation()
    stamp_on_create(user_t, _user("user", "user:42"))
    assert user_t.user_id == "user:42"


def test_assert_can_edit_shared_explains_admin_only(monkeypatch):
    _auth_on(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        assert_can_edit(_transformation(is_builtin=True), _request(_user("user")))
    assert exc.value.status_code == 403
    assert exc.value.detail == (
        "Only an administrator can edit shared transformations"
    )


def test_assert_can_edit_personal_explains_owner_only(monkeypatch):
    _auth_on(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        assert_can_edit(
            _transformation(user_id="user:1"), _request(_user("user", "user:2"))
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "You can only edit your own transformations"


def test_assert_can_delete_shared_explains_admin_only(monkeypatch):
    _auth_on(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        assert_can_delete(_transformation(user_id=None), _request(_user("user")))
    assert exc.value.status_code == 403
    assert exc.value.detail == (
        "Only an administrator can delete shared transformations"
    )


def test_assert_can_delete_personal_explains_owner_only(monkeypatch):
    _auth_on(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        assert_can_delete(
            _transformation(user_id="user:1"), _request(_user("user", "user:2"))
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "You can only delete your own transformations"


def test_assert_can_restore_explains_admin_only(monkeypatch):
    _auth_on(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        assert_can_restore(
            _transformation(
                is_builtin=True,
                deleted_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            ),
            _request(_user("user")),
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == (
        "Only an administrator can restore built-in transformations"
    )


def test_assert_can_edit_default_prompt_admin_only(monkeypatch):
    from api.transformation_access import assert_can_edit_default_prompt

    _auth_on(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        assert_can_edit_default_prompt(_request(_user("user")))
    assert exc.value.status_code == 403
    assert exc.value.detail == (
        "Only an administrator can edit the default transformation prompt"
    )
    assert_can_edit_default_prompt(_request(_user("admin")))

