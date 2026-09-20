"""Tests for the Entra-linked-group routes on api/routers/groups.py.

Follows the same middleware-stamped-user pattern as
tests/test_source_file_cleanup.py — no real auth stack required.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.auth.types import AuthenticatedUser
from api.routers import groups as groups_router


class _EnabledAuth:
    def auth_enabled(self) -> bool:
        return True


def _client(monkeypatch, *, role: str = "admin") -> TestClient:
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory,
        "build_auth_provider",
        lambda: _EnabledAuth(),
    )
    app = FastAPI()

    @app.middleware("http")
    async def stamp_user(request: Request, call_next):
        request.state.user = AuthenticatedUser(
            id="user:admin",
            email="admin@example.com",
            display_name="Admin",
            role=role,  # type: ignore[arg-type]
            entra_oid=None,
            client_id="c1",
        )
        return await call_next(request)

    app.include_router(groups_router.router, prefix="/api")
    return TestClient(app)


# ---------------------------------------------------------------------------
# /api/groups/entra/search
# ---------------------------------------------------------------------------


def test_search_returns_mapped_results_for_admin(monkeypatch):
    with patch(
        "api.routers.groups.search_groups",
        new=AsyncMock(
            return_value=[
                {
                    "entra_group_oid": "e1",
                    "display_name": "Eng",
                    "description": None,
                }
            ]
        ),
    ):
        r = _client(monkeypatch).get("/api/groups/entra/search?q=eng")
    assert r.status_code == 200
    assert r.json() == [
        {"entra_group_oid": "e1", "display_name": "Eng", "description": None}
    ]


def test_search_forbidden_for_non_admin(monkeypatch):
    r = _client(monkeypatch, role="user").get(
        "/api/groups/entra/search?q=eng"
    )
    assert r.status_code == 403


def test_search_empty_query_returns_empty_list_without_graph_call(monkeypatch):
    with patch(
        "api.routers.groups.search_groups",
        new=AsyncMock(),
    ) as mock_search:
        r = _client(monkeypatch).get("/api/groups/entra/search?q=%20%20")
    assert r.status_code == 200
    assert r.json() == []
    mock_search.assert_not_called()


# ---------------------------------------------------------------------------
# /api/groups/entra/link
# ---------------------------------------------------------------------------


def test_link_creates_row_and_submits_scoped_sync(monkeypatch):
    calls: list[str] = []

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        calls.append(q)
        if "select id from user_group where entra_group_oid" in q:
            return []
        if q.startswith("create user_group"):
            return [
                {
                    "id": "user_group:new",
                    "name": "Eng",
                    "description": "d",
                    "source": "entra",
                    "entra_group_oid": "e1",
                }
            ]
        if q.startswith("select * from") and "$gid" in q:
            # Snapshot returned by get_group after the CREATE.
            return [
                {
                    "id": "user_group:new",
                    "name": "Eng",
                    "description": "d",
                    "source": "entra",
                    "entra_group_oid": "e1",
                }
            ]
        if "select count()" in q:
            return [{"c": 0}]
        return []

    with patch(
        "api.routers.groups.graph_get_group",
        new=AsyncMock(
            return_value={
                "entra_group_oid": "e1",
                "display_name": "Eng",
                "description": "d",
            }
        ),
    ), patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ), patch(
        "api.routers.groups.submit_command",
        new=AsyncMock(return_value="cmd-1"),
    ) as submit:
        r = _client(monkeypatch).post(
            "/api/groups/entra/link", json={"entra_group_oid": "e1"}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "entra"
    assert body["entra_group_oid"] == "e1"
    submit.assert_awaited_once()  # scoped sync kicked off


def test_link_is_idempotent(monkeypatch):
    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select id from user_group where entra_group_oid" in q:
            return [{"id": "user_group:existing"}]
        if "select * from" in q and "$gid" in q:
            return [
                {
                    "id": "user_group:existing",
                    "name": "Eng",
                    "description": None,
                    "source": "entra",
                    "entra_group_oid": "e1",
                }
            ]
        if "select count()" in q:
            return [{"c": 3}]
        return []

    with patch(
        "api.routers.groups.graph_get_group",
        new=AsyncMock(
            return_value={
                "entra_group_oid": "e1",
                "display_name": "Eng",
                "description": None,
            }
        ),
    ), patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ), patch(
        "api.routers.groups.submit_command",
        new=AsyncMock(return_value="cmd-2"),
    ):
        r = _client(monkeypatch).post(
            "/api/groups/entra/link", json={"entra_group_oid": "e1"}
        )

    assert r.status_code == 200
    assert r.json()["id"] == "user_group:existing"


def test_link_forbidden_for_non_admin(monkeypatch):
    r = _client(monkeypatch, role="user").post(
        "/api/groups/entra/link", json={"entra_group_oid": "e1"}
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# /api/groups/entra/sync
# ---------------------------------------------------------------------------


def test_sync_admin_only_and_returns_command_id(monkeypatch):
    with patch(
        "api.routers.groups.submit_command",
        new=AsyncMock(return_value="cmd-42"),
    ):
        r = _client(monkeypatch).post("/api/groups/entra/sync")
    assert r.status_code == 200
    assert r.json() == {"command_id": "cmd-42"}


def test_sync_forbidden_for_non_admin(monkeypatch):
    r = _client(monkeypatch, role="user").post("/api/groups/entra/sync")
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Write-protection on source='entra' groups
# ---------------------------------------------------------------------------


def _fake_entra_group_query(source="entra"):
    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select source from" in q and "$gid" in q:
            return [{"source": source}]
        if "select" in q and "from" in q and "$gid" in q:
            # Full-row SELECT used elsewhere.
            return [
                {
                    "id": "user_group:g1",
                    "name": "Eng",
                    "description": None,
                    "source": source,
                    "entra_group_oid": "e1",
                }
            ]
        return []

    return fake_repo_query


def test_patch_refused_when_source_is_entra(monkeypatch):
    with patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=_fake_entra_group_query()),
    ):
        r = _client(monkeypatch).patch(
            "/api/groups/user_group:g1", json={"name": "hijack"}
        )
    assert r.status_code == 409


def test_add_member_refused_when_group_is_entra(monkeypatch):
    with patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=_fake_entra_group_query()),
    ):
        r = _client(monkeypatch).post(
            "/api/groups/user_group:g1/members",
            json={"user_id": "user:x"},
        )
    assert r.status_code == 409


def test_remove_member_refused_when_group_is_entra(monkeypatch):
    with patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=_fake_entra_group_query()),
    ):
        r = _client(monkeypatch).delete(
            "/api/groups/user_group:g1/members/user:x"
        )
    assert r.status_code == 409


def test_patch_still_works_on_local_group(monkeypatch):
    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select source from" in q and "$gid" in q:
            return [{"source": "local"}]
        if q.startswith("select * from") and "$gid" in q:
            return [
                {
                    "id": "user_group:g1",
                    "name": "New name",
                    "description": None,
                    "source": "local",
                    "entra_group_oid": None,
                }
            ]
        if "select count()" in q:
            return [{"c": 0}]
        return []

    with patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ):
        r = _client(monkeypatch).patch(
            "/api/groups/user_group:g1", json={"name": "New name"}
        )
    assert r.status_code == 200
    assert r.json()["source"] == "local"
