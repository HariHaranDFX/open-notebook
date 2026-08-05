"""App-local user groups (WP2b). Admin-only; Entra sync later."""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from api.auth.deps import require_admin, require_user
from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()


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


class GroupResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    source: str = "local"
    entra_group_oid: Optional[str] = None
    member_count: int = 0


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
        out.append(
            GroupMemberResponse(
                user_id=uid,
                email=str(email or ""),
                display_name=str(display_name or ""),
            )
        )
    return out


@router.post("/groups/{group_id}/members", response_model=GroupMemberResponse)
async def add_member(group_id: str, body: GroupMemberAdd, request: Request):
    require_admin(request)
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


@router.get("/users")
async def list_users_for_picker(request: Request):
    """Users who have signed in at least once (share/group picker)."""
    require_user(request)
    rows = await repo_query(
        "SELECT id, email, display_name FROM user ORDER BY email ASC"
    )
    return [
        {
            "id": str(row.get("id", "")),
            "email": row.get("email", ""),
            "display_name": row.get("display_name", ""),
        }
        for row in rows or []
    ]
