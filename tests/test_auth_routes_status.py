from fastapi import FastAPI
from starlette.responses import Response
from starlette.testclient import TestClient

from api.auth.middleware import AuthMiddleware
from api.auth.types import AuthenticatedUser
from api.routers import auth


class StubProvider:
    name = "password"

    def auth_enabled(self) -> bool:
        return True

    async def authenticate_request(self, request):
        return AuthenticatedUser(
            id="user:1",
            email="user@example.com",
            display_name="Test User",
            role="user",
            entra_oid=None,
            client_id="client:1",
        )

    async def begin_login(self, request) -> Response:
        return Response(status_code=501)

    async def handle_callback(self, request) -> Response:
        return Response(status_code=501)

    async def logout(self, request) -> Response:
        response = Response(status_code=204)
        response.delete_cookie("on_session")
        return response


def make_client(monkeypatch) -> TestClient:
    provider = StubProvider()
    monkeypatch.setattr(auth, "build_auth_provider", lambda: provider)
    app = FastAPI()
    app.add_middleware(
        AuthMiddleware,
        provider=provider,
        excluded_paths=["/api/auth/status", "/api/auth/login", "/api/auth/callback"],
    )
    app.include_router(auth.router, prefix="/api")
    return TestClient(app)


def test_auth_status_returns_enabled_provider(monkeypatch):
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD", raising=False)
    monkeypatch.setenv("AUTH_PROVIDER", "unknown")

    response = make_client(monkeypatch).get("/api/auth/status")

    assert response.status_code == 200
    assert response.json() == {"auth_enabled": True, "provider": "password"}


def test_me_returns_authenticated_user(monkeypatch):
    response = make_client(monkeypatch).get("/api/auth/me")

    assert response.status_code == 200
    assert response.json() == {
        "id": "user:1",
        "email": "user@example.com",
        "display_name": "Test User",
        "role": "user",
        "entra_oid": None,
        "client_id": "client:1",
    }


def test_me_rejects_anonymous_user(monkeypatch):
    provider = StubProvider()

    async def authenticate_anonymous(request):
        return None

    monkeypatch.setattr(provider, "authenticate_request", authenticate_anonymous)
    monkeypatch.setattr(auth, "build_auth_provider", lambda: provider)
    app = FastAPI()
    app.add_middleware(AuthMiddleware, provider=provider)
    app.include_router(auth.router, prefix="/api")

    response = TestClient(app).get("/api/auth/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_logout_delegates_to_provider_and_clears_cookie(monkeypatch):
    response = make_client(monkeypatch).post("/api/auth/logout")

    assert response.status_code == 204
    assert "on_session=" in response.headers["set-cookie"]


def test_cookie_logout_requires_origin(monkeypatch):
    response = make_client(monkeypatch).post(
        "/api/auth/logout", cookies={"on_session": "session-token"}
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "CSRF origin check failed"}


def test_login_and_callback_are_not_authenticated(monkeypatch):
    client = make_client(monkeypatch)

    assert client.get("/api/auth/login").status_code == 501
    assert client.get("/api/auth/callback").status_code == 501


def test_mutating_request_rejects_disallowed_origin(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://notebook.example.com")

    response = make_client(monkeypatch).post(
        "/api/auth/logout",
        headers={"Origin": "https://evil.example.com"},
        cookies={"on_session": "session-token"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "CSRF origin check failed"}


def test_mutating_request_allows_configured_origin(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://notebook.example.com")

    response = make_client(monkeypatch).post(
        "/api/auth/logout",
        headers={"Origin": "https://notebook.example.com"},
        cookies={"on_session": "session-token"},
    )

    assert response.status_code == 204


def test_entra_write_requires_origin_without_cookie(monkeypatch):
    monkeypatch.setenv("AUTH_PROVIDER", "entra")

    response = make_client(monkeypatch).post("/api/auth/logout")

    assert response.status_code == 403
    assert response.json() == {"detail": "CSRF origin check failed"}


def test_mutating_request_allows_same_host_referer(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    response = make_client(monkeypatch).post(
        "/api/auth/logout", headers={"Referer": "http://testserver/page"}
    )

    assert response.status_code == 204
