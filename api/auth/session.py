import os
import secrets
from dataclasses import fields
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any, Optional

from api.auth.types import AuthenticatedUser
from open_notebook.database.repository import (
    ensure_record_id,
    repo_create,
    repo_delete,
    repo_query,
)

SESSION_COOKIE_NAME = "on_session"
SESSION_LIFETIME = timedelta(hours=int(os.getenv("AUTH_SESSION_HOURS", "8")))
_AUTH_USER_FIELDS = {f.name for f in fields(AuthenticatedUser)}


def _hash_session(raw_cookie: str) -> str:
    return sha256(raw_cookie.encode()).hexdigest()


def _authenticated_user_from_record(user: dict[str, Any]) -> AuthenticatedUser:
    """Map a Surreal user row to AuthenticatedUser, dropping DB-only columns."""
    return AuthenticatedUser(
        **{name: user[name] for name in _AUTH_USER_FIELDS if name in user}
    )


async def create_session(
    user_id: str, refresh_token_enc: Optional[str] = None
) -> str:
    raw_cookie = secrets.token_urlsafe(32)
    await repo_create(
        "auth_session",
        {
            "session_token_hash": _hash_session(raw_cookie),
            "user": ensure_record_id(user_id),
            "expires_at": datetime.now(timezone.utc) + SESSION_LIFETIME,
            "entra_refresh_token_enc": refresh_token_enc,
        },
    )
    return raw_cookie


async def resolve_session(raw_cookie: str) -> Optional[AuthenticatedUser]:
    sessions = await repo_query(
        """
        SELECT * FROM auth_session
        WHERE session_token_hash = $session_token_hash
        AND expires_at > time::now()
        LIMIT 1 FETCH user;
        """,
        {"session_token_hash": _hash_session(raw_cookie)},
    )
    if not sessions:
        return None

    session = sessions[0]
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None

    user: dict[str, Any] = session["user"]
    return _authenticated_user_from_record(user)


async def delete_session(raw_cookie: str) -> None:
    sessions = await repo_query(
        "SELECT id FROM auth_session WHERE session_token_hash = $session_token_hash;",
        {"session_token_hash": _hash_session(raw_cookie)},
    )
    for session in sessions:
        await repo_delete(session["id"])
