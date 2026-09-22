from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ExternalServiceError,
)
from open_notebook.storage.original_files import (
    OriginalFileRef,
    get_original_file_store,
)
from open_notebook.storage.sharepoint_embedded import (
    SharePointEmbeddedOriginalFileStore,
)


@pytest.fixture(autouse=True)
def _storage_env(monkeypatch):
    monkeypatch.setenv("SHAREPOINT_STORAGE_TENANT_ID", "storage-tenant")
    monkeypatch.setenv("SHAREPOINT_STORAGE_CLIENT_ID", "storage-client")
    monkeypatch.setenv("SHAREPOINT_STORAGE_CLIENT_SECRET", "storage-secret")
    monkeypatch.setenv("SHAREPOINT_STORAGE_CONTAINER_ID", "storage-container")


def test_factory_selects_sharepoint_embedded_from_environment(monkeypatch):
    monkeypatch.setenv(
        "OPEN_NOTEBOOK_ORIGINAL_FILE_STORE", "sharepoint_embedded"
    )

    assert isinstance(get_original_file_store(), SharePointEmbeddedOriginalFileStore)


def test_store_requires_all_storage_specific_configuration(monkeypatch):
    monkeypatch.delenv("SHAREPOINT_STORAGE_CLIENT_SECRET")
    monkeypatch.setenv("ENTRA_CLIENT_SECRET", "connector-secret")

    with pytest.raises(ConfigurationError, match="not fully configured"):
        SharePointEmbeddedOriginalFileStore()


