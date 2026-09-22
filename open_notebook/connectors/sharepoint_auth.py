"""Delegated SharePoint consent; never uses login-session or app-only tokens."""

import hashlib
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from cryptography.fernet import InvalidToken

from api.auth import jwt_validate
from api.auth.pkce import generate_challenge, generate_state, generate_verifier
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

SCOPES = "openid profile offline_access Sites.Read.All"
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
        "SELECT status FROM connector_connection WHERE user_id = $user_id AND provider = 'sharepoint' LIMIT 1;",
        {"user_id": ensure_record_id(user_id)},
    )
    return {
        "available": True,
        "connected": bool(rows and rows[0]["status"] == "connected"),
    }


async def begin_connection(user_id: str) -> str:
    config = _config()
    state, verifier = generate_state(), generate_verifier()
    await repo_query(
        "CREATE connector_oauth_state SET state_hash = $state_hash, user_id = $user_id, "
        "code_verifier = $code_verifier, expires_at = $expires_at;",
        {
            "state_hash": hashlib.sha256(state.encode()).hexdigest(),
            "user_id": ensure_record_id(user_id),
            "code_verifier": _encrypt(verifier),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
    )
    params = {
        "client_id": config["ENTRA_CLIENT_ID"],
        "response_type": "code",
        "redirect_uri": config["SHAREPOINT_CONNECTOR_REDIRECT_URI"],
        "response_mode": "query",
        "scope": SCOPES,
        "state": state,
        "code_challenge": generate_challenge(verifier),
        "code_challenge_method": "S256",
    }
    return f"https://login.microsoftonline.com/{config['ENTRA_TENANT_ID']}/oauth2/v2.0/authorize?{urlencode(params)}"


async def _token_request(config: dict[str, str], grant: dict[str, str]) -> dict:
    data = {
        "client_id": config["ENTRA_CLIENT_ID"],
        "client_secret": config["ENTRA_CLIENT_SECRET"],
        "scope": SCOPES,
        **grant,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"https://login.microsoftonline.com/{config['ENTRA_TENANT_ID']}/oauth2/v2.0/token",
                data=data,
            )
    except httpx.HTTPError:
        raise ExternalServiceError(
            "SharePoint authorization is temporarily unavailable. Try again."
        ) from None
    try:
        body = response.json()
    except ValueError:
        raise ExternalServiceError(
            "SharePoint authorization returned an invalid response. Try again."
        ) from None
    if not isinstance(body, dict):
        raise ExternalServiceError(
            "SharePoint authorization returned an invalid response. Try again."
        )
    if response.status_code != 200:
        if body.get("error") == "invalid_grant":
            raise AuthenticationError(RECONNECT_MESSAGE)
        raise ExternalServiceError(
            "SharePoint authorization failed. Try connecting again."
        )
    return body


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
    tokens = await _token_request(
        config,
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": _decrypt(rows[0]["code_verifier"]),
            "redirect_uri": config["SHAREPOINT_CONNECTOR_REDIRECT_URI"],
        },
    )
    refresh_token = tokens.get("refresh_token")
    if not isinstance(refresh_token, str) or not refresh_token:
        raise AuthenticationError(
            "SharePoint did not grant offline access. Connect SharePoint again."
        )
    account_id = None
    if tokens.get("id_token"):
        try:
            claims = await jwt_validate.validate_id_token(
                tokens["id_token"],
                tenant_id=config["ENTRA_TENANT_ID"],
                client_id=config["ENTRA_CLIENT_ID"],
            )
        except (AuthenticationError, httpx.HTTPError):
            raise AuthenticationError(
                "Could not verify the SharePoint account. Connect SharePoint again."
            ) from None
        account_id = claims.get("oid")
        if not isinstance(account_id, str):
            raise AuthenticationError(
                "Could not verify the SharePoint account. Connect SharePoint again."
            )
    scope = tokens.get("scope", SCOPES)
    if not isinstance(scope, str):
        raise ExternalServiceError(
            "SharePoint authorization returned an invalid response. Try again."
        )
    await repo_query(
        "UPSERT connector_connection SET user_id = $user_id, provider = 'sharepoint', "
        "refresh_token = $refresh_token, granted_scopes = $granted_scopes, "
        "external_tenant_id = $external_tenant_id, external_account_id = $external_account_id OR NONE, status = 'connected', "
        "connected_at = time::now(), disconnected_at = NONE, updated = time::now() "
        "WHERE user_id = $user_id AND provider = 'sharepoint';",
        {
            "user_id": ensure_record_id(user_id),
            "refresh_token": _encrypt(refresh_token),
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
    return ConnectorConnection(**rows[0]) if rows else None


async def acquire_delegated_token(user_id: str) -> str:
    """Refresh this owner's connector token; access tokens remain in memory only."""
    config = _config()
    connection = await get_connection(user_id)
    if (
        not connection
        or connection.status != "connected"
        or not connection.refresh_token
    ):
        raise AuthenticationError(
            "SharePoint is not connected. Connect SharePoint again."
        )
    params = {
        "user_id": ensure_record_id(user_id),
        "previous_token": connection.refresh_token,
    }
    try:
        tokens = await _token_request(
            config,
            {
                "grant_type": "refresh_token",
                "refresh_token": _decrypt(connection.refresh_token),
            },
        )
    except AuthenticationError:
        # Do not disconnect a newer connection created while refresh was in flight.
        await repo_query(
            "UPDATE connector_connection SET status = 'disconnected', refresh_token = NONE, "
            "disconnected_at = time::now(), updated = time::now() "
            "WHERE user_id = $user_id AND provider = 'sharepoint' AND refresh_token = $previous_token;",
            params,
        )
        raise
    access_token = tokens.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise ExternalServiceError(
            "SharePoint authorization did not return an access token. Try again."
        )
    rotated = tokens.get("refresh_token")
    if rotated:
        if not isinstance(rotated, str):
            raise ExternalServiceError(
                "SharePoint authorization returned an invalid response. Try again."
            )
        await repo_query(
            "UPDATE connector_connection SET refresh_token = $refresh_token, updated = time::now() "
            "WHERE user_id = $user_id AND provider = 'sharepoint' AND status = 'connected' "
            "AND refresh_token = $previous_token;",
            {**params, "refresh_token": _encrypt(rotated)},
        )
    return access_token
