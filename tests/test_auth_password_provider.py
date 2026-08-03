import pytest
from starlette.requests import Request

from api.auth.password import PasswordAuthProvider
from api.auth.types import AuthenticatedUser


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


@pytest.mark.asyncio
async def test_password_provider_accepts_matching_bearer(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")
    provider = PasswordAuthProvider()

    user = await provider.authenticate_request(make_request_with_auth("Bearer secret"))

    assert user == AuthenticatedUser(
        id="user:password-local",
        email="local@dev",
        display_name="Local Admin",
        role="admin",
        entra_oid=None,
        client_id="local",
    )
    assert provider.auth_enabled() is True


@pytest.mark.asyncio
async def test_password_provider_rejects_bad_password(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")
    provider = PasswordAuthProvider()

    user = await provider.authenticate_request(make_request_with_auth("Bearer wrong"))

    assert user is None


@pytest.mark.asyncio
async def test_password_provider_disables_auth_when_password_is_unset(monkeypatch):
    monkeypatch.delenv("OPEN_NOTEBOOK_PASSWORD", raising=False)
    provider = PasswordAuthProvider()

    assert provider.auth_enabled() is False
    assert await provider.authenticate_request(make_request_with_auth()) is None
