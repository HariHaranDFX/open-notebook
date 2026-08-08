"""Unit tests for WP2b access-grant helpers in api/ownership.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import Request

from api.auth.types import AuthenticatedUser
from api.ownership import (
    effective_role_for_notebook,
    role_at_least,
)


USER_A = AuthenticatedUser(
    id="user:a",
    email="a@example.com",
    display_name="User A",
    role="user",
    entra_oid=None,
    client_id="client-1",
)


def _request_with_user(user: AuthenticatedUser | None = USER_A) -> Request:
    req = MagicMock(spec=Request)
    req.state = MagicMock()
    req.state.user = user
    return req


class TestRoleAtLeast:
    def test_none_never_satisfies(self):
        assert role_at_least(None, "viewer") is False
        assert role_at_least(None, "editor") is False
        assert role_at_least(None, "owner") is False

    def test_viewer_meets_viewer_only(self):
        assert role_at_least("viewer", "viewer") is True
        assert role_at_least("viewer", "editor") is False
        assert role_at_least("viewer", "owner") is False

    def test_editor_meets_viewer_and_editor(self):
        assert role_at_least("editor", "viewer") is True
        assert role_at_least("editor", "editor") is True
        assert role_at_least("editor", "owner") is False

    def test_owner_meets_all(self):
        assert role_at_least("owner", "viewer") is True
        assert role_at_least("owner", "editor") is True
        assert role_at_least("owner", "owner") is True


class TestMaxRoleViaEffectiveRole:
    """_max_role is private; exercise highest-wins through effective_role_for_notebook."""

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_highest_grant_wins_editor_over_viewer(
        self, mock_query, mock_groups, _auth
    ):
        mock_groups.return_value = []
        # Direct user grants: viewer + editor → editor
        mock_query.return_value = [{"role": "viewer"}, {"role": "editor"}]

        role = await effective_role_for_notebook(
            "user:other", "notebook:1", _request_with_user()
        )

        assert role == "editor"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_owner_of_resource_is_owner(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        role = await effective_role_for_notebook(
            "user:a", "notebook:1", _request_with_user()
        )
        assert role == "owner"
        mock_query.assert_not_awaited()


class TestEffectiveRoleForNotebook:
    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_user_grant_returns_viewer(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = [{"role": "viewer"}]

        role = await effective_role_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert role == "viewer"
        mock_query.assert_awaited()
        call_binds = mock_query.await_args.args[1]
        assert call_binds["rtype"] == "notebook"
        assert "1" in str(call_binds["rid"])

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_group_grant_returns_editor(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = ["user_group:eng"]
        mock_query.return_value = [{"role": "editor"}]

        role = await effective_role_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert role == "editor"
        call_binds = mock_query.await_args.args[1]
        assert call_binds["gids"] == ["user_group:eng"]

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_no_grant_returns_none(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = []

        role = await effective_role_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert role is None

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=False)
    async def test_auth_disabled_returns_owner(self, _auth):
        role = await effective_role_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )
        assert role == "owner"
