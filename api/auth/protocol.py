from typing import Optional, Protocol

from fastapi import Request
from starlette.responses import Response

from api.auth.types import AuthenticatedUser


class AuthProvider(Protocol):
    name: str

    def auth_enabled(self) -> bool: ...

    async def authenticate_request(
        self, request: Request
    ) -> Optional[AuthenticatedUser]: ...

    async def begin_login(self, request: Request) -> Response: ...

    async def handle_callback(self, request: Request) -> Response: ...

    async def logout(self, request: Request) -> Response: ...
