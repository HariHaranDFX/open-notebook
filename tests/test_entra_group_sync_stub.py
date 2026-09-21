"""Tests for WBS 4.21 JIT-stub behavior inside sync_entra_groups."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from commands.entra_group_sync import (
    SyncEntraGroupsInput,
    sync_entra_groups_command,
)


class _FakeExecutionContext:
    command_id = "test-cmd"


def _input(**kwargs) -> SyncEntraGroupsInput:
    inp = SyncEntraGroupsInput(**kwargs)
    inp.execution_context = _FakeExecutionContext()  # type: ignore[attr-defined]
    return inp


@pytest.mark.asyncio
async def test_sync_stubs_previously_unknown_members(monkeypatch):
    """Graph returns 4 members: 2 known locally, 2 unknown → stub both unknowns."""
    monkeypatch.setenv("CLIENT_ID", "local")

    linked = [
        {"id": "user_group:g1", "entra_group_oid": "eoid-1", "name": "old"}
    ]

    creates: list[dict] = []
    updates_email_oid: list[dict] = []

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        p = params or {}
        if "select" in q and "user_group" in q and "source = 'entra'" in q:
            return linked
        if "select" in q and "from user" in q and "entra_oid in" in q:
            oids = p.get("oids", [])
            mapping = {"e-known-1": "user:1", "e-known-2": "user:2"}
            return [
                {"id": mapping[o], "entra_oid": o}
                for o in oids
                if o in mapping
            ]
        if q.startswith("select id, entra_oid from user where email = $email"):
            # No pre-existing rows for the stubs — take the CREATE branch.
            return []
        if q.startswith("create user set"):
            creates.append(p)
            # Pretend surreal assigned an id based on the email.
            return [
                {
                    "id": f"user:new-{p['email']}",
                    "email": p["email"],
                    "display_name": p["display_name"],
                }
            ]
        if q.startswith("update $uid set entra_oid"):
            updates_email_oid.append(p)
            return []
        if q.startswith("select user_id from user_group_member"):
            # Only user:2 was already in the group; the rest are net-new.
            return [{"user_id": "user:2"}]
        # Writes (UPDATE / CREATE user_group_member / DELETE) — no rows returned.
        return []

    graph_profiles = [
        {
            "entra_oid": "e-unknown-1",
            "email": "new1@x",
            "display_name": "New One",
        },
        {
            "entra_oid": "e-unknown-2",
            "email": "new2@x",
            "display_name": "New Two",
        },
    ]

    with (
        patch(
            "commands.entra_group_sync.get_group",
            new=AsyncMock(
                return_value={
                    "entra_group_oid": "eoid-1",
                    "display_name": "Engineering",
                    "description": None,
                }
            ),
        ),
        patch(
            "commands.entra_group_sync.list_group_member_oids",
            new=AsyncMock(
                return_value=[
                    "e-known-1",
                    "e-known-2",
                    "e-unknown-1",
                    "e-unknown-2",
                ]
            ),
        ),
        patch(
            "commands.entra_group_sync.list_users_by_oids",
            new=AsyncMock(return_value=graph_profiles),
        ),
        patch(
            "commands.entra_group_sync.repo_query",
            new=AsyncMock(side_effect=fake_repo_query),
        ),
    ):
        result = await sync_entra_groups_command(_input())

    assert result.success is True
    assert result.groups_synced == 1
    assert result.members_stubbed == 2
    assert result.members_skipped_unknown == 0
    # Members added: user:1 (known, not previously in group) + the 2 stubs.
    # user:2 was already in the group, so it does not count.
    assert result.members_added == 3
    assert result.members_removed == 0

    # Two CREATE user rows landed with the expected email/client_id.
    # (`role` is a SQL literal in the CREATE, not a bound param.)
    assert len(creates) == 2
    for row in creates:
        assert row["client_id"] == "local"
        assert row["email"].startswith("new")
        assert row["oid"].startswith("e-unknown-")


@pytest.mark.asyncio
async def test_sync_counts_deleted_accounts_as_skipped_when_graph_omits_them(
    monkeypatch,
):
    """Graph returns fewer profiles than requested → the missing ones are skipped."""
    monkeypatch.setenv("CLIENT_ID", "local")

    linked = [
        {"id": "user_group:g1", "entra_group_oid": "eoid-1", "name": "n"}
    ]

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        p = params or {}
        if "select" in q and "user_group" in q and "source = 'entra'" in q:
            return linked
        if "select" in q and "from user" in q and "entra_oid in" in q:
            return []  # nothing known
        if q.startswith("select id, entra_oid from user where email = $email"):
            return []
        if q.startswith("create user set"):
            return [
                {
                    "id": f"user:new-{p['email']}",
                    "email": p["email"],
                    "display_name": p["display_name"],
                }
            ]
        if q.startswith("select user_id from user_group_member"):
            return []
        return []

    # Only one profile came back for two OIDs — the second is deleted.
    with (
        patch(
            "commands.entra_group_sync.get_group",
            new=AsyncMock(
                return_value={
                    "entra_group_oid": "eoid-1",
                    "display_name": "n",
                    "description": None,
                }
            ),
        ),
        patch(
            "commands.entra_group_sync.list_group_member_oids",
            new=AsyncMock(return_value=["oid-alive", "oid-deleted"]),
        ),
        patch(
            "commands.entra_group_sync.list_users_by_oids",
            new=AsyncMock(
                return_value=[
                    {
                        "entra_oid": "oid-alive",
                        "email": "alive@x",
                        "display_name": "Alive",
                    }
                ]
            ),
        ),
        patch(
            "commands.entra_group_sync.repo_query",
            new=AsyncMock(side_effect=fake_repo_query),
        ),
    ):
        result = await sync_entra_groups_command(_input())

    assert result.members_stubbed == 1
    assert result.members_skipped_unknown == 1
    assert result.members_added == 1


@pytest.mark.asyncio
async def test_sync_graph_wide_failure_treats_all_unknown_as_skipped(monkeypatch):
    """list_users_by_oids raises → whole batch counts as skipped, no crash."""
    from api.graph_client import GraphAPIError

    monkeypatch.setenv("CLIENT_ID", "local")

    linked = [
        {"id": "user_group:g1", "entra_group_oid": "eoid-1", "name": "n"}
    ]

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select" in q and "user_group" in q and "source = 'entra'" in q:
            return linked
        if "select" in q and "from user" in q and "entra_oid in" in q:
            return []
        if q.startswith("select user_id from user_group_member"):
            return []
        return []

    with (
        patch(
            "commands.entra_group_sync.get_group",
            new=AsyncMock(
                return_value={
                    "entra_group_oid": "eoid-1",
                    "display_name": "n",
                    "description": None,
                }
            ),
        ),
        patch(
            "commands.entra_group_sync.list_group_member_oids",
            new=AsyncMock(return_value=["a", "b", "c"]),
        ),
        patch(
            "commands.entra_group_sync.list_users_by_oids",
            new=AsyncMock(
                side_effect=GraphAPIError(403, "list_users_by_oids", "denied")
            ),
        ),
        patch(
            "commands.entra_group_sync.repo_query",
            new=AsyncMock(side_effect=fake_repo_query),
        ),
    ):
        result = await sync_entra_groups_command(_input())

    assert result.success is True
    assert result.members_stubbed == 0
    assert result.members_skipped_unknown == 3
    assert result.members_added == 0


# ---------------------------------------------------------------------------
# Staged log observability — locks the wording admins grep for in the worker
# log. If someone silently deletes a phrase, these tests catch it. Same
# loguru→sink pattern used in tests/test_background_retry_visibility.py.
# ---------------------------------------------------------------------------


def _capture_logs(level: str = "INFO"):
    """Return (messages, remover) — call remover() in a finally to detach."""
    from loguru import logger

    messages: list[str] = []
    sink_id = logger.add(
        lambda message: messages.append(str(message)), level=level
    )
    return messages, lambda: logger.remove(sink_id)


@pytest.mark.asyncio
async def test_sync_logs_start_and_done_banners_and_totals():
    """Every run prints a Start banner, a DONE block, and the totals — so
    'did it even run?' is never in doubt."""
    linked = [
        {"id": "user_group:g1", "entra_group_oid": "eoid-1", "name": "Eng"}
    ]

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select" in q and "user_group" in q and "source = 'entra'" in q:
            return linked
        if "select" in q and "from user" in q and "entra_oid in" in q:
            return []
        if q.startswith("select user_id from user_group_member"):
            return []
        return []

    messages, remover = _capture_logs()
    try:
        with (
            patch(
                "commands.entra_group_sync.get_group",
                new=AsyncMock(
                    return_value={
                        "entra_group_oid": "eoid-1",
                        "display_name": "Eng",
                        "description": None,
                    }
                ),
            ),
            patch(
                "commands.entra_group_sync.list_group_member_oids",
                new=AsyncMock(return_value=[]),
            ),
            patch(
                "commands.entra_group_sync.repo_query",
                new=AsyncMock(side_effect=fake_repo_query),
            ),
        ):
            result = await sync_entra_groups_command(_input())
    finally:
        remover()

    assert result.success is True
    joined = "\n".join(messages)
    assert "Starting Entra group sync (scope=all)" in joined
    assert "Found 1 Entra-linked group(s) to sync" in joined
    assert "Syncing group 'Eng' gid=user_group:g1" in joined
    assert "Entra group sync DONE" in joined
    assert "Groups synced: 1/1" in joined
    assert "Elapsed:" in joined


@pytest.mark.asyncio
async def test_sync_logs_nothing_to_sync_when_zero_groups():
    """The silent-run-with-no-groups case (currently just prints nothing)
    must explicitly say so — that's the whole reason we added these logs."""
    messages, remover = _capture_logs()
    try:
        with patch(
            "commands.entra_group_sync.repo_query",
            new=AsyncMock(return_value=[]),
        ):
            result = await sync_entra_groups_command(_input())
    finally:
        remover()

    assert result.success is True
    joined = "\n".join(messages)
    assert "Found 0 Entra-linked group(s) to sync" in joined
    assert "Nothing to sync — no groups have source='entra'" in joined
    # No per-group phase line — nothing to iterate.
    assert "Syncing group" not in joined
    # No DONE banner in the no-op branch — the "Nothing to sync" line
    # already carries elapsed and the closing banner.
    assert "Entra group sync DONE" not in joined


@pytest.mark.asyncio
async def test_sync_logs_failed_and_returns_success_false_on_uncaught_error():
    """An uncaught exception surfaces as `success=False` + `error_message`
    on the output, with an ERROR log line naming the exception. Regression
    guard against a silent crash."""
    messages, remover = _capture_logs(level="ERROR")
    try:
        with patch(
            "commands.entra_group_sync.repo_query",
            new=AsyncMock(side_effect=RuntimeError("db unavailable")),
        ):
            result = await sync_entra_groups_command(_input())
    finally:
        remover()

    assert result.success is False
    assert result.error_message is not None
    assert "RuntimeError" in result.error_message
    joined = "\n".join(messages)
    assert "Entra group sync FAILED" in joined
    assert "RuntimeError" in joined
