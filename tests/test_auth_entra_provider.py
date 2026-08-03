from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.requests import Request

from api.auth import entra as entra_module
from api.auth.entra import EntraOIDCProvider
from api.auth.session import SESSION_COOKIE_NAME
from open_notebook.exceptions import AuthenticationError

ENTRA_ENV = {
    "ENTRA_TENANT_ID": "tenant-1",
    "ENTRA_CLIENT_ID": "client-1",
    "ENTRA_CLIENT_SECRET": "secret-1",
    "ENTRA_REDIRECT_URI": "https://app.example.com/api/auth/callback",
    "AUTH_ADMIN_EMAILS": "admin@example.com",
}


@pytest.fixture(autouse=True)
def entra_env(monkeypatch):
    for key, value in ENTRA_ENV.items():
        monkeypatch.setenv(key, value)


def make_request(
    *, query_string: bytes = b"", cookies: dict[str, str] | None = None
) -> Request:
    headers = [(b"host", b"app.example.com")]
    if cookies:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())
        headers.append((b"cookie", cookie_header.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/auth/callback",
            "query_string": query_string,
            "headers": headers,
            "scheme": "https",
        }
    )


@pytest.mark.asyncio
async def test_begin_login_redirects_to_authorize_endpoint_with_pkce():
    provider = EntraOIDCProvider()

    response = await provider.begin_login(make_request())

    assert response.status_code == 302
    location = urlparse(response.headers["location"])
    assert location.hostname == "login.microsoftonline.com"
    assert location.path == "/tenant-1/oauth2/v2.0/authorize"
    params = parse_qs(location.query)
    assert params["client_id"] == ["client-1"]
    assert params["redirect_uri"] == ["https://app.example.com/api/auth/callback"]
    assert params["code_challenge_method"] == ["S256"]
    assert "code_challenge" in params
    assert "state" in params

    set_cookie = response.headers["set-cookie"]
    assert "on_oauth=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()
    assert "secure" in set_cookie.lower()


@pytest.mark.asyncio
async def test_handle_callback_rejects_state_mismatch():
    provider = EntraOIDCProvider()
    request = make_request(
        query_string=b"code=abc&state=wrong-state",
        cookies={"on_oauth": "expected-state.verifier-value"},
    )

    with pytest.raises(AuthenticationError, match="state mismatch"):
        await provider.handle_callback(request)


@pytest.mark.asyncio
async def test_handle_callback_rejects_missing_oauth_cookie():
    provider = EntraOIDCProvider()
    request = make_request(query_string=b"code=abc&state=some-state")

    with pytest.raises(AuthenticationError, match="Missing or expired"):
        await provider.handle_callback(request)


@pytest.mark.asyncio
async def test_handle_callback_surfaces_entra_error_param():
    provider = EntraOIDCProvider()
    request = make_request(query_string=b"error=access_denied&error_description=nope")

    with pytest.raises(AuthenticationError, match="nope"):
        await provider.handle_callback(request)


