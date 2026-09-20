"""Tests for api.graph_client — app-only Microsoft Graph client.

Uses httpx.MockTransport (built into httpx) — no new dev dep.
"""

from __future__ import annotations

import time
from unittest.mock import patch

import httpx
import pytest

from api.graph_client import (
    _reset_token_cache,
    acquire_graph_token,
    get_group,
    list_group_member_oids,
    search_groups,
)


@pytest.fixture(autouse=True)
def _entra_env(monkeypatch):
    monkeypatch.setenv("ENTRA_TENANT_ID", "tenant-1")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "client-1")
    monkeypatch.setenv("ENTRA_CLIENT_SECRET", "secret-1")
    _reset_token_cache()
    yield
    _reset_token_cache()


_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock_client(handler) -> httpx.AsyncClient:
    return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler))


def _factory(handler):
    """Patch replacement for httpx.AsyncClient inside api.graph_client."""

    def _factory_impl(*_args, **_kwargs):
        return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler))

    return _factory_impl


@pytest.mark.asyncio
async def test_acquire_graph_token_hits_token_endpoint_once_within_window():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url)
        return httpx.Response(
            200, json={"access_token": "tok-1", "expires_in": 3600}
        )

    async with _mock_client(handler) as client:
        first = await acquire_graph_token(client)
        second = await acquire_graph_token(client)

    assert first == "tok-1"
    assert second == "tok-1"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_acquire_graph_token_refreshes_when_expired():
    counter = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        counter["n"] += 1
        return httpx.Response(
            200,
            json={"access_token": f"tok-{counter['n']}", "expires_in": 30},
        )

    async with _mock_client(handler) as client:
        first = await acquire_graph_token(client)
        with patch(
            "api.graph_client.time.monotonic",
            return_value=time.monotonic() + 3600,
        ):
            second = await acquire_graph_token(client)

    assert first == "tok-1"
    assert second == "tok-2"


@pytest.mark.asyncio
async def test_acquire_graph_token_raises_on_error_response():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="unauthorized")

    async with _mock_client(handler) as client:
        with pytest.raises(RuntimeError, match="401"):
            await acquire_graph_token(client)


@pytest.mark.asyncio
async def test_acquire_graph_token_requires_env():
    import os

    for var in ("ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET"):
        os.environ.pop(var, None)

    async with _mock_client(lambda r: httpx.Response(200, json={})) as client:
        with pytest.raises(RuntimeError, match="Entra group sync requires"):
            await acquire_graph_token(client)


# ---------------------------------------------------------------------------
# Search / get / members-paging helpers (Task 2)
# ---------------------------------------------------------------------------

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_TOKEN_URL = "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token"


def _auth_and(url_map: dict) -> "callable":
    """Handler factory: returns 200/tok for the token URL, otherwise dispatches by path."""

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(_TOKEN_URL):
            return httpx.Response(
                200, json={"access_token": "tok", "expires_in": 3600}
            )
        for key, resp in url_map.items():
            if str(request.url).startswith(key):
                return resp
        return httpx.Response(404, text=f"unexpected {request.url}")

    return handler


@pytest.mark.asyncio
async def test_search_groups_returns_top_matches_mapped():
    handler = _auth_and(
        {
            f"{_GRAPH_BASE}/groups": httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "oid-1",
                            "displayName": "Engineering",
                            "description": "d1",
                        },
                        {
                            "id": "oid-2",
                            "displayName": "Engineers - EMEA",
                            "description": None,
                        },
                    ]
                },
            )
        }
    )
    with patch(
        "api.graph_client.httpx.AsyncClient",
        _factory(handler),
    ):
        results = await search_groups("eng")

    assert results == [
        {
            "entra_group_oid": "oid-1",
            "display_name": "Engineering",
            "description": "d1",
        },
        {
            "entra_group_oid": "oid-2",
            "display_name": "Engineers - EMEA",
            "description": None,
        },
    ]


@pytest.mark.asyncio
async def test_search_groups_sends_consistency_level_eventual_header():
    seen_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(_TOKEN_URL):
            return httpx.Response(
                200, json={"access_token": "tok", "expires_in": 3600}
            )
        seen_headers.update(request.headers)
        return httpx.Response(200, json={"value": []})

    with patch(
        "api.graph_client.httpx.AsyncClient",
        _factory(handler),
    ):
        await search_groups("x")

    assert seen_headers.get("consistencylevel") == "eventual"


@pytest.mark.asyncio
async def test_get_group_returns_mapped_shape():
    handler = _auth_and(
        {
            f"{_GRAPH_BASE}/groups/oid-1": httpx.Response(
                200,
                json={
                    "id": "oid-1",
                    "displayName": "Engineering",
                    "description": "d1",
                },
            )
        }
    )
    with patch(
        "api.graph_client.httpx.AsyncClient",
        _factory(handler),
    ):
        result = await get_group("oid-1")

    assert result == {
        "entra_group_oid": "oid-1",
        "display_name": "Engineering",
        "description": "d1",
    }


@pytest.mark.asyncio
async def test_list_group_member_oids_walks_paging_and_filters_non_users():
    page1 = {
        "value": [
            {"@odata.type": "#microsoft.graph.user", "id": "u1"},
            {"@odata.type": "#microsoft.graph.servicePrincipal", "id": "sp1"},
            {"@odata.type": "#microsoft.graph.user", "id": "u2"},
        ],
        "@odata.nextLink": f"{_GRAPH_BASE}/groups/oid-1/members?$skiptoken=p2",
    }
    page2 = {
        "value": [{"@odata.type": "#microsoft.graph.user", "id": "u3"}]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(_TOKEN_URL):
            return httpx.Response(
                200, json={"access_token": "tok", "expires_in": 3600}
            )
        url = str(request.url)
        if "$skiptoken=p2" in url:
            return httpx.Response(200, json=page2)
        if url.startswith(f"{_GRAPH_BASE}/groups/oid-1/members"):
            return httpx.Response(200, json=page1)
        return httpx.Response(404, text=f"unexpected {url}")

    with patch(
        "api.graph_client.httpx.AsyncClient",
        _factory(handler),
    ):
        oids = await list_group_member_oids("oid-1")

    assert oids == ["u1", "u2", "u3"]


@pytest.mark.asyncio
async def test_list_group_member_oids_empty_group():
    handler = _auth_and(
        {
            f"{_GRAPH_BASE}/groups/empty/members": httpx.Response(
                200, json={"value": []}
            )
        }
    )
    with patch(
        "api.graph_client.httpx.AsyncClient",
        _factory(handler),
    ):
        oids = await list_group_member_oids("empty")
    assert oids == []
