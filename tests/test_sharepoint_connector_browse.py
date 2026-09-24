from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from api.auth.deps import require_user
from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import (
    AuthenticationError,
    ExternalServiceError,
    RateLimitError,
)


@pytest.mark.asyncio
async def test_list_sites_uses_delegated_token_and_normalizes_paged_results(
    monkeypatch,
):
    from api import graph_client
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    tokens = []

    async def delegated_token(user_id: str) -> str:
        tokens.append(user_id)
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    app_only_token = AsyncMock(side_effect=AssertionError("app-only token used"))
    monkeypatch.setattr(graph_client, "acquire_graph_token", app_only_token)
    requests = []

    def graph(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer delegated-secret"
        if len(requests) == 1:
            assert request.url.params["search"] == "finance"
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "tenant.sharepoint.com,site-one,web-one",
                            "displayName": "Finance",
                            "name": "finance-internal",
                            "webUrl": "https://tenant.sharepoint.com/sites/finance",
                            "sensitive": "not-for-the-browser",
                        }
                    ],
                    "@odata.nextLink": (
                        "https://graph.microsoft.com/v1.0/sites?search=finance&$skiptoken=next"
                    ),
                },
            )
        return httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "tenant.sharepoint.com,site-two,web-two",
                        "displayName": "Finance Archive",
                        "webUrl": "https://tenant.sharepoint.com/sites/archive",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        sites = await SharePointConnector("user:alice", client).list_sites("finance")

    assert [site.model_dump() for site in sites] == [
        {
            "id": "tenant.sharepoint.com,site-one,web-one",
            "name": "Finance",
            "web_url": "https://tenant.sharepoint.com/sites/finance",
        },
        {
            "id": "tenant.sharepoint.com,site-two,web-two",
            "name": "Finance Archive",
            "web_url": "https://tenant.sharepoint.com/sites/archive",
        },
    ]
    assert tokens == ["user:alice", "user:alice"]
    app_only_token.assert_not_awaited()


