"""Access-origin metadata (WP3-06 Task 1).

access_summary_for_notebook/access_summary_for_source are purely additive:
they must report the exact same role as effective_role_for_notebook/
effective_role_for_source (and therefore the same authorization outcome
via the assert_* guards) while also reporting *why* the user has that
role. Mocked at the repo boundary - same style as
tests/test_access_grants_unit.py - no live SurrealDB.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, Request

from api.auth.types import AuthenticatedUser
from api.ownership import (
    access_summary_for_notebook,
    access_summary_for_source,
    assert_can_edit_notebook_or_403,
    assert_can_edit_source_or_403,
    assert_can_view_notebook_or_404,
    assert_can_view_source_or_404,
    effective_role_for_notebook,
    effective_role_for_source,
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


def _query_text(sql) -> str:
    return " ".join(str(sql).split())


class TestAccessSummaryForNotebookOrigins:
    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    async def test_owner_origin_no_query(self, _auth):
        with patch("api.ownership.repo_query", new_callable=AsyncMock) as mock_query:
            summary = await access_summary_for_notebook(
                "user:a", "notebook:1", _request_with_user()
            )
        assert summary.role == "owner"
        assert summary.origin == "owner"
        assert summary.origin_label is None
        mock_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=False)
    async def test_open_origin_when_auth_disabled(self, _auth):
        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user(None)
        )
        assert summary.role == "owner"
        assert summary.origin == "open"
        assert summary.origin_label is None

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    async def test_open_origin_when_no_user(self, _auth):
        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user(None)
        )
        assert summary.role == "owner"
        assert summary.origin == "open"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_direct_user_grant_origin(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = [
            {"role": "viewer", "principal_type": "user", "principal_id": "user:a"}
        ]

        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert summary.role == "viewer"
        assert summary.origin == "direct"
        assert summary.origin_label is None

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_group_grant_origin_carries_group_name_label(
        self, mock_query, mock_groups, _auth
    ):
        mock_groups.return_value = ["user_group:eng"]

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            if "FROM resource_grant" in text:
                return [
                    {
                        "role": "editor",
                        "principal_type": "group",
                        "principal_id": "user_group:eng",
                    }
                ]
            if text == "SELECT name FROM $id":
                return [{"name": "Engineering"}]
            return []

        mock_query.side_effect = side_effect

        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert summary.role == "editor"
        assert summary.origin == "group"
        assert summary.origin_label == "Engineering"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_no_grant_returns_none(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = []

        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert summary is None

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_equal_role_prefers_direct_over_group(
        self, mock_query, mock_groups, _auth
    ):
        """Both a direct grant and a group grant reach the same role - the
        reported origin must be the direct one, never the role itself."""
        mock_groups.return_value = ["user_group:eng"]
        mock_query.return_value = [
            {
                "role": "editor",
                "principal_type": "group",
                "principal_id": "user_group:eng",
            },
            {"role": "editor", "principal_type": "user", "principal_id": "user:a"},
        ]

        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert summary.role == "editor"
        assert summary.origin == "direct"
        assert summary.origin_label is None

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_higher_role_wins_even_when_reached_via_group(
        self, mock_query, mock_groups, _auth
    ):
        """A viewer-level direct grant must not shadow a higher editor-level
        group grant - the higher role wins, and its origin is reported."""
        mock_groups.return_value = ["user_group:eng"]

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            if "FROM resource_grant" in text:
                return [
                    {
                        "role": "viewer",
                        "principal_type": "user",
                        "principal_id": "user:a",
                    },
                    {
                        "role": "editor",
                        "principal_type": "group",
                        "principal_id": "user_group:eng",
                    },
                ]
            if text == "SELECT name FROM $id":
                return [{"name": "Engineering"}]
            return []

        mock_query.side_effect = side_effect

        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", _request_with_user()
        )

        assert summary.role == "editor"
        assert summary.origin == "group"
        assert summary.origin_label == "Engineering"


class TestAccessSummaryForSourceOrigins:
    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    async def test_owner_origin_no_query(self, _auth):
        with patch("api.ownership.repo_query", new_callable=AsyncMock) as mock_query:
            summary = await access_summary_for_source(
                "user:a", "source:1", _request_with_user()
            )
        assert summary.role == "owner"
        assert summary.origin == "owner"
        mock_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=False)
    async def test_open_origin_when_auth_disabled(self, _auth):
        summary = await access_summary_for_source(
            "user:owner", "source:1", _request_with_user(None)
        )
        assert summary.role == "owner"
        assert summary.origin == "open"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_direct_grant_on_source_itself(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            if "FROM resource_grant" in text:
                return [
                    {
                        "role": "viewer",
                        "principal_type": "user",
                        "principal_id": "user:a",
                    }
                ]
            if "FROM reference WHERE in" in text:
                return []  # no linked notebooks
            return []

        mock_query.side_effect = side_effect

        summary = await access_summary_for_source(
            "user:owner", "source:1", _request_with_user()
        )

        assert summary.role == "viewer"
        assert summary.origin == "direct"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_inherited_from_linked_notebook(self, mock_query, mock_groups, _auth):
        """No grant on the source itself; access comes entirely from a
        notebook it's linked to - origin must be "notebook" with that
        notebook's name as the label."""
        mock_groups.return_value = []

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            params = params or {}
            if "FROM resource_grant" in text:
                # Neither the source's own grants nor the linked notebook's
                # grants use a group here - direct grant on the notebook.
                if params.get("rtype") == "notebook":
                    return [
                        {
                            "role": "editor",
                            "principal_type": "user",
                            "principal_id": "user:a",
                        }
                    ]
                return []
            if "FROM reference WHERE in" in text:
                return [{"notebook_id": "notebook:1"}]
            if "FROM notebook WHERE id" in text:
                return [{"user_id": "user:owner", "name": "Research"}]
            return []

        mock_query.side_effect = side_effect

        summary = await access_summary_for_source(
            "user:owner-of-source", "source:1", _request_with_user()
        )

        assert summary.role == "editor"
        assert summary.origin == "notebook"
        assert summary.origin_label == "Research"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_notebook_owner_cascades_as_editor_not_owner(
        self, mock_query, mock_groups, _auth
    ):
        """Mirrors effective_role_for_source: owning the linked notebook
        grants editor (not owner) on a source you don't personally own."""
        mock_groups.return_value = []

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            if "FROM resource_grant" in text:
                return []
            if "FROM reference WHERE in" in text:
                return [{"notebook_id": "notebook:1"}]
            if "FROM notebook WHERE id" in text:
                # Current user owns the linked notebook outright.
                return [{"user_id": "user:a", "name": "Research"}]
            return []

        mock_query.side_effect = side_effect

        summary = await access_summary_for_source(
            "user:someone-else", "source:1", _request_with_user()
        )

        assert summary.role == "editor"
        assert summary.origin == "notebook"
        assert summary.origin_label == "Research"

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_no_access_returns_none(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = []

        summary = await access_summary_for_source(
            "user:owner", "source:1", _request_with_user()
        )

        assert summary is None

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_equal_role_prefers_direct_over_notebook(
        self, mock_query, mock_groups, _auth
    ):
        """A direct viewer grant on the source and an editor-level notebook
        cascade differ in role, so the higher (notebook) role wins - but
        when both reach the SAME role, direct must be preferred."""
        mock_groups.return_value = []

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            params = params or {}
            if "FROM resource_grant" in text:
                if params.get("rtype") == "source":
                    return [
                        {
                            "role": "editor",
                            "principal_type": "user",
                            "principal_id": "user:a",
                        }
                    ]
                if params.get("rtype") == "notebook":
                    return [
                        {
                            "role": "editor",
                            "principal_type": "user",
                            "principal_id": "user:a",
                        }
                    ]
                return []
            if "FROM reference WHERE in" in text:
                return [{"notebook_id": "notebook:1"}]
            if "FROM notebook WHERE id" in text:
                return [{"user_id": "user:owner", "name": "Research"}]
            return []

        mock_query.side_effect = side_effect

        summary = await access_summary_for_source(
            "user:owner", "source:1", _request_with_user()
        )

        assert summary.role == "editor"
        assert summary.origin == "direct"


class TestRoleParityWithExistingAuthorizationHelpers:
    """access_summary_for_notebook/source must never change what the
    assert_*/effective_role_for_* helpers decide - same role, same 404/403
    outcome - for every scenario below."""

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_notebook_owner_parity(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = []
        request = _request_with_user()

        old_role = await effective_role_for_notebook("user:a", "notebook:1", request)
        summary = await access_summary_for_notebook("user:a", "notebook:1", request)

        assert summary.role == old_role == "owner"
        old_view_role = await assert_can_view_notebook_or_404(
            "user:a", "notebook:1", request, "Notebook not found"
        )
        old_edit_role = await assert_can_edit_notebook_or_403(
            "user:a", "notebook:1", request, "Notebook not found"
        )
        assert old_view_role == old_edit_role == summary.role

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_notebook_viewer_grant_parity_403_on_edit(
        self, mock_query, mock_groups, _auth
    ):
        mock_groups.return_value = []
        mock_query.return_value = [
            {"role": "viewer", "principal_type": "user", "principal_id": "user:a"}
        ]
        request = _request_with_user()

        old_role = await effective_role_for_notebook(
            "user:owner", "notebook:1", request
        )
        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", request
        )
        assert summary.role == old_role == "viewer"

        view_role = await assert_can_view_notebook_or_404(
            "user:owner", "notebook:1", request, "Notebook not found"
        )
        assert view_role == summary.role

        with pytest.raises(HTTPException) as exc:
            await assert_can_edit_notebook_or_403(
                "user:owner", "notebook:1", request, "Notebook not found"
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_notebook_no_access_parity_404(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []
        mock_query.return_value = []
        request = _request_with_user()

        old_role = await effective_role_for_notebook(
            "user:owner", "notebook:1", request
        )
        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", request
        )
        assert old_role is None
        assert summary is None

        with pytest.raises(HTTPException) as exc:
            await assert_can_view_notebook_or_404(
                "user:owner", "notebook:1", request, "Notebook not found"
            )
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=True)
    @patch("api.ownership.list_user_group_ids", new_callable=AsyncMock)
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    async def test_source_editor_grant_parity(self, mock_query, mock_groups, _auth):
        mock_groups.return_value = []

        async def side_effect(sql, params=None):
            text = _query_text(sql)
            if "FROM resource_grant" in text:
                return [
                    {
                        "role": "editor",
                        "principal_type": "user",
                        "principal_id": "user:a",
                    }
                ]
            if "FROM reference WHERE in" in text:
                return []
            return []

        mock_query.side_effect = side_effect
        request = _request_with_user()

        old_role = await effective_role_for_source("user:owner", "source:1", request)
        summary = await access_summary_for_source("user:owner", "source:1", request)
        assert summary.role == old_role == "editor"

        view_role = await assert_can_view_source_or_404(
            "user:owner", "source:1", request, "Source not found"
        )
        edit_role = await assert_can_edit_source_or_403(
            "user:owner", "source:1", request, "Source not found"
        )
        assert view_role == edit_role == summary.role

    @pytest.mark.asyncio
    @patch("api.ownership.auth_enforces_ownership", return_value=False)
    async def test_auth_disabled_parity(self, _auth):
        request = _request_with_user(None)

        old_role = await effective_role_for_notebook(
            "user:owner", "notebook:1", request
        )
        summary = await access_summary_for_notebook(
            "user:owner", "notebook:1", request
        )
        assert old_role == "owner"
        assert summary.role == "owner"
        assert summary.origin == "open"
