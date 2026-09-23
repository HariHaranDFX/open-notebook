"""Delegated SharePoint consent; never uses login-session or app-only tokens."""

import hashlib
import json
import os
from asyncio import to_thread
from datetime import datetime, timedelta, timezone

import httpx
import msal
from cryptography.fernet import InvalidToken

from api.auth.pkce import generate_state
from open_notebook.connectors.models import ConnectorConnection
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ExternalServiceError,
)
from open_notebook.utils.encryption import (
    encrypt_value,
    get_fernet,
    get_secret_from_env,
)

SCOPES = ["Sites.Read.All"]
RECONNECT_MESSAGE = (
    "SharePoint consent expired or was revoked. Connect SharePoint again."
)


def _config() -> dict[str, str]:
    if os.getenv("AUTH_PROVIDER", "password").lower() != "entra":
        raise ConfigurationError("SharePoint connection requires AUTH_PROVIDER=entra")
    keys = (
        "ENTRA_TENANT_ID",
        "ENTRA_CLIENT_ID",
        "ENTRA_CLIENT_SECRET",
        "SHAREPOINT_CONNECTOR_REDIRECT_URI",
    )
    config = {key: os.getenv(key, "").strip() for key in keys}
    for key, value in config.items():
        if not value:
            raise ConfigurationError(f"Set {key} to connect SharePoint")
    # Check configuration even if the shared encryption utility has a cached key.
    if not get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY"):
        raise ConfigurationError(
            "Set OPEN_NOTEBOOK_ENCRYPTION_KEY to connect SharePoint"
        )
    return config


def _encrypt(value: str) -> str:
    try:
        return encrypt_value(value)
    except ValueError:
        raise ConfigurationError(
            "Configure OPEN_NOTEBOOK_ENCRYPTION_KEY to connect SharePoint"
        ) from None


def _decrypt(value: str) -> str:
    # The shared decrypt_value accepts legacy plaintext. Connector secrets must not.
    try:
        return get_fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        raise ConfigurationError(
            "Cannot decrypt SharePoint credentials. Check OPEN_NOTEBOOK_ENCRYPTION_KEY and reconnect."
        ) from None


async def connection_status(user_id: str | None) -> dict:
    try:
        _config()
    except ConfigurationError:
        return {"available": False, "connected": False}
    if user_id is None:
        raise AuthenticationError("Sign in to connect SharePoint")
    rows = await repo_query(
        "SELECT status, token_cache FROM connector_connection WHERE user_id = $user_id AND provider = 'sharepoint' LIMIT 1;",
        {"user_id": ensure_record_id(user_id)},
    )
    status = rows[0]["status"] if rows else "disconnected"
    if status == "connected" and not rows[0].get("token_cache"):
        status = "reauth_required"
    return {
        "available": True,
        "connected": status == "connected",
        "status": status,
    }


def _msal_app(config: dict[str, str], cache: msal.SerializableTokenCache):
    return msal.ConfidentialClientApplication(
        config["ENTRA_CLIENT_ID"],
        client_credential=config["ENTRA_CLIENT_SECRET"],
        authority=f"https://login.microsoftonline.com/{config['ENTRA_TENANT_ID']}",
        token_cache=cache,
    )


