"""Placeholder OIDC provider for future non-Entra integrations."""

from typing import Optional

from fastapi import Request
from starlette.responses import JSONResponse, Response

from api.auth.types import AuthenticatedUser


class GenericOIDCProvider:
    """Protocol-compatible placeholder; it is not selectable yet."""

    name = "generic_oidc"

    def auth_enabled(self) -> bool:
        return False

    async def authenticate_request(
        self, request: Request
    ) -> Optional[AuthenticatedUser]:
        return None

    async def begin_login(self, request: Request) -> Response:
        return JSONResponse(status_code=501, content={"detail": "Not implemented"})

    async def handle_callback(self, request: Request) -> Response:
        return JSONResponse(status_code=501, content={"detail": "Not implemented"})

    async def logout(self, request: Request) -> Response:
        return JSONResponse(status_code=501, content={"detail": "Not implemented"})
