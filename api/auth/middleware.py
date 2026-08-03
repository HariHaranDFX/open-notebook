from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from api.auth.factory import build_auth_provider
from api.auth.protocol import AuthProvider


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: ASGIApp,
        excluded_paths: Optional[list[str]] = None,
        provider: Optional[AuthProvider] = None,
    ) -> None:
        super().__init__(app)
        self.provider = provider or build_auth_provider()
        self.excluded_paths = excluded_paths or [
            "/",
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc",
        ]

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.url.path in self.excluded_paths or request.method == "OPTIONS":
            return await call_next(request)

        user = await self.provider.authenticate_request(request)
        if self.provider.auth_enabled() and user is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Unauthorized"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        request.state.user = user
        return await call_next(request)
