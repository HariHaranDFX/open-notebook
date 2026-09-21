"""App-local user groups (WP2b) + Entra-linked groups (WBS 4.20).

Local groups: admins create + manage members explicitly.
Entra-linked groups: admins link by OID; membership is managed by the
background sync command (`commands.entra_group_sync`) and cannot be
edited through the local admin endpoints (409).
"""

import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from surreal_commands import submit_command

from api.auth.deps import require_admin, require_user
from api.graph_client import GraphAPIError, search_groups, search_users
from api.graph_client import get_group as graph_get_group
from api.graph_client import get_user as graph_get_user
from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


async def _reject_if_entra(group_id: str) -> None:
    """Refuse mutations on Entra-managed groups so admins do not stomp on the sync."""
    rows = await repo_query(
        "SELECT source FROM $gid",
        {"gid": ensure_record_id(group_id)},
    )
    if rows and rows[0].get("source") == "entra":
        raise HTTPException(
            status_code=409,
            detail=(
                "This group is managed by Entra sync and cannot be edited here."
            ),
        )


_USER_ACTIONS = {"search users", "get_user", "list_users_by_oids"}
_GROUP_ACTIONS = {"search", "get_group", "list members"}


def _permission_for(action: str) -> str:
    """Return a human-readable label for the permission the given action needs.

    Kept intentionally free of Microsoft's raw permission slugs — admins
    read this in a toast and shouldn't need to translate "GroupMember.
    Read.All" back into intent.
    """
    if action in _USER_ACTIONS:
        return "the tenant directory permission"
    if action in _GROUP_ACTIONS:
        return "the group membership permission"
    return "the required Microsoft Graph permission"


def _graph_http_exception(exc: GraphAPIError) -> HTTPException:
    """Turn a Graph failure into a helpful HTTP error.

    We distinguish three failure modes so the admin sees the right cue:
    - 401 → the tenant refused our credentials; the app registration
      secret is invalid or expired.
    - 403 → the app can talk to Graph but is missing the specific
      Application permission this action needs. Microsoft returns the
      same code whether the permission was never added OR was added but
      never granted admin consent, so we surface both possibilities in
      one line and let the admin check both.
    - anything else → generic upstream error, no actionable hint.
    """
    if exc.status_code == 401:
        return HTTPException(
            status_code=502,
            detail=(
                "Microsoft Graph did not accept the connected Entra app's "
                "credentials. Ask an operator to verify the app's client "
                "secret has not expired or been rotated."
            ),
        )
    if exc.status_code == 403:
        permission = _permission_for(exc.action)
        return HTTPException(
            status_code=502,
            detail=(
                "Microsoft Graph refused the request. Ask the tenant "
                f"administrator to grant {permission} to the connected app "
                "and confirm admin consent — both are required."
            ),
        )
    return HTTPException(
        status_code=502,
        detail=(
            "Microsoft Graph returned an upstream error "
            f"(HTTP {exc.status_code}). Try again in a moment."
        ),
    )


def _require_sync_enabled() -> None:
    """Refuse manual-sync when the operator has not turned the feature on.

    The scheduled loop is off in that case too, so a "Sync now" click
    would silently do nothing. Fail fast with a 409 and human wording
    (no env-var names — that belongs in docs, not a toast).
    """
    flag = os.environ.get("ENTRA_GROUP_SYNC_ENABLED", "").strip().lower()
    if flag not in ("true", "1", "yes"):
        raise HTTPException(
            status_code=409,
            detail=(
                "Entra group sync is not enabled on this deployment. "
                "Ask an operator to enable it before running a manual sync."
            ),
        )


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None


class GroupMemberAdd(BaseModel):
    user_id: str


class GroupMemberResponse(BaseModel):
    user_id: str
    email: str
    display_name: str
    # WBS 4.21 — true when the user was JIT-stubbed (directory picker or
    # Entra group sync) and has never signed in. Drives the "Never signed
    # in" chip in the admin UI.
    pending: bool = False


class GroupResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    source: str = "local"
    entra_group_oid: Optional[str] = None
    member_count: int = 0


class EntraGroupCandidate(BaseModel):
    entra_group_oid: str
    display_name: str
    description: Optional[str] = None


class EntraLinkRequest(BaseModel):
    entra_group_oid: str = Field(..., min_length=1)


class DirectoryUserCandidate(BaseModel):
    entra_oid: str
    email: str
    display_name: str


class StubUserFromEntraRequest(BaseModel):
    entra_oid: str = Field(..., min_length=1)


class UserPickerItem(BaseModel):
    id: str
    email: str
    display_name: str
    pending: bool = False


