import pytest
from fastapi import FastAPI
from starlette.requests import Request
from starlette.testclient import TestClient

from api.auth.middleware import AuthMiddleware
from api.auth.password import PasswordAuthProvider
from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import AuthenticationError


def make_request_with_auth(authorization: str | None = None) -> Request:
    headers = [(b"authorization", authorization.encode())] if authorization else []
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/x",
            "headers": headers,
        }
    )


def make_password_protected_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(AuthMiddleware, provider=PasswordAuthProvider())

    @app.get("/protected")
    async def protected() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/protected")
    async def write_protected() -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app)


@pytest.mark.parametrize(
    ("authorization", "detail"),
    [
        (None, "Missing authorization header"),
        ("Basic secret", "Invalid authorization header format"),
        ("Bearer wrong", "Invalid password"),
    ],
)
def test_password_middleware_preserves_auth_failure_details(
    monkeypatch, authorization: str | None, detail: str
):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")

    response = make_password_protected_client().get(
        "/protected",
        headers={} if authorization is None else {"Authorization": authorization},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": detail}
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_password_bearer_write_skips_csrf_without_session_cookie(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")

    response = make_password_protected_client().post(
        "/protected", headers={"Authorization": "Bearer secret"}
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.asyncio
async def test_password_provider_accepts_matching_bearer(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")
    provider = PasswordAuthProvider()

    user = await provider.authenticate_request(make_request_with_auth("Bearer secret"))

    assert user == AuthenticatedUser(
        id="user:password_local",
        email="local@dev",
        display_name="Local Admin",
        role="admin",
        entra_oid=None,
        client_id="local",
    )
    assert provider.auth_enabled() is True


@pytest.mark.asyncio
async def test_password_provider_reports_bad_password(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")
    provider = PasswordAuthProvider()

    with pytest.raises(AuthenticationError, match="Invalid password"):
        await provider.authenticate_request(make_request_with_auth("Bearer wrong"))


@pytest.mark.asyncio
async def test_password_provider_disables_auth_when_password_is_unset(monkeypatch):
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD", raising=False)
    provider = PasswordAuthProvider()

    assert provider.auth_enabled() is False
    assert await provider.authenticate_request(make_request_with_auth()) is None
