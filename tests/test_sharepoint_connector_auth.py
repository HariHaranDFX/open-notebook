import hashlib
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import FastAPI
from loguru import logger
from starlette.responses import JSONResponse

from api.auth.deps import current_user_optional, require_user
from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import AuthenticationError, ConfigurationError
from open_notebook.utils import encryption


@pytest.fixture
def setup(monkeypatch):
    from api.routers.connectors import router
    from open_notebook.connectors import sharepoint_auth as auth

    for key, value in {
        "AUTH_PROVIDER": "entra",
        "ENTRA_TENANT_ID": "tenant",
        "ENTRA_CLIENT_ID": "client",
        "ENTRA_CLIENT_SECRET": "client-secret",
        "SHAREPOINT_CONNECTOR_REDIRECT_URI": "https://app.test/api/connectors/sharepoint/callback",
        "OPEN_NOTEBOOK_ENCRYPTION_KEY": "test-encryption-key",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE", raising=False)
    monkeypatch.setattr(encryption, "_ENCRYPTION_KEY", None)
    user = AuthenticatedUser(
        "user:alice", "alice@test", "Alice", "user", "oid", "default"
    )
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: user
    app.dependency_overrides[current_user_optional] = lambda: user

    async def error_handler(request, exc):
        return JSONResponse(
            {"detail": str(exc)},
            status_code=422 if isinstance(exc, ConfigurationError) else 401,
        )

    app.add_exception_handler(AuthenticationError, error_handler)
    app.add_exception_handler(ConfigurationError, error_handler)
    repo = AsyncMock(return_value=[])
    monkeypatch.setattr(auth, "repo_query", repo)
    return app, auth, repo, user


@pytest.mark.asyncio
async def test_external_account_metadata_is_from_validated_id_token(setup, monkeypatch):
    app, auth, repo, user = setup
    repo.return_value = [{"code_verifier": encryption.encrypt_value("verifier")}]
    monkeypatch.setattr(
        httpx.AsyncClient,
        "post",
        AsyncMock(
            return_value=httpx.Response(
                200,
                json={
                    "refresh_token": "refresh-secret",
                    "id_token": "id-secret",
                },
            )
        ),
    )
    validate = AsyncMock(return_value={"oid": "external-oid", "tid": "tenant"})
    monkeypatch.setattr("api.auth.jwt_validate.validate_id_token", validate)
    await auth.complete_connection(user.id, "state", "code")
    assert repo.call_args.args[1]["external_account_id"] == "external-oid"
    validate.assert_awaited_once_with(
        "id-secret", tenant_id="tenant", client_id="client"
    )
    assert "id-secret" not in repr(repo.call_args_list)


@pytest.mark.asyncio
async def test_refresh_without_rotation_preserves_existing_ciphertext(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "refresh_token": encryption.encrypt_value("refresh-secret"),
        }
    ]
    monkeypatch.setattr(
        httpx.AsyncClient,
        "post",
        AsyncMock(
            return_value=httpx.Response(200, json={"access_token": "access-secret"})
        ),
    )
    assert await auth.acquire_delegated_token(user.id) == "access-secret"
    assert repo.await_count == 1


@pytest.mark.asyncio
async def test_plaintext_legacy_connector_secret_is_rejected(setup, monkeypatch):
    app, auth, repo, user = setup
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "refresh_token": "plaintext",
        }
    ]
    post = AsyncMock()
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with pytest.raises(ConfigurationError):
        await auth.acquire_delegated_token(user.id)
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_callback_consent_error_does_not_echo_upstream_description(setup):
    app, auth, repo, user = setup
    repo.return_value = [{"code_verifier": encryption.encrypt_value("verifier")}]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.get(
            "/api/connectors/sharepoint/callback",
            params={
                "state": "state",
                "error": "sensitive-upstream",
                "error_description": "secret-body",
            },
        )
    assert response.status_code == 401
    assert "sensitive-upstream" not in response.text
    assert "secret-body" not in response.text
    assert repo.await_count == 1


@pytest.mark.asyncio
async def test_connect_callback_encrypts_secrets_and_uses_dedicated_scopes(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    logs = []
    sink = logger.add(lambda message: logs.append(str(message)))
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="https://app.test"
        ) as client:
            response = await client.post("/api/connectors/sharepoint/connect")
            assert response.status_code == 200
            params = parse_qs(urlsplit(response.json()["authorization_url"]).query)
            assert params["scope"] == ["openid profile offline_access Sites.Read.All"]
            assert params["redirect_uri"] == [
                "https://app.test/api/connectors/sharepoint/callback"
            ]
            assert params["code_challenge_method"] == ["S256"]
            stored = repo.call_args.args[1]
            assert (
                stored["state_hash"]
                == hashlib.sha256(params["state"][0].encode()).hexdigest()
            )
            assert str(stored["user_id"]) == user.id
            verifier = encryption.decrypt_value(stored["code_verifier"])
            assert verifier not in repr(repo.call_args_list)
            repo.return_value = [{"code_verifier": stored["code_verifier"]}]
            token_post = AsyncMock(
                return_value=httpx.Response(
                    200,
                    json={
                        "access_token": "access-secret",
                        "refresh_token": "refresh-secret",
                        "scope": "openid profile offline_access Sites.Read.All",
                    },
                )
            )
            monkeypatch.setattr(httpx.AsyncClient, "post", token_post)
            response = await client.get(
                "/api/connectors/sharepoint/callback",
                params={"code": "code", "state": params["state"][0]},
            )
        assert response.status_code == 302
        saved = repo.call_args.args[1]
        assert encryption.decrypt_value(saved["refresh_token"]) == "refresh-secret"
        assert "refresh-secret" not in repr(repo.call_args_list)
        assert "refresh-secret" not in response.text + repr(
            dict(response.headers)
        ) + "".join(logs)
        assert "access-secret" not in repr(repo.call_args_list)
        payload = token_post.call_args.kwargs["data"]
        assert payload["code_verifier"] == verifier
        assert payload["redirect_uri"] == params["redirect_uri"][0]
    finally:
        logger.remove(sink)


