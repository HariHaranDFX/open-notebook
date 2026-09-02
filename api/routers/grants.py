"""Resource grant CRUD for notebooks and sources (WP2b)."""

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.ownership import assert_can_manage_acl
from api.ownership import canonical_id as _canonical_id
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import NotFoundError

router = APIRouter()

PrincipalType = Literal["user", "group"]
GrantRole = Literal["viewer", "editor"]
ResourceType = Literal["notebook", "source"]


class GrantCreate(BaseModel):
    principal_type: PrincipalType
    principal_id: str
    role: GrantRole = "viewer"


class GrantUpdate(BaseModel):
    role: GrantRole


class GrantResponse(BaseModel):
    id: str
    resource_type: ResourceType
    resource_id: str
    principal_type: PrincipalType
    principal_id: str
    role: GrantRole
    granted_by: Optional[str] = None
    principal_label: Optional[str] = None


def _row_to_grant(row: dict) -> GrantResponse:
    return GrantResponse(
        id=str(row.get("id", "")),
        resource_type=row.get("resource_type"),
        resource_id=str(row.get("resource_id", "")),
        principal_type=row.get("principal_type"),
        principal_id=str(row.get("principal_id", "")),
        role=row.get("role"),
        granted_by=str(row["granted_by"]) if row.get("granted_by") else None,
        principal_label=row.get("principal_label"),
    )


async def _principal_label(principal_type: str, principal_id: str) -> str:
    if principal_type == "user":
        rows = await repo_query(
            "SELECT email, display_name FROM $id",
            {"id": ensure_record_id(principal_id)},
        )
        if rows:
            return str(rows[0].get("email") or rows[0].get("display_name") or principal_id)
    else:
        rows = await repo_query(
            "SELECT name FROM $id",
            {"id": ensure_record_id(principal_id)},
        )
        if rows:
            return str(rows[0].get("name") or principal_id)
    return principal_id


async def _validate_principal(principal_type: str, principal_id: str) -> None:
    if principal_type == "user":
        rows = await repo_query(
            "SELECT id FROM $id", {"id": ensure_record_id(principal_id)}
        )
        if not rows:
            raise HTTPException(
                status_code=404,
                detail="User not found (they must sign in at least once)",
            )
    else:
        rows = await repo_query(
            "SELECT id FROM $id", {"id": ensure_record_id(principal_id)}
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Group not found")


async def _list_grants(resource_type: ResourceType, resource_id: str) -> List[GrantResponse]:
    rid = _canonical_id(resource_id)
    rows = await repo_query(
        """
        SELECT * FROM resource_grant
        WHERE resource_type = $rtype AND resource_id = $rid
        ORDER BY created ASC
        """,
        {"rtype": resource_type, "rid": rid},
    )
    out: list[GrantResponse] = []
    for row in rows or []:
        g = _row_to_grant(row)
        g.principal_label = await _principal_label(g.principal_type, g.principal_id)
        out.append(g)
    return out


async def _create_grant(
    request: Request,
    resource_type: ResourceType,
    resource_id: str,
    body: GrantCreate,
    owner_user_id: Optional[str],
) -> GrantResponse:
    assert_can_manage_acl(owner_user_id, request)
    await _validate_principal(body.principal_type, body.principal_id)
    rid = _canonical_id(resource_id)
    pid = _canonical_id(body.principal_id)
    user = getattr(request.state, "user", None)
    existing = await repo_query(
        """
        SELECT * FROM resource_grant
        WHERE resource_type = $rtype AND resource_id = $rid
          AND principal_type = $ptype AND principal_id = $pid
        """,
        {
            "rtype": resource_type,
            "rid": rid,
            "ptype": body.principal_type,
            "pid": pid,
        },
    )
    if existing:
        await repo_query(
            "UPDATE $id SET role = $role",
            {"id": ensure_record_id(str(existing[0]["id"])), "role": body.role},
        )
        rows = await repo_query(
            "SELECT * FROM $id",
            {"id": ensure_record_id(str(existing[0]["id"]))},
        )
    else:
        rows = await repo_query(
            """
            CREATE resource_grant SET
              resource_type = $rtype,
              resource_id = $rid,
              principal_type = $ptype,
              principal_id = $pid,
              role = $role,
              granted_by = $by
            RETURN AFTER
            """,
            {
                "rtype": resource_type,
                "rid": rid,
                "ptype": body.principal_type,
                "pid": pid,
                "role": body.role,
                "by": ensure_record_id(user.id) if user else None,
            },
        )
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create grant")
    g = _row_to_grant(rows[0])
    g.principal_label = await _principal_label(g.principal_type, g.principal_id)
    return g


async def _update_grant(
    request: Request,
    resource_type: ResourceType,
    resource_id: str,
    grant_id: str,
    body: GrantUpdate,
    owner_user_id: Optional[str],
) -> GrantResponse:
    assert_can_manage_acl(owner_user_id, request)
    rows = await repo_query(
        "SELECT * FROM $id",
        {"id": ensure_record_id(grant_id)},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Grant not found")
    row = rows[0]
    if row.get("resource_type") != resource_type or _canonical_id(
        str(row.get("resource_id", ""))
    ) != _canonical_id(resource_id):
        raise HTTPException(status_code=404, detail="Grant not found")
    await repo_query(
        "UPDATE $id SET role = $role",
        {"id": ensure_record_id(grant_id), "role": body.role},
    )
    rows = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(grant_id)})
    g = _row_to_grant(rows[0])
    g.principal_label = await _principal_label(g.principal_type, g.principal_id)
    return g


