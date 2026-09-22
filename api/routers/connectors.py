"""Authenticated routes for delegated external content connections."""

from fastapi import APIRouter, Depends, Request
from starlette.responses import RedirectResponse

from api.auth.deps import current_user_optional, require_user
from api.auth.types import AuthenticatedUser
from open_notebook.connectors import sharepoint_auth

router = APIRouter(prefix="/connectors/sharepoint")


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
