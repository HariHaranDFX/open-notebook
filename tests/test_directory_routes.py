"""Tests for WBS 4.21 directory + from-entra routes on api/routers/groups.py.

Follows the same middleware-stamped-user pattern as
tests/test_groups_entra_routes.py.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.auth.types import AuthenticatedUser
from api.graph_client import GraphAPIError
from api.routers import groups as groups_router


class _EnabledAuth:
    def auth_enabled(self) -> bool:
        return True


def _client(monkeypatch, *, role: str = "user") -> TestClient:
    """Non-admin by default — directory + from-entra are user-callable."""
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory, "build_auth_provider", lambda: _EnabledAuth()
    )
    app = FastAPI()

    @app.middleware("http")
    async def stamp_user(request: Request, call_next):
        request.state.user = AuthenticatedUser(
            id="user:caller",
            email="caller@example.com",
            display_name="Caller",
            role=role,  # type: ignore[arg-type]
            entra_oid=None,
            client_id="c1",
        )
        return await call_next(request)

    app.include_router(groups_router.router, prefix="/api")
    return TestClient(app)


# ---------------------------------------------------------------------------
# GET /api/users/directory
# ---------------------------------------------------------------------------


def test_directory_search_returns_mapped_hits(monkeypatch):
    payload = [
        {"entra_oid": "oid-1", "email": "alice@x", "display_name": "Alice"},
        {"entra_oid": "oid-2", "email": "bob@x", "display_name": "Bob"},
    ]
    with patch(
        "api.routers.groups.search_users",
        new=AsyncMock(return_value=payload),
    ):
        r = _client(monkeypatch).get("/api/users/directory?q=al")
    assert r.status_code == 200
    assert r.json() == payload


def test_directory_search_empty_query_returns_empty_without_calling_graph(monkeypatch):
    mock = AsyncMock()
    with patch("api.routers.groups.search_users", new=mock):
        r = _client(monkeypatch).get("/api/users/directory?q=%20")
    assert r.status_code == 200
    assert r.json() == []
    mock.assert_not_called()


def test_directory_search_graph_403_returns_502_with_hint(monkeypatch):
    def raise_auth(*_a, **_kw):
        raise GraphAPIError(403, "search users", "denied")

    with patch("api.routers.groups.search_users", new=AsyncMock(side_effect=raise_auth)):
        r = _client(monkeypatch).get("/api/users/directory?q=x")
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "Microsoft Graph rejected" in detail
    # The router's 401/403 hint is shared with the group-sync path; it
    # names GroupMember.Read.All. Directory picker docs also list
    # User.Read.All — verified in AUTH.md, not in the toast.


# ---------------------------------------------------------------------------
# POST /api/users/from-entra
# ---------------------------------------------------------------------------


def _fake_repo_query(script: dict[str, Any]):
    """AsyncMock that returns pre-seeded results based on the SQL substring.

    Very small state machine: keys are substrings, values are lists of
    responses to return in order. Missing keys default to [].
    """
    calls: list[tuple[str, dict[str, Any]]] = []

    async def _run(sql: str, params: dict[str, Any] | None = None):
        calls.append((sql, params or {}))
        for needle, queue in script.items():
            if needle in sql:
                if isinstance(queue, list) and queue:
                    return queue.pop(0)
                return queue
        return []

    _run.calls = calls  # type: ignore[attr-defined]
    return _run


def test_from_entra_fast_path_when_user_already_exists(monkeypatch):
    script = {
        "WHERE entra_oid = $oid LIMIT 1": [
            [{"id": "user:1", "email": "a@x", "display_name": "Alice"}]
        ],
        "auth_session WHERE user IN": [
            [{"user": "user:1"}]
        ],  # not pending
    }
    with (
        patch("api.routers.groups.repo_query", new=_fake_repo_query(script)),
        patch("api.routers.groups.graph_get_user", new=AsyncMock()) as get_user,
    ):
        r = _client(monkeypatch).post(
            "/api/users/from-entra", json={"entra_oid": "oid-1"}
        )
    assert r.status_code == 200
    assert r.json() == {
        "id": "user:1",
        "email": "a@x",
        "display_name": "Alice",
        "pending": False,
    }
    get_user.assert_not_called()


def test_from_entra_stubs_new_user_from_graph(monkeypatch):
    script = {
        "WHERE entra_oid = $oid LIMIT 1": [[]],  # not existing
        "WHERE email = $email LIMIT 1": [[]],  # no email row either
        "CREATE user SET": [
            [{"id": "user:99", "email": "new@x", "display_name": "New Person"}]
        ],
    }
    graph_profile = {
        "entra_oid": "oid-99",
        "email": "new@x",
        "display_name": "New Person",
    }
    with (
        patch("api.routers.groups.repo_query", new=_fake_repo_query(script)),
        patch(
            "api.routers.groups.graph_get_user",
            new=AsyncMock(return_value=graph_profile),
        ),
    ):
        r = _client(monkeypatch).post(
            "/api/users/from-entra", json={"entra_oid": "oid-99"}
        )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "user:99"
    assert body["email"] == "new@x"
    assert body["pending"] is True


def test_from_entra_forged_oid_returns_400(monkeypatch):
    """Graph 404 → the client sent a bad OID; must surface as 400, not 502."""
    script: dict[str, Any] = {"WHERE entra_oid = $oid LIMIT 1": [[]]}
    with (
        patch("api.routers.groups.repo_query", new=_fake_repo_query(script)),
        patch(
            "api.routers.groups.graph_get_user",
            new=AsyncMock(side_effect=GraphAPIError(404, "get_user", "not found")),
        ),
    ):
        r = _client(monkeypatch).post(
            "/api/users/from-entra", json={"entra_oid": "forged"}
        )
    assert r.status_code == 400
    assert "No such user" in r.json()["detail"]


def test_from_entra_patches_existing_email_row_without_entra_oid(monkeypatch):
    script = {
        "WHERE entra_oid = $oid LIMIT 1": [[]],
        "WHERE email = $email LIMIT 1": [
            [
                {
                    "id": "user:42",
                    "email": "hand@x",
                    "display_name": "Hand Created",
                    "entra_oid": None,
                }
            ]
        ],
        # UPDATE $uid SET entra_oid — no return needed
        "UPDATE $uid SET entra_oid": [[]],
        "auth_session WHERE user IN": [[]],
    }
    with (
        patch("api.routers.groups.repo_query", new=_fake_repo_query(script)),
        patch(
            "api.routers.groups.graph_get_user",
            new=AsyncMock(
                return_value={
                    "entra_oid": "oid-42",
                    "email": "hand@x",
                    "display_name": "Hand Created",
                }
            ),
        ),
    ):
        r = _client(monkeypatch).post(
            "/api/users/from-entra", json={"entra_oid": "oid-42"}
        )
    assert r.status_code == 200
    assert r.json()["id"] == "user:42"
    assert r.json()["pending"] is True  # no session row


def test_from_entra_requires_authentication(monkeypatch):
    """Not authenticated → 401."""
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory, "build_auth_provider", lambda: _EnabledAuth()
    )
    app = FastAPI()

    @app.middleware("http")
    async def stamp_no_user(request: Request, call_next):
        return await call_next(request)

    app.include_router(groups_router.router, prefix="/api")
    r = TestClient(app).post(
        "/api/users/from-entra", json={"entra_oid": "oid-1"}
    )
    assert r.status_code == 401


def test_from_entra_graph_returns_user_without_email_is_rejected(monkeypatch):
    """A guest with no mail AND no UPN → refuse rather than write junk."""
    script: dict[str, Any] = {"WHERE entra_oid = $oid LIMIT 1": [[]]}
    with (
        patch("api.routers.groups.repo_query", new=_fake_repo_query(script)),
        patch(
            "api.routers.groups.graph_get_user",
            new=AsyncMock(
                return_value={
                    "entra_oid": "oid-e",
                    "email": "",
                    "display_name": "Empty",
                }
            ),
        ),
    ):
        r = _client(monkeypatch).post(
            "/api/users/from-entra", json={"entra_oid": "oid-e"}
        )
    assert r.status_code == 400
    assert "no email" in r.json()["detail"].lower()
