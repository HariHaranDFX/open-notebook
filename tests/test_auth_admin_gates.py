from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.auth.deps import require_admin_if_auth
from api.auth.types import AuthenticatedUser
from api.routers import credentials, embedding_rebuild, models, settings


class EnabledAuthProvider:
    def auth_enabled(self) -> bool:
        return True


class DisabledAuthProvider:
    def auth_enabled(self) -> bool:
        return False


def admin_gate_client(monkeypatch) -> TestClient:
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory, "build_auth_provider", lambda: EnabledAuthProvider()
    )
    app = FastAPI()

    @app.middleware("http")
    async def add_regular_user(request: Request, call_next):
        request.state.user = AuthenticatedUser(
            id="user:1",
            email="user@example.com",
            display_name="User",
            role="user",
            entra_oid=None,
            client_id="client-1",
        )
        return await call_next(request)

    app.include_router(credentials.router, prefix="/api")
    app.include_router(models.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(embedding_rebuild.router, prefix="/api/embeddings")
    return TestClient(app)


def test_regular_user_cannot_create_credential(monkeypatch):
    response = admin_gate_client(monkeypatch).post(
        "/api/credentials",
        json={"name": "OpenAI", "provider": "openai", "api_key": "secret"},
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Admin required"}


def test_regular_user_cannot_access_sensitive_routers(monkeypatch):
    client = admin_gate_client(monkeypatch)

    for method, path in [
        ("get", "/api/credentials"),
        ("post", "/api/models"),
        ("get", "/api/settings"),
        ("get", "/api/embeddings/rebuild/command:1/status"),
    ]:
        assert getattr(client, method)(path).status_code == 403


def test_open_auth_mode_does_not_require_admin(monkeypatch):
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory, "build_auth_provider", lambda: DisabledAuthProvider()
    )
    request = Request({"type": "http", "method": "GET", "path": "/api/settings"})

    assert require_admin_if_auth(request) is None
