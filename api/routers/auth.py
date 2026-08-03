"""
Authentication router for Open Notebook API.
Provides authentication status and session endpoints.
"""

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from api.auth.deps import require_user
from api.auth.factory import build_auth_provider
from api.auth.types import AuthenticatedUser

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status")
async def get_auth_status():
    """
    Check if authentication is enabled.
    Returns the configured provider and whether it requires authentication.
    """
    provider = build_auth_provider()

    return {
        "auth_enabled": provider.auth_enabled(),
        "provider": provider.name if provider.name in {"password", "entra"} else "password",
    }


@router.get("/me")
async def get_current_user(
    user: AuthenticatedUser = Depends(require_user),
) -> AuthenticatedUser:
    return user


@router.post("/logout", status_code=204)
async def logout(
    request: Request, _: AuthenticatedUser = Depends(require_user)
) -> Response:
    return await build_auth_provider().logout(request)


@router.get("/login")
async def login(request: Request) -> Response:
    return await build_auth_provider().begin_login(request)


@router.get("/callback")
async def callback(request: Request) -> Response:
    return await build_auth_provider().handle_callback(request)