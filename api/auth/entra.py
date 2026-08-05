"""EntraOIDCProvider: production auth via OIDC Authorization Code + PKCE (BFF).

The browser never sees an Entra token - only the opaque `on_session` cookie
(see `api.auth.session`). This module owns the three network calls Entra
requires (authorize redirect, token exchange, JWKS-backed id_token
validation) plus JIT user provisioning from the required admin allowlist.
"""

import os
import secrets
from typing import Any, Dict, Literal, Optional
from urllib.parse import urlencode

import httpx
from fastapi import Request
from starlette.responses import RedirectResponse, Response

from api.auth.cookies import cookie_secure
from api.auth.jwt_validate import validate_id_token
from api.auth.oauth_state import consume_oauth_state, store_oauth_state
from api.auth.pkce import generate_challenge, generate_state, generate_verifier
from api.auth.session import (
    SESSION_COOKIE_NAME,
    SESSION_LIFETIME,
    create_session,
    delete_session,
    resolve_session,
)
from api.auth.types import AuthenticatedUser
from open_notebook.database.repository import repo_query
from open_notebook.domain.user import User
from open_notebook.exceptions import AuthenticationError
from open_notebook.utils.encryption import encrypt_value

_REQUIRED_ENTRA_ENV_KEYS = (
    "ENTRA_TENANT_ID",
    "ENTRA_CLIENT_ID",
    "ENTRA_CLIENT_SECRET",
    "ENTRA_REDIRECT_URI",
    "AUTH_ADMIN_EMAILS",
)


def _admin_allowlist() -> set[str]:
    raw = os.environ.get("AUTH_ADMIN_EMAILS", "")
    return {email.strip().lower() for email in raw.split(",") if email.strip()}


def resolve_role(email: str) -> Literal["admin", "user"]:
    """Role is derived purely from the required allowlist - no first-login-as-admin."""
    return "admin" if email.lower() in _admin_allowlist() else "user"


def require_entra_config() -> None:
    """Fail startup fast when AUTH_PROVIDER=entra but config is incomplete."""
    for key in _REQUIRED_ENTRA_ENV_KEYS:
        if not os.getenv(key, "").strip():
            raise RuntimeError(f"Missing required env {key} for AUTH_PROVIDER=entra")
    if not _admin_allowlist():
        raise RuntimeError("AUTH_ADMIN_EMAILS must contain at least one email")


