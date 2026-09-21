"""Sync Entra ID group membership into local user_group_member.

Runs as a surreal-commands @command so it can be scheduled from the API
lifespan loop OR triggered manually via POST /api/groups/entra/sync.

Idempotent: each run diffs Entra membership against local membership and
applies only the delta. Members present in Entra without a local user row
are JIT-stubbed via Graph (WBS 4.21) so admins see the full membership
without waiting for each user's first login; only truly unresolvable
members (deleted account, Graph fetch failed) are counted as skipped.
No schema change (uses fields already reserved in migration 28).
"""

import os
from typing import Any, Optional

from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from api.graph_client import (
    GraphAPIError,
    get_group,
    list_group_member_oids,
    list_users_by_oids,
)
from open_notebook.database.repository import ensure_record_id, repo_query

# NOTE: this module deliberately does NOT `from __future__ import annotations`.
# surreal_commands wraps `sync_entra_groups_command` in a LangChain
# RunnableLambda and calls `get_input_schema()` on it; that inspection
# resolves the `input_data: SyncEntraGroupsInput` type at introspection
# time. With PEP 563 postponed annotations, LangChain cannot resolve the
# string "SyncEntraGroupsInput" from within its own module and falls
# back to a `RootModel[...]` wrapper, which then rejects the kwargs
# `submit_command` passes it (`RootModel` only accepts `root=`).
# Keep annotations as live classes here so `submit_command(app, cmd, {"group_id": ...})`
# validates against the real BaseModel instead of the RootModel fallback.


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
    members_stubbed: int = 0
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
        "members_stubbed": 0,
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

        added, removed, stubbed, skipped = await _reconcile_members(
            gid, member_oids
        )
        totals["groups_synced"] += 1
        totals["members_added"] += added
        totals["members_removed"] += removed
        totals["members_stubbed"] += stubbed
        totals["members_skipped_unknown"] += skipped
        # Counts only -- never emails, per SHARING.md logging rule.
        logger.info(
            f"entra_group_sync gid={gid} added={added} removed={removed} "
            f"stubbed={stubbed} skipped_unknown={skipped}"
        )

    return SyncEntraGroupsOutput(success=True, **totals)


async def _reconcile_members(
    gid: str, entra_oids: list[str]
) -> tuple[int, int, int, int]:
    """Diff Entra membership against local; INSERT/DELETE + JIT-stub unknowns.

    Returns (added, removed, stubbed, skipped_unknown). Members missing
    locally are first bulk-resolved via Graph and stubbed into `user` so
    they appear in the group without waiting for their first login (WBS
    4.21). Anything still unresolvable (deleted account, Graph fetch
    failed) is counted as skipped.
    """
    entra_set = set(entra_oids)
    known: list[dict[str, Any]] = (
        await repo_query(
            "SELECT id, entra_oid FROM user WHERE entra_oid IN $oids",
            {"oids": list(entra_set)},
        )
        if entra_set
        else []
    ) or []
    entra_to_local: dict[str, str] = {
        row["entra_oid"]: str(row["id"]) for row in known
    }

    unresolved = list(entra_set - entra_to_local.keys())
    stubbed_ids, unresolved_after = await _stub_unknown_members(unresolved)
    entra_to_local.update(stubbed_ids)
    skipped_unknown = len(unresolved_after)
    stubbed_count = len(stubbed_ids)

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
    return len(to_add), len(to_remove), stubbed_count, skipped_unknown


async def _stub_unknown_members(
    oids: list[str],
) -> tuple[dict[str, str], list[str]]:
    """Best-effort JIT-stub. Returns (entra_oid → local id map, unresolved oids).

    Anything Graph could not resolve (deleted account, permission gap)
    lands in the unresolved list so the caller can count it. A Graph-wide
    failure (401/403/5xx) is logged and every OID falls into unresolved
    so the sync keeps making progress on the groups it can reach.
    """
    if not oids:
        return {}, []
    try:
        profiles = await list_users_by_oids(oids)
    except GraphAPIError as exc:
        logger.warning(
            f"entra_group_sync stub lookup failed status={exc.status_code}; "
            f"counted {len(oids)} unresolved this run"
        )
        return {}, list(oids)
    except Exception as exc:  # noqa: BLE001
        # Missing env / network hiccup — treat like a Graph failure so the
        # rest of the sync keeps making progress on groups it can reach.
        logger.warning(
            f"entra_group_sync stub lookup errored {exc.__class__.__name__}; "
            f"counted {len(oids)} unresolved this run"
        )
        return {}, list(oids)

    resolved_by_oid = {p["entra_oid"]: p for p in profiles if p.get("entra_oid")}
    client_id = os.getenv("CLIENT_ID", "default")
    stubbed: dict[str, str] = {}

    for oid in oids:
        profile = resolved_by_oid.get(oid)
        if not profile:
            continue
        email = profile.get("email") or ""
        display_name = profile.get("display_name") or email
        if not email:
            continue
        # Collapse onto an existing row if the tenant already has one with
        # the same email but no entra_oid (rare — hand-created row).
        by_email = await repo_query(
            "SELECT id, entra_oid FROM user WHERE email = $email LIMIT 1",
            {"email": email},
        )
        if by_email:
            uid = str(by_email[0]["id"])
            if not by_email[0].get("entra_oid"):
                await repo_query(
                    "UPDATE $uid SET entra_oid = $oid",
                    {"uid": ensure_record_id(uid), "oid": oid},
                )
            stubbed[oid] = uid
            continue
        rows = (
            await repo_query(
                """
                CREATE user SET
                  email = $email,
                  display_name = $display_name,
                  entra_oid = $oid,
                  role = 'user',
                  client_id = $client_id
                RETURN AFTER
                """,
                {
                    "email": email,
                    "display_name": display_name,
                    "oid": oid,
                    "client_id": client_id,
                },
            )
            or []
        )
        if rows:
            stubbed[oid] = str(rows[0]["id"])

    unresolved = [oid for oid in oids if oid not in stubbed]
    return stubbed, unresolved
