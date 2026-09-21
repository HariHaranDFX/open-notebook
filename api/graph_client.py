"""Microsoft Graph client — app-only auth + shared HTTP concerns.

Client-credentials flow against the existing Entra app registration
(ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET). Requires the
`GroupMember.Read.All` application permission for group sync (WBS 4.20)
and `User.Read.All` for the directory picker and JIT-stub flow (WBS 4.21),
both granted admin consent.

Nothing here runs unless the caller (sync command or admin route) invokes
it; deployments that leave ENTRA_GROUP_SYNC_ENABLED unset never call these
functions, and the directory picker only runs on-demand.
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
    """Typeahead against `/groups`, top `limit` matches, mapped shape.

    An empty query switches to browse mode: `$orderby=displayName` returns
    the first `limit` groups alphabetically so the UI can seed the picker
    with something to look at instead of a blank list.
    """
    q = (query or "").strip()
    if q:
        params = {
            "$search": f'"displayName:{q}"',
            "$top": str(limit),
            "$select": "id,displayName,description",
        }
    else:
        # ConsistencyLevel: eventual is still required by Graph for
        # $orderby against the directory data set.
        params = {
            "$orderby": "displayName",
            "$top": str(limit),
            "$select": "id,displayName,description",
        }
    async with httpx.AsyncClient() as client:
        resp = await _authed_get(
            client,
            f"{_GRAPH_BASE}/groups",
            params=params,
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


def _user_row(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize a Graph user row. Guest accounts often lack `mail`."""
    return {
        "entra_oid": row.get("id", ""),
        "email": row.get("mail") or row.get("userPrincipalName") or "",
        "display_name": row.get("displayName", ""),
    }


async def search_users(query: str, *, limit: int = 25) -> list[dict[str, Any]]:
    """Typeahead against `/users`, top `limit` matches, mapped shape.

    Searches both displayName and mail so admins can paste an address.
    An empty query switches to browse mode: `$orderby=displayName`
    returns the first `limit` users alphabetically.
    """
    q = (query or "").strip()
    if q:
        params = {
            "$search": f'"displayName:{q}" OR "mail:{q}"',
            "$top": str(limit),
            "$select": "id,mail,userPrincipalName,displayName",
        }
    else:
        params = {
            "$orderby": "displayName",
            "$top": str(limit),
            "$select": "id,mail,userPrincipalName,displayName",
        }
    async with httpx.AsyncClient() as client:
        resp = await _authed_get(
            client,
            f"{_GRAPH_BASE}/users",
            params=params,
            extra_headers={"ConsistencyLevel": "eventual"},
        )
    if resp.status_code != 200:
        raise GraphAPIError(resp.status_code, "search users", resp.text)
    return [_user_row(row) for row in resp.json().get("value", [])]


async def get_user(entra_oid: str) -> dict[str, Any]:
    """Fetch a single user's mapped profile. Raises GraphAPIError on 404."""
    async with httpx.AsyncClient() as client:
        resp = await _authed_get(
            client,
            f"{_GRAPH_BASE}/users/{entra_oid}",
            params={"$select": "id,mail,userPrincipalName,displayName"},
        )
    if resp.status_code != 200:
        raise GraphAPIError(resp.status_code, "get_user", resp.text)
    return _user_row(resp.json())


async def list_users_by_oids(oids: list[str]) -> list[dict[str, Any]]:
    """Bulk-resolve OIDs to mapped profiles, chunked to stay under Graph's URL limit.

    Individual chunk failures are logged upstream by the caller (see
    `commands/entra_group_sync.py`); this function raises `GraphAPIError`
    on the first non-2xx so the caller can decide whether to retry.
    """
    if not oids:
        return []
    chunk_size = 15
    out: list[dict[str, Any]] = []
    async with httpx.AsyncClient() as client:
        for start in range(0, len(oids), chunk_size):
            chunk = oids[start : start + chunk_size]
            filter_expr = "id in (" + ",".join(f"'{oid}'" for oid in chunk) + ")"
            resp = await _authed_get(
                client,
                f"{_GRAPH_BASE}/users",
                params={
                    "$filter": filter_expr,
                    "$select": "id,mail,userPrincipalName,displayName",
                    "$top": str(len(chunk)),
                },
            )
            if resp.status_code != 200:
                raise GraphAPIError(resp.status_code, "list_users_by_oids", resp.text)
            for row in resp.json().get("value", []):
                out.append(_user_row(row))
    return out


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