@pytest.mark.asyncio
async def test_drives_and_children_encode_ids_and_return_support_flags(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        assert user_id == "user:alice"
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    paths = []

    def graph(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.raw_path.decode())
        if len(paths) == 1:
            return httpx.Response(
                200,
                json={
                    "value": [
                        {
                            "id": "drive/one",
                            "name": "Documents",
                            "driveType": "documentLibrary",
                            "webUrl": "https://tenant.sharepoint.com/Documents",
                            "owner": {"user": {"email": "private@test"}},
                        }
                    ]
                },
            )
        return httpx.Response(
            200,
            json={
                "value": [
                    {"id": "folder/one", "name": "Reports", "folder": {}},
                    {
                        "id": "file-one",
                        "name": "annual report.pdf",
                        "file": {"mimeType": "application/pdf"},
                    },
                    {
                        "id": "file-two",
                        "name": "malware.exe",
                        "file": {"mimeType": "application/pdf"},
                    },
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        connector = SharePointConnector("user:alice", client)
        drives = await connector.list_drives("tenant/site")
        children = await connector.list_children("drive/one", "folder/one")

    assert [drive.model_dump() for drive in drives] == [
        {"id": "drive/one", "name": "Documents", "kind": "documentLibrary"}
    ]
    assert [item.model_dump() for item in children] == [
        {
            "id": "folder/one",
            "name": "Reports",
            "kind": "folder",
            "browsable": True,
            "importable": False,
        },
        {
            "id": "file-one",
            "name": "annual report.pdf",
            "kind": "file",
            "browsable": False,
            "importable": True,
        },
        {
            "id": "file-two",
            "name": "malware.exe",
            "kind": "file",
            "browsable": False,
            "importable": False,
        },
    ]
    assert paths == [
        "/v1.0/sites/tenant%2Fsite/drives",
        "/v1.0/drives/drive%2Fone/items/folder%2Fone/children",
    ]


@pytest.mark.asyncio
async def test_docling_catch_all_cannot_make_executable_importable(monkeypatch):
    import content_core.extraction as extraction
    from content_core.config import ContentCoreConfig

    from open_notebook.connectors import sharepoint as sharepoint_module
    from open_notebook.connectors import sharepoint_auth

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    monkeypatch.setattr(extraction, "DOCLING_AVAILABLE", True)
    monkeypatch.setattr(extraction, "extract_docling", object())
    monkeypatch.setattr(
        sharepoint_module,
        "get_default_config",
        lambda: ContentCoreConfig(document_engine="docling"),
    )

    def graph(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "unsafe",
                        "name": "payload.exe",
                        "file": {"mimeType": "application/pdf"},
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        children = await sharepoint_module.SharePointConnector(
            "user:alice", client
        ).list_children("drive")

    assert children[0].importable is False


@pytest.mark.asyncio
async def test_csv_and_tsv_use_content_core_extensions_not_host_mime(monkeypatch):
    import mimetypes

    import content_core.extraction as extraction
    from content_core.config import ContentCoreConfig

    from open_notebook.connectors import sharepoint as sharepoint_module
    from open_notebook.connectors import sharepoint_auth

    host_mimes = {
        ".csv": "application/vnd.ms-excel",
        ".tsv": "text/tab-separated-values",
        ".exe": "application/x-msdos-program",
    }
    monkeypatch.setattr(
        mimetypes,
        "guess_type",
        lambda name: (host_mimes[next(ext for ext in host_mimes if name.endswith(ext))], None),
    )
    monkeypatch.setattr(extraction, "DOCLING_AVAILABLE", True)
    monkeypatch.setattr(extraction, "extract_docling", object())
    monkeypatch.setattr(
        sharepoint_module,
        "get_default_config",
        lambda: ContentCoreConfig(document_engine="docling"),
    )

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    def graph(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "value": [
                    {"id": "csv", "name": "data.csv", "file": {}},
                    {"id": "tsv", "name": "data.tsv", "file": {}},
                    {"id": "exe", "name": "payload.exe", "file": {}},
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        children = await sharepoint_module.SharePointConnector(
            "user:alice", client
        ).list_children("drive")

    assert [item.importable for item in children] == [True, True, False]


@pytest.mark.asyncio
async def test_iter_documents_walks_folders_and_downloads_supported_files(
    monkeypatch,
):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    def graph(request: httpx.Request) -> httpx.Response:
        path = request.url.raw_path.decode()
        if path.endswith("/root/children"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {"id": "folder/one", "name": "Reports", "folder": {}},
                        {"id": "skip", "name": "binary.exe", "file": {}},
                    ]
                },
            )
        if path.endswith("/items/folder%2Fone/children"):
            return httpx.Response(
                200,
                json={
                    "value": [
                        {"id": "document/one", "name": "annual.pdf", "file": {}}
                    ]
                },
            )
        if path.endswith("/items/document%2Fone/content"):
            return httpx.Response(200, content=b"pdf-bytes")
        raise AssertionError(path)

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        connector = SharePointConnector("user:alice", client)
        documents = [
            document async for document in connector.iter_documents("drive/one")
        ]
        content = b"".join(
            [chunk async for chunk in connector.download("drive/one", "document/one")]
        )

    assert [document.model_dump() for document in documents] == [
        {
            "drive_id": "drive/one",
            "item_id": "document/one",
            "name": "annual.pdf",
            "etag": None,
            "size": None,
        }
    ]
    assert content == b"pdf-bytes"


@pytest.mark.asyncio
async def test_rejects_unsafe_or_repeated_paging_links(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    for next_link in (
        "http://graph.microsoft.com/v1.0/sites?$skiptoken=secret",
        "https://evil.test/steal",
        "https://graph.microsoft.com/v1.0/sites?search=finance",
    ):
        calls = 0

        def graph(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(
                200, json={"value": [], "@odata.nextLink": next_link}
            )

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(graph)
        ) as client:
            with pytest.raises(ExternalServiceError):
                await SharePointConnector("user:alice", client).list_sites("finance")
        assert calls <= 2


@pytest.mark.asyncio
async def test_graph_client_never_auto_forwards_bearer_on_redirect(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    visited = []

    def graph(request: httpx.Request) -> httpx.Response:
        visited.append(str(request.url))
        if request.url.host == "graph.microsoft.com":
            return httpx.Response(302, headers={"Location": "https://evil.test/steal"})
        raise AssertionError("Redirect target must not be called")

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph), follow_redirects=True) as client:
        with pytest.raises(ExternalServiceError):
            await SharePointConnector("user:alice", client).list_sites("")
    assert len(visited) == 1


@pytest.mark.asyncio
async def test_malformed_paging_link_maps_to_safe_upstream_error(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    def graph(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"value": [], "@odata.nextLink": "https://[invalid"},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        with pytest.raises(ExternalServiceError):
            await SharePointConnector("user:alice", client).list_sites("")


@pytest.mark.asyncio
async def test_graph_throttle_honors_retry_after(monkeypatch):
    from open_notebook.connectors import sharepoint as sharepoint_module
    from open_notebook.connectors import sharepoint_auth

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    delays = []

    async def sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    monkeypatch.setattr(sharepoint_module, "asyncio", type("Clock", (), {"sleep": staticmethod(sleep)})(), raising=False)
    calls = 0

    def graph(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "2"})
        return httpx.Response(200, json={"value": [{"id": "site", "displayName": "Site"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        sites = await sharepoint_module.SharePointConnector("user:alice", client).list_sites("")
    assert [site.id for site in sites] == ["site"]
    assert calls == 2
    assert delays == [2]


@pytest.mark.asyncio
async def test_graph_retries_503_with_bounded_fallback_and_never_retries_auth(monkeypatch):
    from open_notebook.connectors import sharepoint as sharepoint_module
    from open_notebook.connectors import sharepoint_auth

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    delays = []

    async def sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    monkeypatch.setattr(sharepoint_module.asyncio, "sleep", sleep)
    calls = 0

    def graph(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503, headers={"Retry-After": "invalid"})
        if calls == 2:
            return httpx.Response(503, headers={"Retry-After": "-1"})
        if calls == 3:
            return httpx.Response(503, headers={"Retry-After": "NaN"})
        return httpx.Response(401)

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        with pytest.raises(AuthenticationError):
            await sharepoint_module.SharePointConnector("user:alice", client).list_sites("")
    assert calls == 4
    assert delays == [1, 0, 4]


@pytest.mark.asyncio
async def test_logical_listing_fails_visibly_above_one_thousand_items(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)
    calls = 0

    def graph(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "value": [
                    {"id": f"site-{index}", "displayName": f"Site {index}"}
                    for index in range(1001)
                ],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites?$skiptoken=more",
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        with pytest.raises(ExternalServiceError, match="limit"):
            await SharePointConnector("user:alice", client).list_sites("")
    assert calls == 1


@pytest.mark.asyncio
async def test_listing_at_limit_with_more_pages_is_not_reported_complete(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    def graph(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "value": [{"id": str(index), "displayName": str(index)} for index in range(1000)],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites?$skiptoken=more",
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        with pytest.raises(ExternalServiceError, match="limit"):
            await SharePointConnector("user:alice", client).list_sites("")


@pytest.mark.asyncio
async def test_download_redirect_requires_https_and_drops_delegated_token(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    def graph(request: httpx.Request) -> httpx.Response:
        if request.url.host == "graph.microsoft.com":
            assert request.headers["Authorization"] == "Bearer delegated-secret"
            return httpx.Response(
                302, headers={"Location": "https://tenant.sharepoint.com/document"}
            )
        assert request.url.host == "tenant.sharepoint.com"
        assert "Authorization" not in request.headers
        return httpx.Response(200, content=b"document")

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        content = b"".join(
            [
                chunk
                async for chunk in SharePointConnector(
                    "user:alice", client
                ).download("drive", "item")
            ]
        )
    assert content == b"document"

    def unsafe_redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "https://evil.test/document"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(unsafe_redirect)) as client:
        with pytest.raises(ExternalServiceError):
            _ = b"".join([chunk async for chunk in SharePointConnector("user:alice", client).download("drive", "item")])

    def insecure_redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302, headers={"Location": "http://download.example.test/document"}
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(insecure_redirect)
    ) as client:
        with pytest.raises(ExternalServiceError):
            _ = b"".join(
                [
                    chunk
                    async for chunk in SharePointConnector(
                        "user:alice", client
                    ).download("drive", "item")
                ]
            )


@pytest.mark.asyncio
async def test_malformed_download_redirect_maps_to_safe_upstream_error(monkeypatch):
    from open_notebook.connectors import sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def delegated_token(user_id: str) -> str:
        return "delegated-secret"

    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", delegated_token)

    def graph(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "https://[invalid"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(graph)) as client:
        with pytest.raises(ExternalServiceError):
            _ = b"".join(
                [
                    chunk
                    async for chunk in SharePointConnector(
                        "user:alice", client
                    ).download("drive", "item")
                ]
            )


def browse_app():
    from api.routers.connectors import router

    user = AuthenticatedUser(
        "user:alice", "alice@test", "Alice", "user", "oid", "default"
    )
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[require_user] = lambda: user

    for error, status in (
        (AuthenticationError, 401),
        (RateLimitError, 429),
        (ExternalServiceError, 502),
    ):

        async def handler(request, exc, status=status):
            return JSONResponse({"detail": str(exc)}, status_code=status)

        app.add_exception_handler(error, handler)
    return app, user


@pytest.mark.asyncio
async def test_browse_routes_use_only_authenticated_owner(monkeypatch):
    from api.routers import connectors as routes
    from open_notebook.connectors.base import ConnectorSite

    app, user = browse_app()

    async def connection(user_id: str):
        assert user_id == user.id
        return type("Connection", (), {"status": "connected"})()

    async def sites(self, query: str):
        assert self.user_id == user.id
        assert query == "finance"
        return [ConnectorSite(id="site-one", name="Finance")]

    monkeypatch.setattr(routes.sharepoint_auth, "get_connection", connection)
    monkeypatch.setattr(routes.SharePointConnector, "list_sites", sites)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.get(
            "/api/connectors/sharepoint/sites",
            params={
                "query": "finance",
                "user_id": "user:bob",
                "connection_id": "connector_connection:bob",
            },
        )
    assert response.status_code == 200
    assert response.json() == [
        {"id": "site-one", "name": "Finance", "web_url": None}
    ]


@pytest.mark.asyncio
async def test_disconnected_browse_returns_409_without_calling_graph(monkeypatch):
    from api.routers import connectors as routes

    app, user = browse_app()

    async def disconnected(user_id: str):
        assert user_id == user.id
        return None

    async def sites(self, query: str):
        raise AssertionError("Graph must not be called for a disconnected owner")

    monkeypatch.setattr(routes.sharepoint_auth, "get_connection", disconnected)
    monkeypatch.setattr(routes.SharePointConnector, "list_sites", sites)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.get("/api/connectors/sharepoint/sites")
    assert response.status_code == 409
    assert response.json() == {
        "detail": "SharePoint is not connected. Connect SharePoint again."
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "status"),
    [
        (AuthenticationError("Connect SharePoint again."), 409),
        (RateLimitError("SharePoint is busy. Try again later."), 429),
        (ExternalServiceError("SharePoint request failed."), 502),
    ],
)
async def test_browse_routes_map_safe_connector_errors(
    monkeypatch, error, status
):
    from api.routers import connectors as routes

    app, user = browse_app()

    async def connection(user_id: str):
        assert user_id == user.id
        return type("Connection", (), {"status": "connected"})()

    async def sites(self, query: str):
        raise error

    monkeypatch.setattr(routes.sharepoint_auth, "get_connection", connection)
    monkeypatch.setattr(routes.SharePointConnector, "list_sites", sites)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.get("/api/connectors/sharepoint/sites")
    assert response.status_code == status
    assert "secret" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "/api/connectors/sharepoint/sites",
        "/api/connectors/sharepoint/sites/site-one/drives",
        "/api/connectors/sharepoint/drives/drive-one/children",
    ],
)
async def test_browse_connector_auth_failure_never_looks_like_app_logout(
    monkeypatch, path
):
    from api.routers import connectors as routes

    app, user = browse_app()

    async def connection(user_id: str):
        assert user_id == user.id
        return type("Connection", (), {"status": "connected"})()

    async def denied(self, *args):
        raise AuthenticationError("Connect SharePoint again.")

    monkeypatch.setattr(routes.sharepoint_auth, "get_connection", connection)
    for method in ("list_sites", "list_drives", "list_children"):
        monkeypatch.setattr(routes.SharePointConnector, method, denied)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="https://app.test"
    ) as client:
        response = await client.get(path)
    assert response.status_code == 409
    assert response.json() == {
        "detail": "SharePoint is not connected. Connect SharePoint again."
    }