async def _delete_grant(
    request: Request,
    resource_type: ResourceType,
    resource_id: str,
    grant_id: str,
    owner_user_id: Optional[str],
) -> dict:
    assert_can_manage_acl(owner_user_id, request)
    rows = await repo_query(
        "SELECT * FROM $id",
        {"id": ensure_record_id(grant_id)},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Grant not found")
    row = rows[0]
    if row.get("resource_type") != resource_type or _canonical_id(
        str(row.get("resource_id", ""))
    ) != _canonical_id(resource_id):
        raise HTTPException(status_code=404, detail="Grant not found")
    await repo_query("DELETE $id", {"id": ensure_record_id(grant_id)})
    return {"message": "Grant removed"}


@router.get("/notebooks/{notebook_id}/grants", response_model=List[GrantResponse])
async def list_notebook_grants(notebook_id: str, request: Request):
    try:
        notebook = await Notebook.get(notebook_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    assert_can_manage_acl(notebook.user_id, request)
    return await _list_grants("notebook", notebook_id)


@router.post("/notebooks/{notebook_id}/grants", response_model=GrantResponse)
async def create_notebook_grant(
    notebook_id: str, body: GrantCreate, request: Request
):
    try:
        notebook = await Notebook.get(notebook_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return await _create_grant(
        request, "notebook", notebook_id, body, notebook.user_id
    )


@router.patch(
    "/notebooks/{notebook_id}/grants/{grant_id}", response_model=GrantResponse
)
async def update_notebook_grant(
    notebook_id: str, grant_id: str, body: GrantUpdate, request: Request
):
    try:
        notebook = await Notebook.get(notebook_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return await _update_grant(
        request, "notebook", notebook_id, grant_id, body, notebook.user_id
    )


@router.delete("/notebooks/{notebook_id}/grants/{grant_id}")
async def delete_notebook_grant(
    notebook_id: str, grant_id: str, request: Request
):
    try:
        notebook = await Notebook.get(notebook_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return await _delete_grant(
        request, "notebook", notebook_id, grant_id, notebook.user_id
    )


@router.get("/sources/{source_id}/grants", response_model=List[GrantResponse])
async def list_source_grants(source_id: str, request: Request):
    try:
        source = await Source.get(source_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    assert_can_manage_acl(source.user_id, request)
    return await _list_grants("source", source_id)


@router.post("/sources/{source_id}/grants", response_model=GrantResponse)
async def create_source_grant(source_id: str, body: GrantCreate, request: Request):
    try:
        source = await Source.get(source_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    return await _create_grant(request, "source", source_id, body, source.user_id)


@router.patch("/sources/{source_id}/grants/{grant_id}", response_model=GrantResponse)
async def update_source_grant(
    source_id: str, grant_id: str, body: GrantUpdate, request: Request
):
    try:
        source = await Source.get(source_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    return await _update_grant(
        request, "source", source_id, grant_id, body, source.user_id
    )


@router.delete("/sources/{source_id}/grants/{grant_id}")
async def delete_source_grant(source_id: str, grant_id: str, request: Request):
    try:
        source = await Source.get(source_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    return await _delete_grant(
        request, "source", source_id, grant_id, source.user_id
    )
