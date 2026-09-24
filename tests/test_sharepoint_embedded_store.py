from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ConflictError,
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


_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return _REAL_ASYNC_CLIENT(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)


def _write_profiles(tmp_path, profiles: dict):
    path = tmp_path / "profiles.json"
    path.write_text(__import__("json").dumps(profiles), encoding="utf-8")
    return path


def _self_signed_pfx(path):
    from datetime import datetime, timedelta, timezone

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "storage-test")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    path.write_bytes(
        pkcs12.serialize_key_and_certificates(
            b"storage-test", key, cert, None, serialization.NoEncryption()
        )
    )


@pytest.mark.asyncio
async def test_certificate_token_ignores_connector_credentials(tmp_path, monkeypatch):
    pfx = tmp_path / "storage.pfx"
    _self_signed_pfx(pfx)
    monkeypatch.delenv("SHAREPOINT_STORAGE_CLIENT_SECRET")
    monkeypatch.setenv("SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH", str(pfx))
    monkeypatch.setenv("SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE", "")
    monkeypatch.setenv("ENTRA_CLIENT_ID", "entra-client")
    monkeypatch.setenv("ENTRA_CLIENT_SECRET", "entra-secret-value")
    monkeypatch.setenv("ENTRA_TENANT_ID", "entra-tenant")
    seen = []

    class FakeApp:
        def __init__(self, client_id, client_credential=None, authority=None, **kwargs):
            seen.append((client_id, authority, client_credential))

        def acquire_token_for_client(self, scopes, **kwargs):
            assert scopes == ["https://graph.microsoft.com/.default"]
            return {"access_token": "cert-token", "expires_in": 3600}

    monkeypatch.setattr(
        "msal.ConfidentialClientApplication", FakeApp, raising=False
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host != "login.microsoftonline.com"
        assert "entra-secret-value" not in request.headers.get("authorization", "")
        assert request.headers["authorization"] == "Bearer cert-token"
        return httpx.Response(200, json={"id": "managed-item"})

    _mock_client(monkeypatch, handler)
    store = SharePointEmbeddedOriginalFileStore()
    ref = OriginalFileRef(store.provider, "managed-item", container_id="storage-container")

    assert await store.exists(ref)
    assert seen[0][0] == "storage-client"
    assert "entra-tenant" not in (seen[0][1] or "")
    credential = seen[0][2]
    assert isinstance(credential, dict)
    assert "entra-secret-value" not in credential.get("private_key", "")
    assert str(pfx) not in credential.get("private_key", "")


@pytest.mark.asyncio
async def test_old_profile_is_used_after_default_changes(tmp_path, monkeypatch):
    from open_notebook.domain.notebook import Asset
    from open_notebook.storage.original_files import reference_from_asset

    profiles = _write_profiles(
        tmp_path,
        {
            "profile-a": {
                "tenant_id": "tenant-a",
                "client_id": "client-a",
                "container_id": "container-a",
                "client_secret_env": "SPE_A_SECRET",
            },
            "profile-b": {
                "tenant_id": "tenant-b",
                "client_id": "client-b",
                "container_id": "container-b",
                "client_secret_env": "SPE_B_SECRET",
            },
        },
    )
    monkeypatch.setenv("SHAREPOINT_STORAGE_PROFILES_FILE", str(profiles))
    monkeypatch.setenv("SPE_A_SECRET", "secret-a")
    monkeypatch.setenv("SPE_B_SECRET", "secret-b")
    monkeypatch.setenv("ENTRA_CLIENT_SECRET", "entra-secret-value")
    monkeypatch.setenv("SHAREPOINT_STORAGE_PROFILE_ID", "profile-a")
    drives = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            body = (await request.aread()).decode()
            assert "entra-secret-value" not in body
            assert "secret-a" in body
            assert "client-a" in body
            return httpx.Response(
                200, json={"access_token": "profile-a-token", "expires_in": 3600}
            )
        drives.append(request.url.path)
        return httpx.Response(200, json={"id": "item-a"})

    _mock_client(monkeypatch, handler)
    asset = Asset(
        original_file_store="sharepoint_embedded",
        original_file_key="item-a",
        original_file_profile_id="profile-a",
        original_file_container_id="container-a",
    )
    old_ref = reference_from_asset(asset)
    assert old_ref is not None
    monkeypatch.setenv("SHAREPOINT_STORAGE_PROFILE_ID", "profile-b")

    assert old_ref.container_id == "container-a"
    assert await get_original_file_store(old_ref.provider, old_ref.profile_id).exists(old_ref)
    assert drives == ["/v1.0/drives/container-a/items/item-a"]


def test_missing_recorded_profile_fails_without_secrets(tmp_path, monkeypatch):
    profiles = _write_profiles(
        tmp_path,
        {
            "profile-a": {
                "tenant_id": "tenant-a",
                "client_id": "client-a",
                "container_id": "container-a",
                "client_secret_env": "SPE_A_SECRET",
            }
        },
    )
    monkeypatch.setenv("SHAREPOINT_STORAGE_PROFILES_FILE", str(profiles))
    monkeypatch.setenv("SPE_A_SECRET", "secret-a")

    with pytest.raises(ConfigurationError) as missing:
        get_original_file_store("sharepoint_embedded", "profile-missing")

    assert str(profiles) not in str(missing.value)
    assert "secret-a" not in str(missing.value)


@pytest.mark.asyncio
async def test_container_mismatch_does_not_call_graph(tmp_path, monkeypatch):
    profiles = _write_profiles(
        tmp_path,
        {
            "profile-a": {
                "tenant_id": "tenant-a",
                "client_id": "client-a",
                "container_id": "container-a",
                "client_secret_env": "SPE_A_SECRET",
            }
        },
    )
    monkeypatch.setenv("SHAREPOINT_STORAGE_PROFILES_FILE", str(profiles))
    monkeypatch.setenv("SPE_A_SECRET", "secret-a")
    called = []

    async def handler(request: httpx.Request) -> httpx.Response:
        called.append(request.url.path)
        return httpx.Response(204)

    _mock_client(monkeypatch, handler)
    store = SharePointEmbeddedOriginalFileStore("profile-a")
    ref = OriginalFileRef(
        store.provider,
        "item-a",
        "etag-1",
        profile_id="profile-a",
        container_id="container-other",
    )

    with pytest.raises(ConfigurationError, match="container"):
        await store.delete(ref)
    assert called == []


@pytest.mark.asyncio
async def test_delete_404_is_success_and_412_keeps_the_reference(monkeypatch):
    requests = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(
                200, json={"access_token": "storage-token", "expires_in": 3600}
            )
        requests.append(request)
        if request.url.path.endswith("/missing"):
            return httpx.Response(404)
        return httpx.Response(412, text="etag mismatch secret body")

    _mock_client(monkeypatch, handler)
    store = SharePointEmbeddedOriginalFileStore()
    missing = OriginalFileRef(
        store.provider, "missing", "etag-old", container_id="storage-container"
    )
    stale = OriginalFileRef(
        store.provider, "stale", "etag-old", container_id="storage-container"
    )

    assert await store.delete(missing)
    with pytest.raises(ConflictError, match="changed") as exc_info:
        await store.delete(stale)

    assert "etag mismatch secret body" not in str(exc_info.value)
    assert requests[-1].headers["if-match"] == "etag-old"
    assert stale.key == "stale"
    assert stale.etag == "etag-old"


_TEN_MIB = 10 * 1024 * 1024
_ELEVEN_MIB = 11 * 1024 * 1024


def _sparse(path, size: int) -> None:
    with path.open("wb") as handle:
        handle.seek(size - 1)
        handle.write(b"x")


def _token_ok() -> httpx.Response:
    return httpx.Response(
        200, json={"access_token": "storage-token", "expires_in": 3600}
    )


@pytest.mark.asyncio
async def test_ten_mebibyte_upload_stays_a_simple_put(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    _sparse(staged, _TEN_MIB)
    methods = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return _token_ok()
        methods.append(request.method + " " + request.url.path)
        assert "content-range" not in request.headers
        return httpx.Response(201, json={"id": "managed-item", "eTag": "etag-1"})

    _mock_client(monkeypatch, handler)

    stored = await SharePointEmbeddedOriginalFileStore().save(staged, "report.bin")

    assert stored.key == "managed-item"
    assert methods[0].endswith(":/content")
    assert not any("createUploadSession" in method for method in methods)


@pytest.mark.asyncio
async def test_eleven_mebibyte_upload_uses_a_session_without_graph_token(
    tmp_path, monkeypatch
):
    staged = tmp_path / "staged"
    _sparse(staged, _ELEVEN_MIB)
    upload_requests = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return _token_ok()
        if request.url.path.endswith("createUploadSession"):
            assert request.headers["authorization"] == "Bearer storage-token"
            return httpx.Response(
                200,
                json={"uploadUrl": "https://storage.sharepoint.com/session/1"},
            )
        upload_requests.append(request)
        assert "authorization" not in request.headers
        if request.headers["content-range"] == "bytes 0-5242879/11534336":
            return httpx.Response(202, json={"nextExpectedRanges": ["5242880-"]})
        return httpx.Response(201, json={"id": "managed-item", "eTag": "etag-1"})

    _mock_client(monkeypatch, handler)

    stored = await SharePointEmbeddedOriginalFileStore().save(staged, "report.bin")

    assert stored.key == "managed-item"
    assert upload_requests[0].headers["content-range"] == "bytes 0-5242879/11534336"
    assert upload_requests[1].headers["content-range"] == "bytes 5242880-10485759/11534336"
    assert "authorization" not in upload_requests[0].headers
    assert "authorization" not in upload_requests[1].headers


@pytest.mark.asyncio
async def test_interrupted_upload_resumes_from_server_range(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    _sparse(staged, _ELEVEN_MIB)
    puts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal puts
        if request.url.host == "login.microsoftonline.com":
            return _token_ok()
        if request.url.path.endswith("createUploadSession"):
            return httpx.Response(
                200,
                json={"uploadUrl": "https://storage.sharepoint.com/session/1"},
            )
        if request.method == "GET":
            assert "authorization" not in request.headers
            return httpx.Response(200, json={"nextExpectedRanges": ["5242880-"]})
        puts += 1
        assert "authorization" not in request.headers
        if puts == 1:
            raise httpx.ConnectError("interrupted")
        assert request.headers["content-range"].startswith("bytes 5242880-")
        return httpx.Response(201, json={"id": "managed-item", "eTag": "etag-1"})

    _mock_client(monkeypatch, handler)

    stored = await SharePointEmbeddedOriginalFileStore().save(staged, "report.bin")

    assert stored.key == "managed-item"
    assert puts == 2


@pytest.mark.asyncio
async def test_upload_session_bounds_throttling_and_stops_when_expired(
    tmp_path, monkeypatch
):
    staged = tmp_path / "staged"
    _sparse(staged, _ELEVEN_MIB)
    sleeps: list[float] = []

    async def fake_sleep(delay: float):
        sleeps.append(delay)

    async def throttled(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return _token_ok()
        if request.url.path.endswith("createUploadSession"):
            return httpx.Response(
                200,
                json={"uploadUrl": "https://storage.sharepoint.com/session/1"},
            )
        return httpx.Response(429, headers={"Retry-After": "3"})

    _mock_client(monkeypatch, throttled)
    monkeypatch.setattr(
        "open_notebook.storage.sharepoint_embedded.asyncio.sleep", fake_sleep
    )

    with pytest.raises(ExternalServiceError, match="429"):
        await SharePointEmbeddedOriginalFileStore().save(staged, "report.bin")
    assert sleeps == [3.0]

    async def expired(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return _token_ok()
        if request.url.path.endswith("createUploadSession"):
            return httpx.Response(
                200,
                json={"uploadUrl": "https://storage.sharepoint.com/session/1"},
            )
        return httpx.Response(404)

    _mock_client(monkeypatch, expired)
    with pytest.raises(ExternalServiceError, match="expired"):
        await SharePointEmbeddedOriginalFileStore().save(staged, "report.bin")


@pytest.mark.asyncio
async def test_upload_session_rejects_an_unsafe_url(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    _sparse(staged, _ELEVEN_MIB)
    puts = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            return _token_ok()
        if request.method == "PUT":
            puts.append(request.url.host)
        return httpx.Response(
            200, json={"uploadUrl": "https://attacker.example/session"}
        )

    _mock_client(monkeypatch, handler)

    with pytest.raises(ExternalServiceError, match="unsafe"):
        await SharePointEmbeddedOriginalFileStore().save(staged, "report.bin")
    assert puts == []
