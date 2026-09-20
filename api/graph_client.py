"""Microsoft Graph client — app-only auth + shared HTTP concerns.

Client-credentials flow against the existing Entra app registration
(ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET). Requires the
`GroupMember.Read.All` application permission with admin consent.

Nothing here runs unless the caller (sync command or admin route) invokes
it; deployments that leave ENTRA_GROUP_SYNC_ENABLED unset never call these
functions.
"""

from __future__ import annotations

import os
import time
from typing import Any, Optional

import httpx

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_TOKEN_CACHE: Optional[tuple[str, float]] = None


class GraphAPIError(RuntimeError):
    """Raised when Microsoft Graph returns a non-2xx.

    Carries the HTTP status so callers can distinguish
    consent/permission problems (401/403) from transient upstream
    failures (5xx) and craft actionable messages.
    """

    def __init__(self, status_code: int, action: str, body: str) -> None:
        self.status_code = status_code
        self.action = action
        self.body = body
        super().__init__(f"Graph {action} failed: {status_code} {body}")


def _reset_token_cache() -> None:
    """Test-only helper — clears the module-level token cache."""
    global _TOKEN_CACHE
    _TOKEN_CACHE = None


def _entra_env() -> tuple[str, str, str]:
    tenant = os.environ.get("ENTRA_TENANT_ID", "").strip()
    client_id = os.environ.get("ENTRA_CLIENT_ID", "").strip()
    client_secret = os.environ.get("ENTRA_CLIENT_SECRET", "").strip()
    if not (tenant and client_id and client_secret):
        raise RuntimeError(
            "Entra group sync requires ENTRA_TENANT_ID, ENTRA_CLIENT_ID, "
            "ENTRA_CLIENT_SECRET"
        )
    return tenant, client_id, client_secret


async def acquire_graph_token(client: httpx.AsyncClient) -> str:
    """Return a cached app-only Graph token; refresh within 60s of expiry."""
    global _TOKEN_CACHE
    now = time.monotonic()
    if _TOKEN_CACHE is not None:
        token, expires_at = _TOKEN_CACHE
        if now < expires_at:
            return token
    tenant, client_id, client_secret = _entra_env()
    resp = await client.post(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise GraphAPIError(resp.status_code, "token request", resp.text)
    payload = resp.json()
    token = payload["access_token"]
    ttl = int(payload.get("expires_in", 3600))
    _TOKEN_CACHE = (token, now + max(ttl - 60, 30))
    return token


async def _authed_get(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: Optional[dict[str, Any]] = None,
    extra_headers: Optional[dict[str, str]] = None,
) -> httpx.Response:
    token = await acquire_graph_token(client)
    headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
    if extra_headers:
        headers.update(extra_headers)
    return await client.get(url, headers=headers, params=params, timeout=15)


async def search_groups(query: str, *, limit: int = 25) -> list[dict[str, Any]]:
    """Typeahead against `/groups?$search`, top `limit` matches, mapped shape."""
    async with httpx.AsyncClient() as client:
        resp = await _authed_get(
            client,
            f"{_GRAPH_BASE}/groups",
            params={
                "$search": f'"displayName:{query}"',
                "$top": str(limit),
                "$select": "id,displayName,description",
            },
            extra_headers={"ConsistencyLevel": "eventual"},
        )
    if resp.status_code != 200:
        raise GraphAPIError(resp.status_code, "search", resp.text)
    return [
        {
            "entra_group_oid": row.get("id", ""),
            "display_name": row.get("displayName", ""),
            "description": row.get("description"),
        }
        for row in resp.json().get("value", [])
    ]


async def get_group(entra_group_oid: str) -> dict[str, Any]:
    """Fetch a single group's metadata; mapped shape."""
    async with httpx.AsyncClient() as client:
        resp = await _authed_get(
            client,
            f"{_GRAPH_BASE}/groups/{entra_group_oid}",
            params={"$select": "id,displayName,description"},
        )
    if resp.status_code != 200:
        raise GraphAPIError(resp.status_code, "get_group", resp.text)
    row = resp.json()
    return {
        "entra_group_oid": row.get("id", ""),
        "display_name": row.get("displayName", ""),
        "description": row.get("description"),
    }


async def list_group_member_oids(entra_group_oid: str) -> list[str]:
    """Walk `@odata.nextLink` paging; return direct #microsoft.graph.user oids."""
    oids: list[str] = []
    url = f"{_GRAPH_BASE}/groups/{entra_group_oid}/members"
    first_page = True
    async with httpx.AsyncClient() as client:
        while url:
            params = (
                {"$select": "id,mail,userPrincipalName"}
                if first_page
                else None
            )
            resp = await _authed_get(client, url, params=params)
            if resp.status_code != 200:
                raise GraphAPIError(resp.status_code, "list members", resp.text)
            payload = resp.json()
            for row in payload.get("value", []):
                if row.get("@odata.type") == "#microsoft.graph.user":
                    oid = row.get("id")
                    if oid:
                        oids.append(oid)
            url = payload.get("@odata.nextLink") or ""
            first_page = False
    return oids
