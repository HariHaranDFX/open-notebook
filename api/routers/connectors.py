"""Authenticated routes for delegated external content connections."""

from fastapi import APIRouter, Depends, Request
from starlette.responses import JSONResponse, RedirectResponse

from api.auth.deps import current_user_optional, require_user
from api.auth.types import AuthenticatedUser
from open_notebook.connectors import sharepoint_auth
from open_notebook.connectors.sharepoint import SharePointConnector

router = APIRouter(prefix="/connectors/sharepoint")


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
    return await SharePointConnector(user.id).list_sites(query)


@router.get("/sites/{site_id}/drives")
async def list_sharepoint_drives(
    site_id: str, user: AuthenticatedUser = Depends(require_user)
):
    if not await _connected(user.id):
        return _not_connected()
    return await SharePointConnector(user.id).list_drives(site_id)


@router.get("/drives/{drive_id}/children")
async def list_sharepoint_children(
    drive_id: str,
    item_id: str | None = None,
    user: AuthenticatedUser = Depends(require_user),
):
    if not await _connected(user.id):
        return _not_connected()
    return await SharePointConnector(user.id).list_children(drive_id, item_id)
