import hashlib
import json
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
import requests
from fastapi import FastAPI
from loguru import logger
from starlette.responses import JSONResponse

from api.auth.deps import current_user_optional, require_user
from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ExternalServiceError,
)
from open_notebook.utils import encryption


class FakeMsalClient:
    silent_result = {"access_token": "access-secret"}
    change_cache = True

    def __init__(self, *args, token_cache, **kwargs):
        self.cache = token_cache

    def initiate_auth_code_flow(self, scopes, redirect_uri, state):
        assert scopes == ["Sites.Read.All"]
        params = {
            "state": state,
            "scope": "openid profile offline_access Sites.Read.All",
            "redirect_uri": redirect_uri,
            "code_challenge_method": "S256",
            "code_challenge": "challenge",
        }
        return {
            "state": state,
            "code_verifier": "verifier-secret",
            "auth_uri": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?" + urlencode(params),
        }

    def acquire_token_by_auth_code_flow(self, flow, response):
        assert flow["state"] == response["state"]
        assert flow["code_verifier"] == "verifier-secret"
        self.cache._cache["Account"] = {"one": {"home_account_id": "owner"}}
        self.cache._cache["RefreshToken"] = {"one": {"secret": "refresh-secret"}}
        self.cache.has_state_changed = True
        return {
            "access_token": "access-secret",
            "id_token_claims": {"oid": "external-oid"},
            "scope": "Sites.Read.All",
        }

    def get_accounts(self):
        return list(self.cache._cache.get("Account", {}).values())

    def acquire_token_silent_with_error(self, scopes, account):
        assert scopes == ["Sites.Read.All"]
        assert account["home_account_id"] == "owner"
        if self.change_cache:
            self.cache._cache["AccessToken"] = {"one": {"secret": "access-secret"}}
            self.cache.has_state_changed = True
        return self.silent_result


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
    monkeypatch.setattr(auth.msal, "ConfidentialClientApplication", FakeMsalClient)
    FakeMsalClient.silent_result = {"access_token": "access-secret"}
    FakeMsalClient.change_cache = True
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
    flow = FakeMsalClient(token_cache=None).initiate_auth_code_flow(
        ["Sites.Read.All"], "https://app.test/api/connectors/sharepoint/callback", "state"
    )
    repo.return_value = [{"auth_flow": encryption.encrypt_value(json.dumps(flow))}]
    await auth.complete_connection(user.id, "state", "code")
    assert repo.call_args.args[1]["external_account_id"] == "external-oid"
    assert "external-oid" in repr(repo.call_args_list)


@pytest.mark.asyncio
async def test_refresh_without_rotation_preserves_existing_ciphertext(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    FakeMsalClient.change_cache = False
    existing = encryption.encrypt_value(json.dumps({"Account": {"one": {"home_account_id": "owner"}}}))
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "token_cache": existing,
        }
    ]
    assert await auth.acquire_delegated_token(user.id) == "access-secret"
    assert repo.await_count == 2
    assert repo.call_args.args[1]["user_id"] is not None


@pytest.mark.asyncio
async def test_plaintext_legacy_connector_secret_is_rejected(setup, monkeypatch):
    app, auth, repo, user = setup
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "token_cache": "plaintext",
        }
    ]
    with pytest.raises(ConfigurationError):
        await auth.acquire_delegated_token(user.id)
    assert repo.await_count == 1


