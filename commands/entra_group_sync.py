"""Sync Entra ID group membership into local user_group_member.

Runs as a surreal-commands @command so it can be scheduled from the API
lifespan loop OR triggered manually via POST /api/groups/entra/sync.

Idempotent: each run diffs Entra membership against local membership and
applies only the delta. Members present in Entra but with no local user
row (never signed in) are counted and skipped -- they auto-attach at
first login. No schema change (uses fields already reserved in migration
28).
"""

from __future__ import annotations

from typing import Any, Optional

from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from api.graph_client import get_group, list_group_member_oids
from open_notebook.database.repository import ensure_record_id, repo_query


class SyncEntraGroupsInput(CommandInput):
    """Input for the sync command.

    `group_id` scopes the sync to a single linked group (used when the
    admin just clicked Link). When omitted, every user_group with
    source='entra' is walked.
    """

    group_id: Optional[str] = None


class SyncEntraGroupsOutput(CommandOutput):
    success: bool
    groups_synced: int = 0
    members_added: int = 0
    members_removed: int = 0
    members_skipped_unknown: int = 0
    error_message: Optional[str] = None


@command("sync_entra_groups", app="open_notebook", retry={"max_attempts": 1})
async def sync_entra_groups_command(
    input_data: SyncEntraGroupsInput,
) -> SyncEntraGroupsOutput:
    if input_data.group_id:
        rows = (
            await repo_query(
                "SELECT id, entra_group_oid, name FROM $gid "
                "WHERE source = 'entra'",
                {"gid": ensure_record_id(input_data.group_id)},
            )
            or []
        )
    else:
        rows = (
            await repo_query(
                "SELECT id, entra_group_oid, name FROM user_group "
                "WHERE source = 'entra'"
            )
            or []
        )

    totals = {
        "groups_synced": 0,
        "members_added": 0,
        "members_removed": 0,
        "members_skipped_unknown": 0,
    }

    for row in rows:
        gid = str(row.get("id", ""))
        entra_oid = row.get("entra_group_oid")
        if not gid or not entra_oid:
            continue
        try:
            snapshot = await get_group(entra_oid)
            member_oids = await list_group_member_oids(entra_oid)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"entra_group_sync gid={gid} failed to fetch: "
                f"{exc.__class__.__name__}"
            )
            continue

        # Snapshot the display name/description so admins see rename edits
        # without waiting for the next full sync.
        await repo_query(
            "UPDATE $gid SET name = $name, description = $desc",
            {
                "gid": ensure_record_id(gid),
                "name": snapshot.get("display_name") or row.get("name") or "",
                "desc": snapshot.get("description"),
            },
        )

        added, removed, skipped = await _reconcile_members(gid, member_oids)
        totals["groups_synced"] += 1
        totals["members_added"] += added
        totals["members_removed"] += removed
        totals["members_skipped_unknown"] += skipped
        # Counts only -- never emails, per SHARING.md logging rule.
        logger.info(
            f"entra_group_sync gid={gid} added={added} removed={removed} "
            f"skipped_unknown={skipped}"
        )

    return SyncEntraGroupsOutput(success=True, **totals)


async def _reconcile_members(
    gid: str, entra_oids: list[str]
) -> tuple[int, int, int]:
    """Diff Entra membership against local; apply INSERT/DELETE deltas."""
    entra_set = set(entra_oids)
    known: list[dict[str, Any]] = (
        await repo_query(
            "SELECT id, entra_oid FROM user WHERE entra_oid IN $oids",
            {"oids": list(entra_set)},
        )
        if entra_set
        else []
    ) or []
    entra_to_local = {row["entra_oid"]: str(row["id"]) for row in known}
    skipped_unknown = len(entra_set) - len(entra_to_local)
    desired_user_ids = set(entra_to_local.values())

    existing = (
        await repo_query(
            "SELECT user_id FROM user_group_member WHERE group_id = $gid",
            {"gid": ensure_record_id(gid)},
        )
        or []
    )
    existing_user_ids = {str(row["user_id"]) for row in existing}

    to_add = desired_user_ids - existing_user_ids
    to_remove = existing_user_ids - desired_user_ids

    for uid in to_add:
        await repo_query(
            "CREATE user_group_member SET group_id = $gid, user_id = $uid",
            {
                "gid": ensure_record_id(gid),
                "uid": ensure_record_id(uid),
            },
        )
    for uid in to_remove:
        await repo_query(
            "DELETE user_group_member WHERE group_id = $gid AND user_id = $uid",
            {
                "gid": ensure_record_id(gid),
                "uid": ensure_record_id(uid),
            },
        )
    return len(to_add), len(to_remove), skipped_unknown
