"""Tests for api.graph_client user-directory helpers added in WBS 4.21."""

from __future__ import annotations

from typing import Callable
from unittest.mock import patch

import httpx
import pytest

from api.graph_client import (
    GraphAPIError,
    _reset_token_cache,
    get_user,
    list_users_by_oids,
    search_users,
)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_TOKEN_URL = "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token"
_REAL_ASYNC_CLIENT = httpx.AsyncClient


@pytest.fixture(autouse=True)
def _entra_env(monkeypatch):
    monkeypatch.setenv("ENTRA_TENANT_ID", "tenant-1")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "client-1")
    monkeypatch.setenv("ENTRA_CLIENT_SECRET", "secret-1")
    _reset_token_cache()
    yield
    _reset_token_cache()


def _factory(handler):
    def _factory_impl(*_args, **_kwargs):
        return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler))

    return _factory_impl


def _auth_and(url_map: dict) -> Callable[[httpx.Request], httpx.Response]:
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
async def test_search_users_returns_mapped_results_and_prefers_mail():
    handler = _auth_and(
        {
            f"{_GRAPH_BASE}/users": httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "oid-1",
                            "mail": "alice@example.com",
                            "userPrincipalName": "alice@example.onmicrosoft.com",
                            "displayName": "Alice",
                        },
                        {
                            "id": "oid-2",
                            "mail": None,
                            "userPrincipalName": "bob@example.onmicrosoft.com",
                            "displayName": "Bob",
                        },
                    ]
                },
            )
        }
    )
    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        results = await search_users("al")

    assert results == [
        {
            "entra_oid": "oid-1",
            "email": "alice@example.com",
            "display_name": "Alice",
        },
        {
            "entra_oid": "oid-2",
            "email": "bob@example.onmicrosoft.com",
            "display_name": "Bob",
        },
    ]


@pytest.mark.asyncio
async def test_search_users_sends_eventual_consistency_and_search_expr():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(_TOKEN_URL):
            return httpx.Response(
                200, json={"access_token": "tok", "expires_in": 3600}
            )
        captured["headers"] = dict(request.headers).get("consistencylevel", "")
        captured["query"] = str(request.url)
        return httpx.Response(200, json={"value": []})

    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        await search_users("dfx")

    from urllib.parse import unquote

    assert captured["headers"] == "eventual"
    decoded = unquote(captured["query"])
    assert "displayName:dfx" in decoded
    assert "mail:dfx" in decoded


@pytest.mark.asyncio
async def test_search_users_raises_graph_api_error_on_403():
    handler = _auth_and(
        {f"{_GRAPH_BASE}/users": httpx.Response(403, text="denied")}
    )
    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        with pytest.raises(GraphAPIError) as exc:
            await search_users("x")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_get_user_returns_mapped_shape_and_404_raises():
    handler = _auth_and(
        {
            f"{_GRAPH_BASE}/users/oid-1": httpx.Response(
                200,
                json={
                    "id": "oid-1",
                    "mail": "a@x",
                    "userPrincipalName": "a@x",
                    "displayName": "Alice",
                },
            ),
            f"{_GRAPH_BASE}/users/missing": httpx.Response(404, text="not found"),
        }
    )
    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        result = await get_user("oid-1")
        assert result == {
            "entra_oid": "oid-1",
            "email": "a@x",
            "display_name": "Alice",
        }
        with pytest.raises(GraphAPIError) as exc:
            await get_user("missing")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_list_users_by_oids_chunks_at_15():
    """Graph URL limit — verify we send exactly ceil(len/15) requests."""
    seen_queries: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).startswith(_TOKEN_URL):
            return httpx.Response(
                200, json={"access_token": "tok", "expires_in": 3600}
            )
        seen_queries.append(str(request.url))
        # Echo back the ids in the filter so we can verify the payload shape.
        return httpx.Response(200, json={"value": []})

    oids = [f"oid-{i}" for i in range(33)]  # 15+15+3 → 3 chunks
    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        await list_users_by_oids(oids)
    assert len(seen_queries) == 3
    for query in seen_queries:
        assert "id+in+" in query or "id%20in%20" in query or "id in " in query


@pytest.mark.asyncio
async def test_list_users_by_oids_empty_returns_empty_without_calling_graph():
    def handler(_req: httpx.Request) -> httpx.Response:
        raise AssertionError("should not be called")

    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        assert await list_users_by_oids([]) == []


@pytest.mark.asyncio
async def test_list_users_by_oids_raises_on_upstream_error():
    handler = _auth_and(
        {f"{_GRAPH_BASE}/users": httpx.Response(500, text="upstream")}
    )
    with patch("api.graph_client.httpx.AsyncClient", _factory(handler)):
        with pytest.raises(GraphAPIError):
            await list_users_by_oids(["oid-1"])