@pytest.mark.asyncio
async def test_callback_consent_error_does_not_echo_upstream_description(setup):
    app, auth, repo, user = setup
    repo.return_value = [{"auth_flow": encryption.encrypt_value("{}") }]
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
            flow = json.loads(encryption.decrypt_value(stored["auth_flow"]))
            assert flow["code_verifier"] == "verifier-secret"
            assert "verifier-secret" not in repr(repo.call_args_list)
            repo.return_value = [{"auth_flow": stored["auth_flow"]}]
            response = await client.get(
                "/api/connectors/sharepoint/callback",
                params={"code": "code", "state": params["state"][0]},
            )
        assert response.status_code == 302
        assert response.headers["location"] == "/connections"
        saved = repo.call_args.args[1]
        cache = json.loads(encryption.decrypt_value(saved["token_cache"]))
        assert cache["RefreshToken"]["one"]["secret"] == "refresh-secret"
        assert "refresh-secret" not in repr(repo.call_args_list)
        assert "refresh-secret" not in response.text + repr(
            dict(response.headers)
        ) + "".join(logs)
        assert "access-secret" not in repr(repo.call_args_list)
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
async def test_silent_acquisition_persists_changed_cache_without_serializing_secrets(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    previous = encryption.encrypt_value(json.dumps({"Account": {"one": {"home_account_id": "owner"}}}))
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "token_cache": previous,
            "status": "connected",
        }
    ]
    assert await auth.acquire_delegated_token(user.id) == "access-secret"
    saved = repo.call_args.args[1]
    assert json.loads(encryption.decrypt_value(saved["token_cache"]))["AccessToken"]["one"]["secret"] == "access-secret"
    assert saved["token_cache"] != previous
    assert str(saved["user_id"]) == user.id
    assert "access-secret" not in repr(repo.call_args_list)
    assert "token_cache = $previous_cache" in repo.call_args.args[0]
    connection = await auth.get_connection(user.id)
    assert "token_cache" not in connection.model_dump()
    assert previous not in repr(connection)


