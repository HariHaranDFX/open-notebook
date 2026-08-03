from datetime import datetime, timedelta, timezone
from hashlib import sha256
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from api.auth import session
from api.auth.deps import require_admin, require_user
from api.auth.types import AuthenticatedUser


def make_request(user: AuthenticatedUser | None = None) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/api/x"})
    request.state.user = user
    return request


@pytest.mark.asyncio
async def test_create_session_stores_only_cookie_hash(monkeypatch):
    create = AsyncMock()
    monkeypatch.setattr(session, "repo_create", create)

    raw_cookie = await session.create_session("user:1", "encrypted-refresh-token")

    assert raw_cookie != sha256(raw_cookie.encode()).hexdigest()
    table, data = create.await_args.args
    assert table == "auth_session"
    assert data["session_token_hash"] == sha256(raw_cookie.encode()).hexdigest()
    assert data["user"] == "user:1"
    assert data["entra_refresh_token_enc"] == "encrypted-refresh-token"
    assert data["expires_at"] > datetime.now(timezone.utc) + timedelta(days=6)


@pytest.mark.asyncio
async def test_resolve_session_returns_linked_user(monkeypatch):
    user = {
        "id": "user:1",
        "email": "user@example.com",
        "display_name": "Test User",
        "role": "user",
        "entra_oid": "entra-1",
        "client_id": "client-1",
    }
    query = AsyncMock(
        return_value=[
            {
                "user": user,
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
            }
        ]
    )
    monkeypatch.setattr(session, "repo_query", query)

    resolved = await session.resolve_session("raw-cookie")

    assert resolved == AuthenticatedUser(**user)
    assert query.await_args.args[1]["session_token_hash"] == sha256(
        b"raw-cookie"
    ).hexdigest()


@pytest.mark.asyncio
async def test_resolve_session_rejects_expired_session(monkeypatch):
    query = AsyncMock(
        return_value=[
            {
                "user": {
                    "id": "user:1",
                    "email": "user@example.com",
                    "display_name": "Test User",
                    "role": "user",
                    "entra_oid": None,
                    "client_id": "client-1",
                },
                "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
            }
        ]
    )
    monkeypatch.setattr(session, "repo_query", query)

    assert await session.resolve_session("raw-cookie") is None


@pytest.mark.asyncio
async def test_delete_session_removes_matching_record(monkeypatch):
    query = AsyncMock(return_value=[{"id": "auth_session:1"}])
    delete = AsyncMock()
    monkeypatch.setattr(session, "repo_query", query)
    monkeypatch.setattr(session, "repo_delete", delete)

    await session.delete_session("raw-cookie")

    assert delete.await_args.args == ("auth_session:1",)
    assert query.await_args.args[1]["session_token_hash"] == sha256(
        b"raw-cookie"
    ).hexdigest()


def test_require_user_rejects_anonymous_request():
    with pytest.raises(HTTPException, match="Not authenticated") as exc_info:
        require_user(make_request())

    assert exc_info.value.status_code == 401


def test_require_admin_rejects_regular_user():
    user = AuthenticatedUser(
        id="user:1",
        email="user@example.com",
        display_name="Test User",
        role="user",
        entra_oid=None,
        client_id="client-1",
    )

    with pytest.raises(HTTPException, match="Admin required") as exc_info:
        require_admin(make_request(user))

    assert exc_info.value.status_code == 403


def test_require_admin_returns_admin():
    admin = AuthenticatedUser(
        id="user:1",
        email="admin@example.com",
        display_name="Admin",
        role="admin",
        entra_oid=None,
        client_id="client-1",
    )

    assert require_admin(make_request(admin)) is admin
