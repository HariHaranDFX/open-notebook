from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from api.auth import oauth_state


@pytest.mark.asyncio
async def test_store_oauth_state_persists_verifier_with_short_expiry(monkeypatch):
    create = AsyncMock()
    monkeypatch.setattr(oauth_state, "repo_create", create)

    await oauth_state.store_oauth_state("state-1", "verifier-1")

    table, data = create.await_args.args
    assert table == "oauth_state"
    assert data["state"] == "state-1"
    assert data["code_verifier"] == "verifier-1"
    assert data["expires_at"] > datetime.now(timezone.utc) + timedelta(minutes=9)
    assert data["expires_at"] <= datetime.now(timezone.utc) + timedelta(minutes=10)


@pytest.mark.asyncio
async def test_consume_oauth_state_returns_verifier_and_deletes_row(monkeypatch):
    query = AsyncMock(
        return_value=[
            {
                "id": "oauth_state:1",
                "code_verifier": "verifier-1",
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            }
        ]
    )
    delete = AsyncMock()
    monkeypatch.setattr(oauth_state, "repo_query", query)
    monkeypatch.setattr(oauth_state, "repo_delete", delete)

    verifier = await oauth_state.consume_oauth_state("state-1")

    assert verifier == "verifier-1"
    delete.assert_awaited_once_with("oauth_state:1")
    assert query.await_args.args[1] == {"state": "state-1"}


@pytest.mark.asyncio
async def test_consume_oauth_state_returns_none_when_unknown(monkeypatch):
    monkeypatch.setattr(oauth_state, "repo_query", AsyncMock(return_value=[]))
    delete = AsyncMock()
    monkeypatch.setattr(oauth_state, "repo_delete", delete)

    assert await oauth_state.consume_oauth_state("unknown-state") is None
    delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_consume_oauth_state_returns_none_when_expired(monkeypatch):
    query = AsyncMock(
        return_value=[
            {
                "id": "oauth_state:1",
                "code_verifier": "verifier-1",
                "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
            }
        ]
    )
    delete = AsyncMock()
    monkeypatch.setattr(oauth_state, "repo_query", query)
    monkeypatch.setattr(oauth_state, "repo_delete", delete)

    verifier = await oauth_state.consume_oauth_state("state-1")

    assert verifier is None
    delete.assert_awaited_once_with("oauth_state:1")  # one-time use even when expired


@pytest.mark.asyncio
async def test_consume_oauth_state_handles_string_expiry(monkeypatch):
    future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace(
        "+00:00", "Z"
    )
    monkeypatch.setattr(
        oauth_state,
        "repo_query",
        AsyncMock(
            return_value=[
                {"id": "oauth_state:1", "code_verifier": "verifier-1", "expires_at": future}
            ]
        ),
    )
    monkeypatch.setattr(oauth_state, "repo_delete", AsyncMock())

    assert await oauth_state.consume_oauth_state("state-1") == "verifier-1"
