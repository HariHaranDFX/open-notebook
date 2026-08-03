import os
import secrets
from typing import Optional

from fastapi import Request
from starlette.responses import JSONResponse, Response

from api.auth.types import AuthenticatedUser
from open_notebook.utils.encryption import get_secret_from_env


class PasswordAuthProvider:
    name = "password"

    def __init__(self) -> None:
        self.password = get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")

    def auth_enabled(self) -> bool:
        return bool(self.password)

    async def authenticate_request(
        self, request: Request
    ) -> Optional[AuthenticatedUser]:
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return None

        try:
            scheme, credentials = auth_header.split(" ", 1)
            if scheme.lower() != "bearer":
                return None
        except ValueError:
            return None

        if not self.password or not secrets.compare_digest(
            credentials.encode("utf-8"), self.password.encode("utf-8")
        ):
            return None

        return AuthenticatedUser(
            id="user:password-local",
            email="local@dev",
            display_name="Local Admin",
            role="admin",
            entra_oid=None,
            client_id=os.getenv("CLIENT_ID", "local"),
        )

    async def begin_login(self, request: Request) -> Response:
        return JSONResponse(status_code=400, content={"detail": "Not supported"})

    async def handle_callback(self, request: Request) -> Response:
        return JSONResponse(status_code=400, content={"detail": "Not supported"})

    async def logout(self, request: Request) -> Response:
        return JSONResponse(status_code=400, content={"detail": "Not supported"})