async def begin_connection(user_id: str) -> str:
    config = _config()
    flow = await to_thread(
        lambda: _msal_app(config, msal.SerializableTokenCache()).initiate_auth_code_flow(
            SCOPES,
            redirect_uri=config["SHAREPOINT_CONNECTOR_REDIRECT_URI"],
            state=generate_state(),
        )
    )
    await repo_query(
        "CREATE connector_oauth_state SET state_hash = $state_hash, user_id = $user_id, "
        "auth_flow = $auth_flow, expires_at = $expires_at;",
        {
            "state_hash": hashlib.sha256(flow["state"].encode()).hexdigest(),
            "user_id": ensure_record_id(user_id),
            "auth_flow": _encrypt(json.dumps(flow)),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
    )
    return flow["auth_uri"]


async def complete_connection(
    user_id: str, state: str | None, code: str | None, error: str | None = None
) -> None:
    config = _config()
    if not state:
        raise AuthenticationError(
            "Missing SharePoint consent state. Connect SharePoint again."
        )
    rows = await repo_query(
        "DELETE connector_oauth_state WHERE state_hash = $state_hash AND user_id = $user_id "
        "AND expires_at > time::now() RETURN BEFORE;",
        {
            "state_hash": hashlib.sha256(state.encode()).hexdigest(),
            "user_id": ensure_record_id(user_id),
        },
    )
    if not rows:
        raise AuthenticationError(
            "SharePoint consent state expired or does not match this user. Connect SharePoint again."
        )
    if error or not code:
        raise AuthenticationError(
            "SharePoint consent was not completed. Connect SharePoint again."
        )
    cache = msal.SerializableTokenCache()
    try:
        flow = json.loads(_decrypt(rows[0]["auth_flow"]))
        result = await to_thread(
            lambda: _msal_app(config, cache).acquire_token_by_auth_code_flow(
                flow, {"state": state, "code": code}
            )
        )
    except (ValueError, KeyError, httpx.HTTPError):
        raise AuthenticationError(
            "SharePoint consent could not be verified. Connect SharePoint again."
        ) from None
    if "access_token" not in result or not cache.has_state_changed:
        raise AuthenticationError(RECONNECT_MESSAGE)
    if not next(cache.search("RefreshToken"), None):
        raise AuthenticationError("SharePoint did not grant offline access. Connect SharePoint again.")
    claims = result.get("id_token_claims", {})
    account_id = claims.get("oid") if isinstance(claims, dict) else None
    scope = result.get("scope", "Sites.Read.All")
    if not isinstance(scope, str):
        raise ExternalServiceError("SharePoint authorization returned an invalid response. Try again.")
    await repo_query(
        "UPSERT connector_connection SET user_id = $user_id, provider = 'sharepoint', "
        "token_cache = $token_cache, refresh_token = NONE, granted_scopes = $granted_scopes, "
        "external_tenant_id = $external_tenant_id, external_account_id = $external_account_id OR NONE, status = 'connected', "
        "connected_at = time::now(), disconnected_at = NONE, updated = time::now() "
        "WHERE user_id = $user_id AND provider = 'sharepoint';",
        {
            "user_id": ensure_record_id(user_id),
            "token_cache": _encrypt(cache.serialize()),
            "granted_scopes": scope.split(),
            "external_tenant_id": config["ENTRA_TENANT_ID"],
            "external_account_id": account_id,
        },
    )


async def get_connection(user_id: str) -> ConnectorConnection | None:
    rows = await repo_query(
        "SELECT * FROM connector_connection WHERE user_id = $user_id AND provider = 'sharepoint' LIMIT 1;",
        {"user_id": ensure_record_id(user_id)},
    )
    if not rows:
        return None
    connection = ConnectorConnection(**rows[0])
    if connection.status == "connected" and not connection.token_cache:
        connection.status = "reauth_required"
    return connection


async def acquire_delegated_token(user_id: str) -> str:
    """Acquire a token from this owner's durable MSAL cache, even without a login session."""
    config = _config()
    for _ in range(3):
        connection = await get_connection(user_id)
        if not connection or connection.status != "connected" or not connection.token_cache:
            raise AuthenticationError("SharePoint is not connected. Connect SharePoint again.")
        cache = msal.SerializableTokenCache()
        cache.deserialize(_decrypt(connection.token_cache))

        def silent():
            app = _msal_app(config, cache)
            accounts = app.get_accounts()
            return app.acquire_token_silent_with_error(SCOPES, account=accounts[0]) if accounts else None

        result = await to_thread(silent)
        params = {"user_id": ensure_record_id(user_id), "previous_cache": connection.token_cache}
        if not result or result.get("error") == "invalid_grant":
            updated = await repo_query(
                "UPDATE connector_connection SET status = 'reauth_required', token_cache = NONE, "
                "updated = time::now() WHERE user_id = $user_id AND provider = 'sharepoint' "
                "AND status = 'connected' AND token_cache = $previous_cache RETURN AFTER;",
                params,
            )
            if updated:
                raise AuthenticationError(RECONNECT_MESSAGE)
            continue
        access_token = result.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise ExternalServiceError("SharePoint authorization failed. Try again.")
        if cache.has_state_changed:
            updated = await repo_query(
                "UPDATE connector_connection SET token_cache = $token_cache, updated = time::now() "
                "WHERE user_id = $user_id AND provider = 'sharepoint' AND status = 'connected' "
                "AND token_cache = $previous_cache RETURN AFTER;",
                {**params, "token_cache": _encrypt(cache.serialize())},
            )
            if updated:
                return access_token
        else:
            latest = await get_connection(user_id)
            if latest and latest.status == "connected" and latest.token_cache == connection.token_cache:
                return access_token
    raise ExternalServiceError("SharePoint authorization changed during refresh. Try again.")


async def disconnect_connection(user_id: str) -> None:
    await repo_query(
        "UPDATE connector_connection SET status = 'disconnected', token_cache = NONE, refresh_token = NONE, "
        "disconnected_at = time::now(), updated = time::now() "
        "WHERE user_id = $user_id AND provider = 'sharepoint';",
        {"user_id": ensure_record_id(user_id)},
    )