@pytest.mark.asyncio
async def test_revoked_consent_requires_reauth_and_returns_safe_actionable_401(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    repo.return_value = [
        {
            "id": "connector_connection:one",
            "user_id": user.id,
            "token_cache": encryption.encrypt_value(json.dumps({"Account": {"one": {"home_account_id": "owner"}}})),
            "status": "connected",
        }
    ]
    FakeMsalClient.silent_result = {"error": "invalid_grant", "error_description": "sensitive-upstream-body"}

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
    assert "status = 'reauth_required'" in query
    assert "token_cache = NONE" in query
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
    with pytest.raises(AuthenticationError):
        await auth.complete_connection("user:bob", state, "code")
    await auth.complete_connection(user.id, state, "code")
    with pytest.raises(AuthenticationError):
        await auth.complete_connection(user.id, state, "code")
    url = await auth.begin_connection(user.id)
    state = parse_qs(urlsplit(url).query)["state"][0]
    pending["expires_at"] = datetime(2000, 1, 1, tzinfo=timezone.utc)
    with pytest.raises(AuthenticationError):
        await auth.complete_connection(user.id, state, "code")


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


@pytest.mark.asyncio
async def test_disconnect_is_idempotent_and_owner_scoped(setup):
    app, auth, repo, user = setup
    repo.return_value = [{"id": "connector_connection:one"}]
    await auth.disconnect_connection(user.id)
    query, params = repo.call_args.args
    assert "user_id = $user_id" in query
    assert "token_cache = NONE" in query
    assert str(params["user_id"]) == user.id
    assert await auth.disconnect_connection(user.id) is None


@pytest.mark.asyncio
async def test_worker_acquires_from_encrypted_msal_cache_without_login_session(
    setup, monkeypatch
):
    app, auth, repo, user = setup
    cache_json = '{"Account": {"one": {"home_account_id": "owner"}}}'
    ciphertext = encryption.encrypt_value(cache_json)
    repo.return_value = [{
        "id": "connector_connection:one", "user_id": user.id,
        "status": "connected", "token_cache": ciphertext,
    }]

    class MsalClient:
        def __init__(self, *args, token_cache, **kwargs):
            self.cache = token_cache

        def get_accounts(self):
            assert self.cache._cache["Account"]["one"]["home_account_id"] == "owner"
            return [{"home_account_id": "owner"}]

        def acquire_token_silent_with_error(self, scopes, account):
            assert scopes == ["Sites.Read.All"]
            assert account["home_account_id"] == "owner"
            self.cache._cache["AccessToken"] = {"one": {"secret": "access-secret"}}
            self.cache.has_state_changed = True
            return {"access_token": "access-secret"}

    monkeypatch.setattr(auth.msal, "ConfidentialClientApplication", MsalClient)
    assert await auth.acquire_delegated_token(user.id) == "access-secret"
    query, params = repo.call_args.args
    assert "token_cache = $token_cache" in query
    assert "token_cache = $previous_cache" in query
    assert encryption.decrypt_value(params["token_cache"]).find("access-secret") > 0
    assert "access-secret" not in repr(repo.call_args_list)


@pytest.mark.asyncio
async def test_concurrent_refresh_reloads_after_compare_and_swap_loss(setup):
    app, auth, repo, user = setup
    account = {"Account": {"one": {"home_account_id": "owner"}}}
    first = encryption.encrypt_value(json.dumps(account))
    second = encryption.encrypt_value(json.dumps({**account, "RefreshToken": {"one": {"secret": "rotated"}}}))
    current = first
    writes = 0

    async def query(sql, params):
        nonlocal current, writes
        if sql.startswith("SELECT * FROM connector_connection"):
            return [{"id": "connector_connection:one", "user_id": user.id, "status": "connected", "token_cache": current}]
        if sql.startswith("UPDATE connector_connection"):
            writes += 1
            if writes == 1:
                current = second
                return []
            assert params["previous_cache"] == second
            return [{"id": "connector_connection:one"}]
        return []

    repo.side_effect = query
    assert await auth.acquire_delegated_token(user.id) == "access-secret"
    assert writes == 2


@pytest.mark.asyncio
async def test_legacy_connection_without_msal_cache_requires_reauth(setup):
    app, auth, repo, user = setup
    repo.return_value = [{"id": "connector_connection:one", "user_id": user.id,
                          "status": "connected", "refresh_token": "old-encrypted-token"}]
    assert (await auth.get_connection(user.id)).status == "reauth_required"
    assert (await auth.connection_status(user.id))["status"] == "reauth_required"
    with pytest.raises(AuthenticationError):
        await auth.acquire_delegated_token(user.id)


@pytest.mark.asyncio
async def test_msal_requests_have_finite_timeout(setup, monkeypatch):
    app, auth, repo, user = setup
    seen = []

    class CapturingClient(FakeMsalClient):
        def __init__(self, *args, **kwargs):
            seen.append(kwargs.get("timeout"))
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(auth.msal, "ConfidentialClientApplication", CapturingClient)
    await auth.begin_connection(user.id)
    assert seen == [10]


@pytest.mark.asyncio
async def test_begin_connection_translates_requests_transport_failure(setup, monkeypatch):
    app, auth, repo, user = setup

    class FailingClient(FakeMsalClient):
        def __init__(self, *args, **kwargs):
            raise requests.exceptions.Timeout("sensitive-upstream-body")

    monkeypatch.setattr(auth.msal, "ConfidentialClientApplication", FailingClient)
    with pytest.raises(ExternalServiceError, match="temporarily unavailable") as exc:
        await auth.begin_connection(user.id)
    assert "sensitive-upstream-body" not in str(exc.value)
    repo.assert_not_awaited()


@pytest.mark.asyncio
async def test_callback_transport_failure_keeps_existing_connection(setup, monkeypatch):
    app, auth, repo, user = setup
    flow = FakeMsalClient(token_cache=None).initiate_auth_code_flow(
        ["Sites.Read.All"], "https://app.test/api/connectors/sharepoint/callback", "state"
    )
    repo.return_value = [{"auth_flow": encryption.encrypt_value(json.dumps(flow))}]

    class FailingClient(FakeMsalClient):
        def acquire_token_by_auth_code_flow(self, flow, response):
            raise requests.exceptions.ConnectionError("sensitive-upstream-body")

    monkeypatch.setattr(auth.msal, "ConfidentialClientApplication", FailingClient)
    with pytest.raises(ExternalServiceError, match="temporarily unavailable") as exc:
        await auth.complete_connection(user.id, "state", "code")
    assert "sensitive-upstream-body" not in str(exc.value)
    assert repo.await_count == 1  # consumed OAuth state; no credential update


@pytest.mark.asyncio
async def test_silent_transport_failure_preserves_cache_and_status(setup, monkeypatch):
    app, auth, repo, user = setup
    ciphertext = encryption.encrypt_value(json.dumps({"Account": {"one": {"home_account_id": "owner"}}}))
    repo.return_value = [{"id": "connector_connection:one", "user_id": user.id,
                          "status": "connected", "token_cache": ciphertext}]

    class FailingClient(FakeMsalClient):
        def acquire_token_silent_with_error(self, scopes, account):
            raise requests.exceptions.Timeout("sensitive-upstream-body")

    monkeypatch.setattr(auth.msal, "ConfidentialClientApplication", FailingClient)
    with pytest.raises(ExternalServiceError, match="temporarily unavailable") as exc:
        await auth.acquire_delegated_token(user.id)
    assert "sensitive-upstream-body" not in str(exc.value)
    assert repo.await_count == 1  # only owner-scoped read; no cache/status mutation
