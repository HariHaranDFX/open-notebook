import os
import secrets
from typing import Optional

from fastapi import Request
from starlette.responses import JSONResponse, Response

from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import AuthenticationError
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
        if not self.password:
            return None

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            raise AuthenticationError("Missing authorization header")

        try:
            scheme, credentials = auth_header.split(" ", 1)
            if scheme.lower() != "bearer":
                raise ValueError
        except ValueError:
            raise AuthenticationError("Invalid authorization header format")

        # HTTP header parsing (starlette) decodes bytes as latin-1, so a UTF-8
        # non-ASCII password comes through with each byte mapped to its own
        # codepoint. Re-encode the header string as latin-1 to recover the
        # original wire bytes; the env-var password stays UTF-8. See #1344.
        if not secrets.compare_digest(
            credentials.encode("latin-1"), self.password.encode("utf-8")
        ):
            raise AuthenticationError("Invalid password")

        return AuthenticatedUser(
            # Underscore (not hyphen): SurrealDB stringifies hyphenated
            # record ids as user:⟨…⟩, which used to break ownership compares
            # and corrupt user_id on Source.save() round-trips.
            id="user:password_local",
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
        response = Response(status_code=204)
        response.delete_cookie("on_session")
        return response