class EntraOIDCProvider:
    name = "entra"

    OAUTH_COOKIE_NAME = "on_oauth"
    OAUTH_COOKIE_MAX_AGE_SECONDS = 600  # 10 minutes, per design spec
    SCOPES = "openid profile email offline_access"

    def __init__(self) -> None:
        require_entra_config()
        self.tenant_id = os.environ["ENTRA_TENANT_ID"]
        self.client_id = os.environ["ENTRA_CLIENT_ID"]
        self.client_secret = os.environ["ENTRA_CLIENT_SECRET"]
        self.redirect_uri = os.environ["ENTRA_REDIRECT_URI"]
        # Model A deployment identifier stamped on rows - distinct from the
        # Entra app registration's client_id above.
        self.deployment_client_id = os.getenv("CLIENT_ID", "default")

    def auth_enabled(self) -> bool:
        # Entra mode is always fail-closed, unlike password mode's opt-in gate.
        return True

    async def authenticate_request(
        self, request: Request
    ) -> Optional[AuthenticatedUser]:
        raw_cookie = request.cookies.get(SESSION_COOKIE_NAME)
        if not raw_cookie:
            return None
        return await resolve_session(raw_cookie)

    async def begin_login(self, request: Request) -> Response:
        verifier = generate_verifier()
        challenge = generate_challenge(verifier)
        state = generate_state()
        # code_verifier is kept server-side, keyed by state - the cookie
        # below carries only the opaque state, so a tampered/forged cookie
        # can never supply an attacker-chosen verifier.
        await store_oauth_state(state, verifier)

        params: Dict[str, str] = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "response_mode": "query",
            "scope": self.SCOPES,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        # Optional Entra prompt (e.g. select_account). See Microsoft auth code docs.
        prompt = os.getenv("ENTRA_PROMPT", "").strip().lower()
        if prompt in {"login", "none", "consent", "select_account"}:
            params["prompt"] = prompt
        query = urlencode(params)
        authorize_url = (
            f"https://login.microsoftonline.com/{self.tenant_id}"
            f"/oauth2/v2.0/authorize?{query}"
        )

        response = RedirectResponse(url=authorize_url, status_code=302)
        response.set_cookie(
            self.OAUTH_COOKIE_NAME,
            state,
            max_age=self.OAUTH_COOKIE_MAX_AGE_SECONDS,
            httponly=True,
            samesite="lax",
            secure=cookie_secure(request),
            path="/",
        )
        return response

    async def handle_callback(self, request: Request) -> Response:
        error = request.query_params.get("error")
        if error:
            raise AuthenticationError(
                request.query_params.get("error_description", error)
            )

        code = request.query_params.get("code")
        returned_state = request.query_params.get("state")
        if not code or not returned_state:
            raise AuthenticationError("Callback missing code or state")

        oauth_cookie = request.cookies.get(self.OAUTH_COOKIE_NAME)
        if not oauth_cookie:
            raise AuthenticationError("Missing or expired login session")
        if not secrets.compare_digest(oauth_cookie, returned_state):
            raise AuthenticationError("Login state mismatch")

        verifier = await consume_oauth_state(returned_state)
        if not verifier:
            raise AuthenticationError("Missing or expired login session")

        tokens = await self._exchange_code(code, verifier)
        id_token = tokens.get("id_token")
        if not id_token:
            raise AuthenticationError("Token response missing id_token")

        claims = await validate_id_token(
            id_token, tenant_id=self.tenant_id, client_id=self.client_id
        )
        entra_oid: Optional[str] = claims.get("oid")
        email: Optional[str] = claims.get("email") or claims.get(
            "preferred_username"
        )
        if not entra_oid or not email:
            raise AuthenticationError("id_token missing oid/email claims")
        display_name: str = claims.get("name") or email

        user = await self._upsert_user(
            entra_oid=entra_oid, email=email, display_name=display_name
        )
        assert user.id is not None  # save() always assigns an id

        raw_cookie = await create_session(
            user.id, self._encrypt_refresh_token(tokens.get("refresh_token"))
        )

        response = RedirectResponse(url="/", status_code=302)
        response.delete_cookie(self.OAUTH_COOKIE_NAME, path="/")
        response.set_cookie(
            SESSION_COOKIE_NAME,
            raw_cookie,
            max_age=int(SESSION_LIFETIME.total_seconds()),
            httponly=True,
            samesite="lax",
            secure=cookie_secure(request),
            path="/",
        )
        return response

    async def logout(self, request: Request) -> Response:
        raw_cookie = request.cookies.get(SESSION_COOKIE_NAME)
        if raw_cookie:
            await delete_session(raw_cookie)
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
        return response

    async def _exchange_code(self, code: str, verifier: str) -> Dict[str, Any]:
        token_url = (
            f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        )
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
            "code_verifier": verifier,
            "scope": self.SCOPES,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(token_url, data=data)
        if response.status_code != 200:
            raise AuthenticationError(
                f"Entra token exchange failed: {response.status_code} {response.text}"
            )
        result: Dict[str, Any] = response.json()
        return result

    def _encrypt_refresh_token(self, refresh_token: Optional[str]) -> Optional[str]:
        """Best-effort: a missing encryption key must not break login."""
        if not refresh_token:
            return None
        try:
            return encrypt_value(refresh_token)
        except ValueError:
            return None

    async def _upsert_user(
        self, *, entra_oid: str, email: str, display_name: str
    ) -> User:
        existing = await repo_query(
            "SELECT id FROM user WHERE entra_oid = $entra_oid OR email = $email LIMIT 1;",
            {"entra_oid": entra_oid, "email": email},
        )
        user = User(
            id=existing[0]["id"] if existing else None,
            email=email,
            display_name=display_name,
            entra_oid=entra_oid,
            role=resolve_role(email),
            client_id=self.deployment_client_id,
        )
        await user.save()
        return user