@pytest.mark.asyncio
async def test_handle_callback_jit_creates_admin_user_and_sets_session_cookie(
    monkeypatch,
):
    provider = EntraOIDCProvider()
    request = make_request(
        query_string=b"code=abc&state=expected-state",
        cookies={"on_oauth": "expected-state.verifier-value"},
    )

    exchange = AsyncMock(
        return_value={"id_token": "id-token-value", "refresh_token": None}
    )
    monkeypatch.setattr(provider, "_exchange_code", exchange)

    validate = AsyncMock(
        return_value={
            "oid": "entra-oid-1",
            "email": "admin@example.com",
            "name": "Admin User",
        }
    )
    monkeypatch.setattr(entra_module, "validate_id_token", validate)

    repo_query = AsyncMock(return_value=[])  # no existing user
    monkeypatch.setattr(entra_module, "repo_query", repo_query)

    repo_create = AsyncMock(
        return_value={
            "id": "user:new-1",
            "email": "admin@example.com",
            "display_name": "Admin User",
            "entra_oid": "entra-oid-1",
            "role": "admin",
            "client_id": "default",
        }
    )
    monkeypatch.setattr("open_notebook.domain.base.repo_create", repo_create)

    create_session = AsyncMock(return_value="raw-session-cookie")
    monkeypatch.setattr(entra_module, "create_session", create_session)

    response = await provider.handle_callback(request)

    assert response.status_code == 302
    assert response.headers["location"] == "/"
    exchange.assert_awaited_once_with("abc", "verifier-value")
    validate.assert_awaited_once_with(
        "id-token-value", tenant_id="tenant-1", client_id="client-1"
    )
    create_session.assert_awaited_once_with("user:new-1", None)

    set_cookie_headers = response.headers.getlist("set-cookie")
    session_cookie = next(c for c in set_cookie_headers if c.startswith("on_session="))
    assert "raw-session-cookie" in session_cookie
    assert "HttpOnly" in session_cookie
    oauth_clear_cookie = next(c for c in set_cookie_headers if c.startswith("on_oauth="))
    assert 'on_oauth=""' in oauth_clear_cookie or "on_oauth=;" in oauth_clear_cookie

    # role came from the allowlist, not from a client-controlled claim
    created_data = repo_create.await_args.args[1]
    assert created_data["role"] == "admin"
    assert created_data["entra_oid"] == "entra-oid-1"


@pytest.mark.asyncio
async def test_handle_callback_updates_existing_user_by_entra_oid(monkeypatch):
    provider = EntraOIDCProvider()
    request = make_request(
        query_string=b"code=abc&state=expected-state",
        cookies={"on_oauth": "expected-state.verifier-value"},
    )
    monkeypatch.setattr(
        provider,
        "_exchange_code",
        AsyncMock(return_value={"id_token": "id-token-value"}),
    )
    monkeypatch.setattr(
        entra_module,
        "validate_id_token",
        AsyncMock(
            return_value={
                "oid": "entra-oid-1",
                "email": "user@example.com",
                "name": "Regular User",
            }
        ),
    )
    monkeypatch.setattr(
        entra_module, "repo_query", AsyncMock(return_value=[{"id": "user:existing-1"}])
    )
    repo_update = AsyncMock(
        return_value={
            "id": "user:existing-1",
            "email": "user@example.com",
            "display_name": "Regular User",
            "entra_oid": "entra-oid-1",
            "role": "user",
            "client_id": "default",
        }
    )
    monkeypatch.setattr("open_notebook.domain.base.repo_update", repo_update)
    monkeypatch.setattr(
        entra_module, "create_session", AsyncMock(return_value="raw-session-cookie")
    )

    await provider.handle_callback(request)

    table, record_id, _data = repo_update.await_args.args
    assert record_id == "user:existing-1"


@pytest.mark.asyncio
async def test_authenticate_request_resolves_session_cookie(monkeypatch):
    provider = EntraOIDCProvider()
    resolved = object()
    monkeypatch.setattr(
        entra_module, "resolve_session", AsyncMock(return_value=resolved)
    )

    result = await provider.authenticate_request(
        make_request(cookies={SESSION_COOKIE_NAME: "raw-cookie"})
    )

    assert result is resolved


@pytest.mark.asyncio
async def test_authenticate_request_returns_none_without_cookie():
    provider = EntraOIDCProvider()

    assert await provider.authenticate_request(make_request()) is None


@pytest.mark.asyncio
async def test_logout_deletes_session_and_clears_cookie(monkeypatch):
    provider = EntraOIDCProvider()
    delete_session = AsyncMock()
    monkeypatch.setattr(entra_module, "delete_session", delete_session)

    response = await provider.logout(
        make_request(cookies={SESSION_COOKIE_NAME: "raw-cookie"})
    )

    assert response.status_code == 204
    delete_session.assert_awaited_once_with("raw-cookie")
    assert "on_session=" in response.headers["set-cookie"]
