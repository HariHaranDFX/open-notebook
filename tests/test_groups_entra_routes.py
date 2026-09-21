"""Tests for the Entra-linked-group routes on api/routers/groups.py.

Follows the same middleware-stamped-user pattern as
tests/test_source_file_cleanup.py — no real auth stack required.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

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


def test_search_graph_403_returns_502_with_group_permission_hint(monkeypatch):
    """403 on the group flow → names the group-membership permission."""
    from api.graph_client import GraphAPIError

    def raise_auth(*_a, **_kw):
        raise GraphAPIError(403, "search", '{"error":"Authorization_RequestDenied"}')

    with patch("api.routers.groups.search_groups", new=AsyncMock(side_effect=raise_auth)):
        r = _client(monkeypatch).get("/api/groups/entra/search?q=dfx")
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "Microsoft Graph refused the request" in detail
    assert "group membership permission" in detail
    assert "admin consent" in detail
    # The raw Microsoft slug is intentionally NOT in the toast (admins get
    # a plain description; the slug lives in docs/AUTH.md).
    assert "GroupMember.Read.All" not in detail


def test_search_graph_401_names_credential_failure(monkeypatch):
    """401 → the app credentials are the problem, not a missing permission."""
    from api.graph_client import GraphAPIError

    def raise_creds(*_a, **_kw):
        raise GraphAPIError(401, "search", "unauthorized")

    with patch("api.routers.groups.search_groups", new=AsyncMock(side_effect=raise_creds)):
        r = _client(monkeypatch).get("/api/groups/entra/search?q=x")
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "credentials" in detail
    assert "client secret" in detail


def test_search_graph_500_returns_generic_upstream(monkeypatch):
    from api.graph_client import GraphAPIError

    def raise_upstream(*_a, **_kw):
        raise GraphAPIError(500, "search", "internal error")

    with patch("api.routers.groups.search_groups", new=AsyncMock(side_effect=raise_upstream)):
        r = _client(monkeypatch).get("/api/groups/entra/search?q=x")
    assert r.status_code == 502
    assert "Microsoft Graph returned an upstream error" in r.json()["detail"]


def test_link_graph_403_returns_502_with_group_hint(monkeypatch):
    from api.graph_client import GraphAPIError

    def raise_auth(*_a, **_kw):
        raise GraphAPIError(403, "get_group", "denied")

    with patch("api.routers.groups.graph_get_group", new=AsyncMock(side_effect=raise_auth)):
        r = _client(monkeypatch).post(
            "/api/groups/entra/link", json={"entra_group_oid": "e1"}
        )
    assert r.status_code == 502
    detail = r.json()["detail"]
    assert "group membership permission" in detail


def test_search_empty_query_now_browses_top_25(monkeypatch):
    """Empty query used to short-circuit; WBS 4.21 fix routes it to Graph
    for a browse-mode fetch of the first ~25 groups alphabetically."""
    with patch(
        "api.routers.groups.search_groups",
        new=AsyncMock(return_value=[]),
    ) as mock_search:
        r = _client(monkeypatch).get("/api/groups/entra/search?q=%20%20")
    assert r.status_code == 200
    assert r.json() == []
    mock_search.assert_awaited_once()


def test_sync_requires_sync_enabled_env(monkeypatch):
    """Manual /sync fails cleanly with a human message when disabled."""
    monkeypatch.delenv("ENTRA_GROUP_SYNC_ENABLED", raising=False)
    r = _client(monkeypatch).post("/api/groups/entra/sync")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "not enabled" in detail
    # Never surface the raw env var name — that lives in docs, not the UI.
    assert "ENTRA_GROUP_SYNC_ENABLED" not in detail


def test_sync_when_enabled_submits_command(monkeypatch):
    monkeypatch.setenv("ENTRA_GROUP_SYNC_ENABLED", "true")
    with patch(
        "api.routers.groups.submit_command",
        new=MagicMock(return_value="cmd:1"),
    ):
        r = _client(monkeypatch).post("/api/groups/entra/sync")
    assert r.status_code == 200
    assert r.json() == {"command_id": "cmd:1"}


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
        "api.routers.groups.sync_entra_groups_command",
        new=AsyncMock(),
    ) as inline_sync:
        r = _client(monkeypatch).post(
            "/api/groups/entra/link", json={"entra_group_oid": "e1"}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "entra"
    assert body["entra_group_oid"] == "e1"
    # Scoped sync ran INLINE so the response reflects populated members
    # — no more "no members" until the worker catches up.
    inline_sync.assert_awaited_once()
    await_args = inline_sync.await_args
    assert await_args is not None  # narrows for mypy
    (input_arg,) = await_args.args
    assert input_arg.group_id == "user_group:new"


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
        "api.routers.groups.sync_entra_groups_command",
        new=AsyncMock(),
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


def test_link_still_succeeds_when_inline_sync_fails(monkeypatch):
    """If the scoped sync raises, the group row is already in place —
    the periodic loop will pick it up on its next tick. Never bounce
    the admin's Link click over a transient Graph hiccup."""

    async def fake_repo_query(query, params=None):
        q = " ".join(query.split()).lower()
        if "select id from user_group where entra_group_oid" in q:
            return []
        if q.startswith("create user_group"):
            return [
                {
                    "id": "user_group:new",
                    "name": "Eng",
                    "description": None,
                    "source": "entra",
                    "entra_group_oid": "e1",
                }
            ]
        if q.startswith("select * from") and "$gid" in q:
            return [
                {
                    "id": "user_group:new",
                    "name": "Eng",
                    "description": None,
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
                "description": None,
            }
        ),
    ), patch(
        "api.routers.groups.repo_query",
        new=AsyncMock(side_effect=fake_repo_query),
    ), patch(
        "api.routers.groups.sync_entra_groups_command",
        new=AsyncMock(side_effect=RuntimeError("Graph 500 mid-sync")),
    ):
        r = _client(monkeypatch).post(
            "/api/groups/entra/link", json={"entra_group_oid": "e1"}
        )

    assert r.status_code == 200
    assert r.json()["id"] == "user_group:new"


# ---------------------------------------------------------------------------
# /api/groups/entra/sync
# ---------------------------------------------------------------------------


def test_sync_admin_only_and_returns_command_id(monkeypatch):
    # WBS 4.21 gates this endpoint on the sync-enabled flag; enable it here.
    monkeypatch.setenv("ENTRA_GROUP_SYNC_ENABLED", "true")
    with patch(
        "api.routers.groups.submit_command",
        new=MagicMock(return_value="cmd-42"),
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
