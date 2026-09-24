"""SharePoint Embedded storage for Open Notebook-owned original files."""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import quote, urlparse

import httpx

from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ConflictError,
    ExternalServiceError,
    NetworkError,
)
from open_notebook.storage.original_files import (
    LEGACY_STORAGE_PROFILE_ID,
    OriginalFileRef,
    StoredOriginal,
)

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_DOWNLOAD_HOST_SUFFIXES = (
    ".microsoft.com",
    ".onedrive.com",
    ".1drv.com",
    ".sharepoint.com",
    ".sharepoint-df.com",
)
_CHUNK_SIZE = 1024 * 1024
_NOT_CONFIGURED = "SharePoint Embedded storage is not fully configured"
_PROFILE_UNAVAILABLE = "SharePoint storage profile is not configured"


def _clean(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


@dataclass(frozen=True)
class _StorageProfile:
    profile_id: str
    tenant_id: str
    client_id: str
    container_id: str
    client_secret: str | None = None
    certificate_pfx_path: str | None = None
    certificate_passphrase: str | None = None


def _default_profile() -> _StorageProfile:
    tenant_id = _clean(os.environ.get("SHAREPOINT_STORAGE_TENANT_ID"))
    client_id = _clean(os.environ.get("SHAREPOINT_STORAGE_CLIENT_ID"))
    container_id = _clean(os.environ.get("SHAREPOINT_STORAGE_CONTAINER_ID"))
    secret = _clean(os.environ.get("SHAREPOINT_STORAGE_CLIENT_SECRET"))
    certificate = _clean(os.environ.get("SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH"))
    passphrase = os.environ.get("SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE")
    if not tenant_id or not client_id or not container_id or not (certificate or secret):
        raise ConfigurationError(_NOT_CONFIGURED)
    return _StorageProfile(
        profile_id=LEGACY_STORAGE_PROFILE_ID,
        tenant_id=tenant_id,
        client_id=client_id,
        container_id=container_id,
        client_secret=None if certificate else secret,
        certificate_pfx_path=certificate or None,
        certificate_passphrase=passphrase if certificate and passphrase else None,
    )


def _named_profile(profile_id: str) -> _StorageProfile:
    path = _clean(os.environ.get("SHAREPOINT_STORAGE_PROFILES_FILE"))
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8")) if path else None
    except (OSError, json.JSONDecodeError, UnicodeError):
        raw = None
    entry = raw.get(profile_id) if isinstance(raw, dict) else None
    if not isinstance(entry, dict):
        raise ConfigurationError(_PROFILE_UNAVAILABLE)
    tenant_id = _clean(entry.get("tenant_id"))
    client_id = _clean(entry.get("client_id"))
    container_id = _clean(entry.get("container_id"))
    secret_env = _clean(entry.get("client_secret_env"))
    secret = _clean(os.environ.get(secret_env)) if secret_env else ""
    certificate = _clean(entry.get("certificate_pfx_path"))
    passphrase_env = _clean(entry.get("certificate_passphrase_env"))
    passphrase = os.environ.get(passphrase_env) if passphrase_env else None
    if not tenant_id or not client_id or not container_id or not (certificate or secret):
        raise ConfigurationError(_PROFILE_UNAVAILABLE)
    return _StorageProfile(
        profile_id=profile_id,
        tenant_id=tenant_id,
        client_id=client_id,
        container_id=container_id,
        client_secret=None if certificate else secret,
        certificate_pfx_path=certificate or None,
        certificate_passphrase=passphrase if certificate and passphrase else None,
    )


def load_storage_profile(profile_id: str | None) -> _StorageProfile:
    selected = (
        _clean(profile_id)
        or _clean(os.environ.get("SHAREPOINT_STORAGE_PROFILE_ID"))
        or LEGACY_STORAGE_PROFILE_ID
    )
    if selected == LEGACY_STORAGE_PROFILE_ID:
        return _default_profile()
    return _named_profile(selected)


class SharePointEmbeddedOriginalFileStore:
    provider = "sharepoint_embedded"

    def __init__(self, profile_id: str | None = None) -> None:
        profile = load_storage_profile(profile_id)
        self.profile_id = profile.profile_id
        self._tenant_id = profile.tenant_id
        self._client_id = profile.client_id
        self._client_secret = profile.client_secret or ""
        self._container_id = profile.container_id
        self._certificate_pfx_path = profile.certificate_pfx_path
        self._certificate_passphrase = profile.certificate_passphrase
        self._token_cache: tuple[str, float] | None = None

    def _graph_url(self, path: str) -> str:
        container = quote(self._container_id, safe="")
        return f"{_GRAPH_BASE}/drives/{container}/{path}"

    def _item_url(self, key: str, suffix: str = "") -> str:
        item = quote(key, safe="")
        return self._graph_url(f"items/{item}{suffix}")

    def _validate_ref(self, ref: OriginalFileRef) -> None:
        if ref.provider != self.provider or not ref.key:
            raise ValueError("Original file reference uses a different provider")
        if ref.container_id and ref.container_id != self._container_id:
            raise ConfigurationError(
                "SharePoint storage container does not match the recorded original"
            )

    def _certificate_credential(self) -> dict[str, str]:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.serialization import pkcs12

        try:
            password = (
                self._certificate_passphrase.encode()
                if self._certificate_passphrase
                else None
            )
            key, cert, _extra = pkcs12.load_key_and_certificates(
                Path(self._certificate_pfx_path or "").read_bytes(), password
            )
            if key is None or cert is None:
                raise ValueError
            private_key = key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ).decode()
            thumbprint = cert.fingerprint(hashes.SHA1()).hex()
        except Exception:
            raise ConfigurationError(
                "SharePoint storage certificate is not usable"
            ) from None
        return {"private_key": private_key, "thumbprint": thumbprint}

    def _acquire_certificate_token(self) -> tuple[str, int]:
        import msal

        try:
            app = msal.ConfidentialClientApplication(
                self._client_id,
                authority=f"https://login.microsoftonline.com/{self._tenant_id}",
                client_credential=self._certificate_credential(),
            )
            result = app.acquire_token_for_client(
                scopes=["https://graph.microsoft.com/.default"]
            )
        except ConfigurationError:
            raise
        except Exception:
            raise AuthenticationError(
                "SharePoint storage authentication failed"
            ) from None
        token = result.get("access_token") if isinstance(result, dict) else None
        if not isinstance(token, str) or not token:
            raise AuthenticationError("SharePoint storage authentication failed")
        try:
            ttl = int(result.get("expires_in", 3600)) if isinstance(result, dict) else 3600
        except (TypeError, ValueError):
            ttl = 3600
        return token, ttl

    async def _token(self, client: httpx.AsyncClient) -> str:
        now = time.monotonic()
        if self._token_cache is not None and now < self._token_cache[1]:
            return self._token_cache[0]
        if self._certificate_pfx_path:
            token, ttl = await asyncio.to_thread(self._acquire_certificate_token)
            self._token_cache = (token, now + max(ttl - 60, 0))
            return token

        try:
            response = await client.post(
                "https://login.microsoftonline.com/"
                f"{quote(self._tenant_id, safe='')}/oauth2/v2.0/token",
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "client_credentials",
                    "scope": "https://graph.microsoft.com/.default",
                },
                timeout=10,
            )
        except httpx.HTTPError:
            raise NetworkError("SharePoint storage authentication failed") from None
        if response.status_code != 200:
            raise AuthenticationError("SharePoint storage authentication failed")
        try:
            payload = response.json()
            token = payload["access_token"]
            ttl = int(payload.get("expires_in", 3600))
        except (KeyError, TypeError, ValueError):
            raise AuthenticationError("SharePoint storage authentication failed") from None
        if not isinstance(token, str) or not token:
            raise AuthenticationError("SharePoint storage authentication failed")
        self._token_cache = (token, now + max(ttl - 60, 0))
        return token

    async def _authorized_headers(self, client: httpx.AsyncClient) -> dict[str, str]:
        return {"Authorization": f"Bearer {await self._token(client)}"}

    @staticmethod
    def _raise_for_graph(response: httpx.Response) -> None:
        if response.status_code in {401, 403}:
            raise AuthenticationError("SharePoint storage authentication failed")
        if not 200 <= response.status_code < 300:
            raise ExternalServiceError(
                f"SharePoint storage request failed ({response.status_code})"
            )

    @staticmethod
    def _retry_after(response: httpx.Response) -> float:
        try:
            return max(float(response.headers.get("Retry-After", "0")), 0)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _object_name(filename: str) -> str:
        extension = re.sub(
            r"[^a-z0-9]", "", Path(filename).suffix.lower()
        )[:16]
        return f"{uuid.uuid4().hex}{f'.{extension}' if extension else ''}"

    @staticmethod
    async def _file_chunks(path: Path) -> AsyncIterator[bytes]:
        with path.open("rb") as file:
            while chunk := await asyncio.to_thread(file.read, _CHUNK_SIZE):
                yield chunk

    async def save(self, staged_path: Path, filename: str) -> StoredOriginal:
        size = (await asyncio.to_thread(staged_path.stat)).st_size
        object_name = self._object_name(filename)
        url = self._graph_url(
            f"root:/{quote(object_name, safe='')}:/content"
        )
        async with httpx.AsyncClient(follow_redirects=False) as client:
            headers = await self._authorized_headers(client)
            headers["Content-Length"] = str(size)
            throttled = False
            server_error_retries = 0
            while True:
                try:
                    response = await client.put(
                        url,
                        headers=headers,
                        content=self._file_chunks(staged_path),
                        timeout=None,
                    )
                except httpx.HTTPError:
                    raise NetworkError("SharePoint storage upload failed") from None
                if response.status_code == 429:
                    if throttled:
                        break
                    throttled = True
                elif 500 <= response.status_code < 600:
                    if server_error_retries == 2:
                        break
                    server_error_retries += 1
                else:
                    break
                delay = self._retry_after(response)
                await response.aclose()
                await asyncio.sleep(delay)
        self._raise_for_graph(response)
        try:
            payload = response.json()
            key = payload["id"]
            etag = payload.get("eTag")
        except (KeyError, TypeError, ValueError):
            raise ExternalServiceError(
                "SharePoint storage returned invalid metadata"
            ) from None
        if not isinstance(key, str) or not key:
            raise ExternalServiceError("SharePoint storage returned invalid metadata")
        return StoredOriginal(
            provider=self.provider,
            key=key,
            size_bytes=size,
            etag=etag if isinstance(etag, str) else None,
            profile_id=self.profile_id,
            container_id=self._container_id,
        )

    @staticmethod
    def _validate_download_url(location: str) -> str:
        parsed = urlparse(location)
        host = (parsed.hostname or "").lower()
        try:
            port = parsed.port
        except ValueError:
            port = -1
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or port not in {None, 443}
            or not any(host.endswith(suffix) for suffix in _DOWNLOAD_HOST_SUFFIXES)
        ):
            raise ExternalServiceError("SharePoint storage returned an unsafe download URL")
        return location

    async def iter_bytes(self, ref: OriginalFileRef) -> AsyncIterator[bytes]:
        self._validate_ref(ref)
        url = self._item_url(ref.key, "/content")
        async with httpx.AsyncClient(follow_redirects=False) as client:
            headers = await self._authorized_headers(client)
            try:
                async with client.stream(
                    "GET", url, headers=headers, timeout=None
                ) as response:
                    if response.is_redirect:
                        location = self._validate_download_url(
                            response.headers.get("Location", "")
                        )
                    else:
                        self._raise_for_graph(response)
                        async for chunk in response.aiter_bytes():
                            yield chunk
                        return
                async with client.stream("GET", location, timeout=None) as download:
                    self._raise_for_graph(download)
                    async for chunk in download.aiter_bytes():
                        yield chunk
            except httpx.HTTPError:
                raise NetworkError("SharePoint storage download failed") from None

    @asynccontextmanager
    async def materialize(self, ref: OriginalFileRef) -> AsyncIterator[Path]:
        descriptor, raw_path = tempfile.mkstemp(prefix="open-notebook-original-")
        os.close(descriptor)
        path = Path(raw_path)
        try:
            with path.open("wb") as file:
                async for chunk in self.iter_bytes(ref):
                    await asyncio.to_thread(file.write, chunk)
            yield path
        finally:
            await asyncio.to_thread(path.unlink, missing_ok=True)

    async def exists(self, ref: OriginalFileRef) -> bool:
        self._validate_ref(ref)
        async with httpx.AsyncClient(follow_redirects=False) as client:
            headers = await self._authorized_headers(client)
            try:
                response = await client.get(
                    self._item_url(ref.key), headers=headers, timeout=15
                )
            except httpx.HTTPError:
                raise NetworkError("SharePoint storage lookup failed") from None
        if response.status_code == 404:
            return False
        self._raise_for_graph(response)
        return True

    async def delete(self, ref: OriginalFileRef) -> bool:
        self._validate_ref(ref)
        async with httpx.AsyncClient(follow_redirects=False) as client:
            headers = await self._authorized_headers(client)
            if ref.etag:
                headers["If-Match"] = ref.etag
            try:
                response = await client.delete(
                    self._item_url(ref.key), headers=headers, timeout=30
                )
            except httpx.HTTPError:
                raise NetworkError("SharePoint storage deletion failed") from None
        if response.status_code == 404:
            return True
        if response.status_code == 412:
            raise ConflictError("SharePoint storage object changed")
        self._raise_for_graph(response)
        return True
