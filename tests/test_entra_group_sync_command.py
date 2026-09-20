"""Tests for the sync_entra_groups background command.

Uses AsyncMock to stub the Graph client + repo_query so the command's
diff logic is exercised in isolation.
"""

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
async def test_sync_diffs_membership_and_skips_unknown_oids():
    """One linked group; Entra has 3 members, 2 exist locally, 1 unknown."""

    linked = [
        {"id": "user_group:g1", "entra_group_oid": "eoid-1", "name": "old"}
    ]
    calls: list[str] = []

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        calls.append(q)
        if "select" in q and "user_group" in q and "source = 'entra'" in q:
            return linked
        if "select" in q and "from user" in q and "entra_oid in" in q:
            oids = (params or {}).get("oids", [])
            mapping = {"e-u1": "user:1", "e-u2": "user:2"}
            return [
                {"id": mapping[o], "entra_oid": o}
                for o in oids
                if o in mapping
            ]
        if q.startswith("select user_id from user_group_member"):
            return [{"user_id": "user:2"}, {"user_id": "user:3"}]
        # Writes (UPDATE / CREATE / DELETE) — no rows to return.
        return []

    with patch(
        "commands.entra_group_sync.get_group",
        new=AsyncMock(
            return_value={
                "entra_group_oid": "eoid-1",
                "display_name": "Engineering",
                "description": None,
            }
        ),
    ), patch(
        "commands.entra_group_sync.list_group_member_oids",
        new=AsyncMock(return_value=["e-u1", "e-u2", "e-unknown"]),
    ), patch(
        "commands.entra_group_sync.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ):
        result = await sync_entra_groups_command(_input())

    assert result.success is True
    assert result.groups_synced == 1
    # user:1 added (in Entra, absent locally); user:3 removed (absent from Entra)
    assert result.members_added == 1
    assert result.members_removed == 1
    assert result.members_skipped_unknown == 1


@pytest.mark.asyncio
async def test_sync_scoped_to_single_group_id():
    scoped_selects: list[str] = []

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select" in q and "$gid" in q and "source = 'entra'" in q:
            scoped_selects.append(q)
            return [
                {
                    "id": "user_group:g1",
                    "entra_group_oid": "eoid-1",
                    "name": "n",
                }
            ]
        if q.startswith("select user_id from user_group_member"):
            return []
        return []

    with patch(
        "commands.entra_group_sync.get_group",
        new=AsyncMock(
            return_value={
                "entra_group_oid": "eoid-1",
                "display_name": "n",
                "description": None,
            }
        ),
    ), patch(
        "commands.entra_group_sync.list_group_member_oids",
        new=AsyncMock(return_value=[]),
    ), patch(
        "commands.entra_group_sync.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ):
        result = await sync_entra_groups_command(
            _input(group_id="user_group:g1")
        )

    assert result.success is True
    assert result.groups_synced == 1
    assert scoped_selects, "expected the scoped SELECT to have run"


@pytest.mark.asyncio
async def test_sync_handles_graph_failure_per_group():
    linked = [
        {"id": "user_group:g1", "entra_group_oid": "eoid-broken", "name": "b"},
        {"id": "user_group:g2", "entra_group_oid": "eoid-2", "name": "g"},
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

    async def fake_get_group(oid):
        if oid == "eoid-broken":
            raise RuntimeError("Graph 500")
        return {
            "entra_group_oid": oid,
            "display_name": "g",
            "description": None,
        }

    with patch(
        "commands.entra_group_sync.get_group",
        new=AsyncMock(side_effect=fake_get_group),
    ), patch(
        "commands.entra_group_sync.list_group_member_oids",
        new=AsyncMock(return_value=[]),
    ), patch(
        "commands.entra_group_sync.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ):
        result = await sync_entra_groups_command(_input())

    # First group's failure did NOT abort the second group.
    assert result.success is True
    assert result.groups_synced == 1