async def _pending_user_ids(user_ids: list[str]) -> set[str]:
    """Return the subset of user_ids that have never signed in.

    A user is "pending" iff no `auth_session` row references them. Two
    small queries: fetch every session pointing at any of the input ids,
    then set-diff.
    """
    if not user_ids:
        return set()
    rids = [ensure_record_id(uid) for uid in user_ids]
    rows = (
        await repo_query(
            "SELECT user FROM auth_session WHERE user IN $ids",
            {"ids": rids},
        )
        or []
    )
    seen = {str(row["user"]) for row in rows if row.get("user")}
    return {uid for uid in user_ids if uid not in seen}


@router.get("/groups", response_model=List[GroupResponse])
async def list_groups(request: Request):
    # Any signed-in user may list groups to share with them; mutate stays admin-only.
    require_user(request)
    rows = await repo_query("SELECT * FROM user_group ORDER BY name ASC") or []
    out: list[GroupResponse] = []
    for row in rows:
        gid = str(row.get("id", ""))
        members = await repo_query(
            "SELECT count() AS c FROM user_group_member WHERE group_id = $gid GROUP ALL",
            {"gid": ensure_record_id(gid)},
        )
        count = int(members[0]["c"]) if members else 0
        out.append(
            GroupResponse(
                id=gid,
                name=row.get("name", ""),
                description=row.get("description"),
                source=row.get("source") or "local",
                entra_group_oid=row.get("entra_group_oid"),
                member_count=count,
            )
        )
    return out


@router.post("/groups", response_model=GroupResponse)
async def create_group(body: GroupCreate, request: Request):
    require_admin(request)
    existing = await repo_query(
        "SELECT id FROM user_group WHERE name = $name",
        {"name": body.name.strip()},
    )
    if existing:
        raise HTTPException(status_code=400, detail="A group with this name already exists")
    rows = await repo_query(
        """
        CREATE user_group SET
          name = $name,
          description = $description,
          source = 'local',
          entra_group_oid = NONE
        RETURN AFTER
        """,
        {
            "name": body.name.strip(),
            "description": body.description,
        },
    )
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create group")
    row = rows[0]
    return GroupResponse(
        id=str(row.get("id", "")),
        name=row.get("name", ""),
        description=row.get("description"),
        source="local",
        member_count=0,
    )


