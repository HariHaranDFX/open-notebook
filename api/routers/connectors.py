"""Authenticated routes for delegated external content connections."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.responses import JSONResponse, RedirectResponse

from api.auth.deps import current_user_optional, require_user
from api.auth.types import AuthenticatedUser
from api.command_service import CommandService
from api.ownership import assert_can_edit_notebook_or_403
from open_notebook.connectors import sharepoint_auth
from open_notebook.connectors.models import ConnectorBatch, ConnectorBatchDocument
from open_notebook.connectors.sharepoint import SharePointConnector
from open_notebook.domain.notebook import Notebook
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import AuthenticationError, NotFoundError

router = APIRouter(prefix="/connectors/sharepoint")


class SharePointImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    drive_id: str = Field(min_length=1, max_length=1024)
    item_ids: list[str] = Field(default_factory=list, max_length=1000)
    folder_id: str | None = Field(default=None, min_length=1, max_length=1024)
    notebook_ids: list[str] = Field(default_factory=list, max_length=100)
    transformations: list[str] = Field(default_factory=list, max_length=100)
    embed: bool = True

    @model_validator(mode="after")
    def selection(self):
        if bool(self.item_ids) == (self.folder_id is not None):
            raise ValueError("Select file IDs or one folder")
        if any(not item or len(item) > 1024 for item in self.item_ids):
            raise ValueError("Invalid file ID")
        self.item_ids = list(dict.fromkeys(self.item_ids))
        self.notebook_ids = list(dict.fromkeys(self.notebook_ids))
        return self


@router.post("/import", status_code=202)
async def import_sharepoint(
    data: SharePointImportRequest, request: Request,
    user: AuthenticatedUser = Depends(require_user),
):
    connection = await sharepoint_auth.get_connection(user.id)
    if not connection or connection.status != "connected":
        return _not_connected()
    for notebook_id in data.notebook_ids:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise NotFoundError("Notebook not found")
        await assert_can_edit_notebook_or_403(notebook.user_id, notebook_id, request, "Notebook not found")
    for transformation_id in data.transformations:
        await Transformation.get(transformation_id)
    batch = ConnectorBatch(user_id=user.id, connection_id=connection.id, **data.model_dump())
    await batch.save()
    batch.command_id = await CommandService.submit_command_job(
        "open_notebook", "import_sharepoint_batch", {"batch_id": batch.id, "user_id": user.id}
    )
    await batch.save()
    return {"batch_id": batch.id}


@router.get("/batches/{batch_id}")
async def get_sharepoint_batch(batch_id: str, user: AuthenticatedUser = Depends(require_user)):
    batch = await ConnectorBatch.get_for_user(batch_id, user.id)
    documents = await ConnectorBatchDocument.for_batch(batch_id, user.id)
    return {
        "batch_id": batch.id, "status": batch.status, "total": batch.total,
        "completed": batch.completed, "failed": batch.failed, "error": batch.error,
        "documents": [document.model_dump(include={"id", "item_id", "name", "source_id", "command_id", "status", "error"}) for document in documents],
    }


async def _connected(user_id: str) -> bool:
    connection = await sharepoint_auth.get_connection(user_id)
    return bool(connection and connection.status == "connected")


def _not_connected() -> JSONResponse:
    return JSONResponse(
        {"detail": "SharePoint is not connected. Connect SharePoint again."},
        status_code=409,
    )


@router.get("/status")
async def sharepoint_status(
    user: AuthenticatedUser | None = Depends(current_user_optional),
):
    return await sharepoint_auth.connection_status(user.id if user else None)


@router.post("/connect")
async def connect_sharepoint(user: AuthenticatedUser = Depends(require_user)):
    return {"authorization_url": await sharepoint_auth.begin_connection(user.id)}


@router.get("/callback")
async def sharepoint_callback(
    request: Request, user: AuthenticatedUser = Depends(require_user)
):
    await sharepoint_auth.complete_connection(
        user.id,
        request.query_params.get("state"),
        request.query_params.get("code"),
        request.query_params.get("error"),
    )
    return RedirectResponse("/", status_code=302)


@router.get("/sites")
async def list_sharepoint_sites(
    query: str = "", user: AuthenticatedUser = Depends(require_user)
):
    if not await _connected(user.id):
        return _not_connected()
    try:
        return await SharePointConnector(user.id).list_sites(query)
    except AuthenticationError:
        return _not_connected()


@router.get("/sites/{site_id}/drives")
async def list_sharepoint_drives(
    site_id: str, user: AuthenticatedUser = Depends(require_user)
):
    if not await _connected(user.id):
        return _not_connected()
    try:
        return await SharePointConnector(user.id).list_drives(site_id)
    except AuthenticationError:
        return _not_connected()


@router.get("/drives/{drive_id}/children")
async def list_sharepoint_children(
    drive_id: str,
    item_id: str | None = None,
    user: AuthenticatedUser = Depends(require_user),
):
    if not await _connected(user.id):
        return _not_connected()
    try:
        return await SharePointConnector(user.id).list_children(drive_id, item_id)
    except AuthenticationError:
        return _not_connected()