@pytest.mark.asyncio
async def test_store_maps_authentication_failures_without_exposing_body(
    tmp_path, monkeypatch
):
    staged = tmp_path / "staged"
    staged.write_bytes(b"original bytes")

    transport = httpx.MockTransport(
        lambda _request: httpx.Response(401, text="sensitive token response")
    )
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)

    with pytest.raises(AuthenticationError) as exc_info:
        await SharePointEmbeddedOriginalFileStore().save(staged, "report.txt")

    assert "sensitive token response" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_store_rejects_non_microsoft_download_redirect(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        return httpx.Response(
            302, headers={"Location": "https://attacker.example/original"}
        )

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    ref = OriginalFileRef("sharepoint_embedded", "managed-item")

    with pytest.raises(ExternalServiceError, match="unsafe download URL"):
        b"".join(
            [
                chunk
                async for chunk in SharePointEmbeddedOriginalFileStore().iter_bytes(
                    ref
                )
            ]
        )


@pytest.mark.asyncio
async def test_store_rejects_second_download_redirect(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        if request.url.host == "graph.microsoft.com":
            return httpx.Response(
                302,
                headers={
                    "Location": "https://storage.sharepoint.com/download/first"
                },
            )
        return httpx.Response(
            302,
            headers={"Location": "https://storage.sharepoint.com/download/second"},
        )

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    ref = OriginalFileRef("sharepoint_embedded", "managed-item")

    with pytest.raises(ExternalServiceError, match="302"):
        b"".join(
            [
                chunk
                async for chunk in SharePointEmbeddedOriginalFileStore().iter_bytes(
                    ref
                )
            ]
        )


@pytest.mark.asyncio
async def test_store_rejects_redirected_existence_and_delete(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        return httpx.Response(
            302, headers={"Location": "https://storage.sharepoint.com/item"}
        )

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    store = SharePointEmbeddedOriginalFileStore()
    ref = OriginalFileRef(store.provider, "managed-item")

    with pytest.raises(ExternalServiceError, match="302"):
        await store.exists(ref)
    with pytest.raises(ExternalServiceError, match="302"):
        await store.delete(ref)


@pytest.mark.asyncio
async def test_store_checks_existence_and_cleans_materialized_file(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        if request.url.host == "storage.sharepoint.com":
            return httpx.Response(200, content=b"materialized bytes")
        if request.url.path.endswith("/items/missing"):
            return httpx.Response(404)
        if request.url.path.endswith("/items/present/content"):
            return httpx.Response(
                302,
                headers={
                    "Location": "https://storage.sharepoint.com/download/present"
                },
            )
        if request.url.path.endswith("/items/present"):
            return httpx.Response(200, json={"id": "present"})
        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    store = SharePointEmbeddedOriginalFileStore()
    present = OriginalFileRef(store.provider, "present")
    missing = OriginalFileRef(store.provider, "missing")

    assert await store.exists(present)
    assert not await store.exists(missing)
    async with store.materialize(present) as path:
        materialized_path = path
        assert path.read_bytes() == b"materialized bytes"
    assert not materialized_path.exists()


@pytest.mark.asyncio
async def test_store_uploads_downloads_and_deletes_with_storage_identity(
    tmp_path, monkeypatch
):
    staged = tmp_path / "staged"
    staged.write_bytes(b"original bytes")
    seen: list[tuple[str, str]] = []
    uploaded_name = ""

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal uploaded_name
        seen.append((request.method, request.url.path))
        if request.url.host == "login.microsoftonline.com":
            form = parse_qs((await request.aread()).decode())
            assert request.url.path == (
                "/storage-tenant/oauth2/v2.0/token"
            )
            assert form == {
                "client_id": ["storage-client"],
                "client_secret": ["storage-secret"],
                "grant_type": ["client_credentials"],
                "scope": ["https://graph.microsoft.com/.default"],
            }
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )

        if request.method == "PUT":
            assert request.url.path.startswith(
                "/v1.0/drives/storage-container/root:/"
            )
            assert request.url.path.endswith(":/content")
            uploaded_name = request.url.path.rsplit("/", 2)[-2].removesuffix(":")
            assert uploaded_name.endswith(".pdf")
            assert "report" not in uploaded_name
            assert request.headers["authorization"] == "Bearer storage-token"
            assert request.headers["content-length"] == str(len(b"original bytes"))
            assert await request.aread() == b"original bytes"
            return httpx.Response(201, json={"id": "managed-item", "eTag": "etag-1"})

        if request.method == "GET" and request.url.host == "graph.microsoft.com":
            assert request.url.path == (
                "/v1.0/drives/storage-container/items/managed-item/content"
            )
            assert request.headers["authorization"] == "Bearer storage-token"
            return httpx.Response(
                302,
                headers={
                    "Location": "https://storage.sharepoint.com/download/managed-item"
                },
            )

        if request.method == "GET" and request.url.host == "storage.sharepoint.com":
            assert "authorization" not in request.headers
            return httpx.Response(200, content=b"original bytes")

        if request.method == "DELETE":
            assert request.url.path == (
                "/v1.0/drives/storage-container/items/managed-item"
            )
            assert request.headers["authorization"] == "Bearer storage-token"
            return httpx.Response(204)

        return httpx.Response(500)

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    store = SharePointEmbeddedOriginalFileStore()

    stored = await store.save(staged, "../../quarterly report.p$d$f")
    ref = OriginalFileRef(stored.provider, stored.key, stored.etag)

    assert stored.provider == "sharepoint_embedded"
    assert stored.key == "managed-item"
    assert stored.etag == "etag-1"
    assert stored.size_bytes == len(b"original bytes")
    assert uploaded_name.endswith(".pdf")
    assert b"".join([chunk async for chunk in store.iter_bytes(ref)]) == b"original bytes"
    assert await store.delete(ref)
    assert seen.count(
        ("POST", "/storage-tenant/oauth2/v2.0/token")
    ) == 1


@pytest.mark.asyncio
async def test_store_retries_one_throttled_upload(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.write_bytes(b"retry me")
    attempts = 0
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float):
        sleep_calls.append(delay)

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        attempts += 1
        assert request.method == "PUT"
        assert await request.aread() == b"retry me"
        if attempts == 1:
            return httpx.Response(429, headers={"Retry-After": "2"})
        return httpx.Response(201, json={"id": "managed-item", "eTag": "etag-1"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    monkeypatch.setattr(
        "open_notebook.storage.sharepoint_embedded.asyncio.sleep", fake_sleep
    )

    stored = await SharePointEmbeddedOriginalFileStore().save(staged, "report.txt")

    assert stored.key == "managed-item"
    assert attempts == 2
    assert sleep_calls == [2.0]


@pytest.mark.asyncio
async def test_store_only_retries_throttled_upload_once(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.write_bytes(b"retry me")
    attempts = 0
    sleep_calls: list[float] = []

    async def fake_sleep(delay: float):
        sleep_calls.append(delay)

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        attempts += 1
        await request.aread()
        return httpx.Response(429, headers={"Retry-After": "1"})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    monkeypatch.setattr(
        "open_notebook.storage.sharepoint_embedded.asyncio.sleep", fake_sleep
    )

    with pytest.raises(ExternalServiceError, match="429"):
        await SharePointEmbeddedOriginalFileStore().save(staged, "report.txt")

    assert attempts == 2
    assert sleep_calls == [1.0]


@pytest.mark.asyncio
async def test_store_bounds_server_error_retries_without_exposing_body(
    tmp_path, monkeypatch
):
    staged = tmp_path / "staged"
    staged.write_bytes(b"retry me")
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        attempts += 1
        await request.aread()
        return httpx.Response(503, text="sensitive Graph response")

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)

    with pytest.raises(ExternalServiceError) as exc_info:
        await SharePointEmbeddedOriginalFileStore().save(staged, "report.txt")

    assert attempts == 3
    assert "sensitive Graph response" not in str(exc_info.value)