@router.get("/groups/{group_id}", response_model=GroupResponse)
async def get_group(group_id: str, request: Request):
    require_admin(request)
    rows = await repo_query(
        "SELECT * FROM $gid",
        {"gid": ensure_record_id(group_id)},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Group not found")
    row = rows[0]
    members = await repo_query(
        "SELECT count() AS c FROM user_group_member WHERE group_id = $gid GROUP ALL",
        {"gid": ensure_record_id(group_id)},
    )
    count = int(members[0]["c"]) if members else 0
    return GroupResponse(
        id=str(row.get("id", "")),
        name=row.get("name", ""),
        description=row.get("description"),
        source=row.get("source") or "local",
        entra_group_oid=row.get("entra_group_oid"),
        member_count=count,
    )


@router.patch("/groups/{group_id}", response_model=GroupResponse)
async def update_group(group_id: str, body: GroupUpdate, request: Request):
    require_admin(request)
    await _reject_if_entra(group_id)
    rows = await repo_query(
        "SELECT * FROM $gid",
        {"gid": ensure_record_id(group_id)},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Group not found")
    if body.name is not None:
        await repo_query(
            "UPDATE $gid SET name = $name",
            {"gid": ensure_record_id(group_id), "name": body.name.strip()},
        )
    if body.description is not None:
        await repo_query(
            "UPDATE $gid SET description = $description",
            {"gid": ensure_record_id(group_id), "description": body.description},
        )
    return await get_group(group_id, request)


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request):
    require_admin(request)
    rows = await repo_query(
        "SELECT id FROM $gid",
        {"gid": ensure_record_id(group_id)},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Group not found")
    await repo_query(
        "DELETE resource_grant WHERE principal_type = 'group' AND principal_id = $pid",
        {"pid": str(ensure_record_id(group_id))},
    )
    await repo_query(
        "DELETE user_group_member WHERE group_id = $gid",
        {"gid": ensure_record_id(group_id)},
    )
    await repo_query("DELETE $gid", {"gid": ensure_record_id(group_id)})
    return {"message": "Group deleted"}


@router.get("/groups/{group_id}/members", response_model=List[GroupMemberResponse])
async def list_members(group_id: str, request: Request):
    require_admin(request)
    rows = await repo_query(
        """
        SELECT user_id,
          user_id.email AS email,
          user_id.display_name AS display_name
        FROM user_group_member
        WHERE group_id = $gid
        """,
        {"gid": ensure_record_id(group_id)},
    )
    out: list[GroupMemberResponse] = []
    resolved: list[tuple[str, str, str]] = []
    for row in rows or []:
        uid = str(row.get("user_id", ""))
        if not uid:
            continue
        # FETCH-style may fail; load user if needed
        email = row.get("email")
        display_name = row.get("display_name")
        if email is None:
            users = await repo_query(
                "SELECT email, display_name FROM $uid",
                {"uid": ensure_record_id(uid)},
            )
            if users:
                email = users[0].get("email", "")
                display_name = users[0].get("display_name", "")
        resolved.append((uid, str(email or ""), str(display_name or "")))
    pending = await _pending_user_ids([uid for uid, _, _ in resolved])
    for uid, email, display_name in resolved:
        out.append(
            GroupMemberResponse(
                user_id=uid,
                email=email,
                display_name=display_name,
                pending=uid in pending,
            )
        )
    return out


@router.post("/groups/{group_id}/members", response_model=GroupMemberResponse)
async def add_member(group_id: str, body: GroupMemberAdd, request: Request):
    require_admin(request)
    await _reject_if_entra(group_id)
    g = await repo_query(
        "SELECT id FROM $gid", {"gid": ensure_record_id(group_id)}
    )
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    u = await repo_query(
        "SELECT id, email, display_name FROM $uid",
        {"uid": ensure_record_id(body.user_id)},
    )
    if not u:
        raise HTTPException(
            status_code=404,
            detail="User not found (they must sign in at least once)",
        )
    existing = await repo_query(
        """
        SELECT id FROM user_group_member
        WHERE group_id = $gid AND user_id = $uid
        """,
        {
            "gid": ensure_record_id(group_id),
            "uid": ensure_record_id(body.user_id),
        },
    )
    if not existing:
        await repo_query(
            """
            CREATE user_group_member SET
              group_id = $gid,
              user_id = $uid
            """,
            {
                "gid": ensure_record_id(group_id),
                "uid": ensure_record_id(body.user_id),
            },
        )
    return GroupMemberResponse(
        user_id=str(u[0].get("id", "")),
        email=str(u[0].get("email", "")),
        display_name=str(u[0].get("display_name", "")),
    )


@router.delete("/groups/{group_id}/members/{user_id}")
async def remove_member(group_id: str, user_id: str, request: Request):
    require_admin(request)
    await _reject_if_entra(group_id)
    await repo_query(
        """
        DELETE user_group_member
        WHERE group_id = $gid AND user_id = $uid
        """,
        {
            "gid": ensure_record_id(group_id),
            "uid": ensure_record_id(user_id),
        },
    )
    return {"message": "Member removed"}


@router.get("/users", response_model=List[UserPickerItem])
async def list_users_for_picker(request: Request):
    """Local users for share/group pickers.

    Includes users that have never signed in — JIT-stubbed via directory
    picker (WBS 4.21) or Entra group sync — with `pending=true` so the UI
    can badge them. Pre-4.21 behavior (signed-in users only) is preserved
    for real users; stubs are additive.
    """
    require_user(request)
    rows = await repo_query(
        "SELECT id, email, display_name FROM user ORDER BY email ASC"
    )
    ids = [str(row.get("id", "")) for row in rows or [] if row.get("id")]
    pending = await _pending_user_ids(ids)
    return [
        UserPickerItem(
            id=str(row.get("id", "")),
            email=row.get("email", ""),
            display_name=row.get("display_name", ""),
            pending=str(row.get("id", "")) in pending,
        )
        for row in rows or []
    ]


# ---------------------------------------------------------------------------
# WBS 4.20 — Entra-linked groups (admin-only)
# ---------------------------------------------------------------------------


@router.get("/groups/entra/search", response_model=List[EntraGroupCandidate])
async def entra_group_search(request: Request, q: str = ""):
    """Typeahead against Microsoft Graph.

    Empty `q` returns the first 25 groups alphabetically so the picker
    isn't blank on open. Any non-empty query switches to $search.
    """
    require_admin(request)
    try:
        results = await search_groups(q)
    except GraphAPIError as exc:
        raise _graph_http_exception(exc) from exc
    return [EntraGroupCandidate(**row) for row in results]


@router.post("/groups/entra/link", response_model=GroupResponse)
async def entra_group_link(body: EntraLinkRequest, request: Request):
    """Idempotent upsert: link an Entra group into user_group + kick a scoped sync."""
    require_admin(request)
    try:
        snapshot = await graph_get_group(body.entra_group_oid)
    except GraphAPIError as exc:
        raise _graph_http_exception(exc) from exc

    existing = await repo_query(
        "SELECT id FROM user_group WHERE entra_group_oid = $oid",
        {"oid": body.entra_group_oid},
    )
    if existing:
        gid = str(existing[0]["id"])
    else:
        rows = await repo_query(
            """
            CREATE user_group SET
              name = $name,
              description = $desc,
              source = 'entra',
              entra_group_oid = $oid
            RETURN AFTER
            """,
            {
                "name": snapshot.get("display_name") or "Entra group",
                "desc": snapshot.get("description"),
                "oid": body.entra_group_oid,
            },
        ) or []
        if not rows:
            raise HTTPException(500, detail="Failed to link Entra group")
        gid = str(rows[0]["id"])

    # Kick a scoped sync so admins see members without waiting for the loop.
    await submit_command("open_notebook", "sync_entra_groups", {"group_id": gid})

    # Return the current group snapshot (with member_count).
    return await get_group(gid, request)


@router.post("/groups/entra/sync")
async def entra_group_sync_now(request: Request):
    """Admin-triggered full sync of every linked Entra group."""
    require_admin(request)
    _require_sync_enabled()
    command_id = await submit_command("open_notebook", "sync_entra_groups", {})
    return {"command_id": str(command_id)}


# ---------------------------------------------------------------------------
# WBS 4.21 — Tenant directory picker + JIT-stub user provisioning
# ---------------------------------------------------------------------------


@router.get("/users/directory", response_model=List[DirectoryUserCandidate])
async def directory_user_search(request: Request, q: str = ""):
    """Tenant-wide typeahead against Microsoft Graph.

    Any signed-in user may call this so owners can share with colleagues
    who have never opened the app. Empty `q` returns the first 25 users
    alphabetically so the picker isn't blank on open. Requires the Entra
    app registration to hold the tenant directory permission with admin
    consent.
    """
    require_user(request)
    try:
        results = await search_users(q)
    except GraphAPIError as exc:
        raise _graph_http_exception(exc) from exc
    return [DirectoryUserCandidate(**row) for row in results]


@router.post("/users/from-entra", response_model=UserPickerItem)
async def stub_user_from_entra(body: StubUserFromEntraRequest, request: Request):
    """Return (or create) a local `user` row for an Entra directory hit.

    Idempotent. Callable by any signed-in user because sharing with
    colleagues is not an admin-only capability. Forgery is prevented by
    validating the OID against Graph before insert — the request cannot
    supply an arbitrary email; whatever Graph returns is what we store.
    On first real login, `EntraOIDCProvider._upsert_user` finds this row
    by `entra_oid` and updates it in place (no duplicate).
    """
    caller = require_user(request)

    # 1. Fast path — already have a row for this OID.
    existing = await repo_query(
        "SELECT id, email, display_name FROM user WHERE entra_oid = $oid LIMIT 1",
        {"oid": body.entra_oid},
    )
    if existing:
        row = existing[0]
        uid = str(row.get("id", ""))
        pending = await _pending_user_ids([uid])
        return UserPickerItem(
            id=uid,
            email=row.get("email", ""),
            display_name=row.get("display_name", ""),
            pending=uid in pending,
        )

    # 2. Validate against Graph before writing anything.
    try:
        profile = await graph_get_user(body.entra_oid)
    except GraphAPIError as exc:
        # 404 → the client sent a bad OID; surface as 400 rather than 502.
        if exc.status_code == 404:
            raise HTTPException(400, detail="No such user in directory") from exc
        raise _graph_http_exception(exc) from exc

    email = profile.get("email") or ""
    display_name = profile.get("display_name") or email
    if not email:
        # Rare: guest with no mail and no UPN — refuse rather than write junk.
        raise HTTPException(400, detail="Directory user has no email address")

    # 3. Second fast path — a real user already exists by email but lacks
    #    entra_oid (e.g. hand-created row from a prior flow). Patch it.
    by_email = await repo_query(
        "SELECT id, email, display_name, entra_oid FROM user WHERE email = $email LIMIT 1",
        {"email": email},
    )
    if by_email:
        row = by_email[0]
        uid = str(row.get("id", ""))
        if not row.get("entra_oid"):
            await repo_query(
                "UPDATE $uid SET entra_oid = $oid",
                {"uid": ensure_record_id(uid), "oid": body.entra_oid},
            )
        pending = await _pending_user_ids([uid])
        return UserPickerItem(
            id=uid,
            email=row.get("email", ""),
            display_name=row.get("display_name", ""),
            pending=uid in pending,
        )

    # 4. Create the stub. `client_id` mirrors what EntraOIDCProvider stamps
    #    at login time (single-tenant Model A — see docs/TENANCY.md).
    client_id = getattr(caller, "client_id", None) or os.getenv("CLIENT_ID", "default")
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
                "oid": body.entra_oid,
                "client_id": client_id,
            },
        )
        or []
    )
    if not rows:
        raise HTTPException(500, detail="Failed to stub user")
    created = rows[0]
    return UserPickerItem(
        id=str(created.get("id", "")),
        email=created.get("email", ""),
        display_name=created.get("display_name", ""),
        pending=True,
    )