@pytest.mark.asyncio
async def test_missing_encryption_key_fails_closed(setup, monkeypatch):
    app, auth, repo, user = setup
    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.post("/api/connectors/sharepoint/connect")
    assert response.status_code == 422
    assert "OPEN_NOTEBOOK_ENCRYPTION_KEY" in response.text
    repo.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_rotates_encrypted_token_without_serializing_it(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    previous = encryption.encrypt_value("previous-refresh-secret")
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "refresh_token": previous,
            "status": "connected",
        }
    ]
    token_post = AsyncMock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "new-access-secret",
                "refresh_token": "rotated-refresh-secret",
            },
        )
    )
    monkeypatch.setattr(httpx.AsyncClient, "post", token_post)
    assert await auth.acquire_delegated_token(user.id) == "new-access-secret"
    saved = repo.call_args.args[1]
    assert encryption.decrypt_value(saved["refresh_token"]) == "rotated-refresh-secret"
    assert saved["refresh_token"] != previous
    assert str(saved["user_id"]) == user.id
    assert "rotated-refresh-secret" not in repr(repo.call_args_list)
    assert (
        token_post.call_args.kwargs["data"]["refresh_token"]
        == "previous-refresh-secret"
    )
    connection = await auth.get_connection(user.id)
    assert "refresh_token" not in connection.model_dump()
    assert previous not in repr(connection)


@pytest.mark.asyncio
async def test_revoked_refresh_disconnects_and_returns_safe_actionable_401(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "refresh_token": encryption.encrypt_value("refresh-secret"),
            "status": "connected",
        }
    ]
    monkeypatch.setattr(
        httpx.AsyncClient,
        "post",
        AsyncMock(
            return_value=httpx.Response(
                400,
                json={
                    "error": "invalid_grant",
                    "error_description": "sensitive-upstream-body",
                },
            )
        ),
    )

    @app.get("/test-delegated-operation")
    async def delegated_operation():
        await auth.acquire_delegated_token(user.id)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.get("/test-delegated-operation")
    assert response.status_code == 401
    assert "Connect SharePoint again" in response.text
    assert "sensitive-upstream-body" not in response.text
    query, params = repo.call_args.args
    assert "status = 'disconnected'" in query
    assert "refresh_token = NONE" in query
    assert str(params["user_id"]) == user.id


@pytest.mark.asyncio
async def test_callback_state_is_atomic_expiring_owner_bound_and_single_use(
    setup, monkeypatch
):
    from datetime import datetime, timezone

    app, auth, repo, user = setup
    pending = {}

    async def query(sql, params):
        if sql.startswith("CREATE connector_oauth_state"):
            pending.update(params)
            return []
        if sql.startswith("DELETE connector_oauth_state"):
            assert "RETURN BEFORE" in sql
            assert "user_id = $user_id" in sql
            assert "expires_at > time::now()" in sql
            if (
                pending
                and params["state_hash"] == pending["state_hash"]
                and params["user_id"] == pending["user_id"]
                and pending["expires_at"] > datetime.now(timezone.utc)
            ):
                result = pending.copy()
                pending.clear()
                return [result]
            return []
        return []

    repo.side_effect = query
    url = await auth.begin_connection(user.id)
    state = parse_qs(urlsplit(url).query)["state"][0]
    seconds = (pending["expires_at"] - datetime.now(timezone.utc)).total_seconds()
    assert 590 < seconds <= 600
    post = AsyncMock(return_value=httpx.Response(200, json={"refresh_token": "secret"}))
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with pytest.raises(AuthenticationError):
        await auth.complete_connection("user:bob", state, "code")
    post.assert_not_awaited()
    await auth.complete_connection(user.id, state, "code")
    with pytest.raises(AuthenticationError):
        await auth.complete_connection(user.id, state, "code")
    assert post.await_count == 1
    url = await auth.begin_connection(user.id)
    state = parse_qs(urlsplit(url).query)["state"][0]
    pending["expires_at"] = datetime(2000, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(AuthenticationError):
        await auth.complete_connection(user.id, state, "code")
    assert post.await_count == 1


@pytest.mark.asyncio
async def test_password_mode_status_unavailable_and_connection_rejected(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    monkeypatch.setenv("AUTH_PROVIDER", "password")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        status = await client.get("/api/connectors/sharepoint/status")
        connect = await client.post("/api/connectors/sharepoint/connect")
    assert status.json() == {"available": False, "connected": False}
    assert connect.status_code == 422
    repo.assert_not_awaited()
