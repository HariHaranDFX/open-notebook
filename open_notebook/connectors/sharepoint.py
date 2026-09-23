"""Read-only Microsoft Graph client using an owner's delegated token."""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

import httpx
from content_core import ConfigurationError as ContentCoreConfigurationError
from content_core.config import get_default_config
from content_core.content.identification import FileDetector
from content_core.extraction import (
    DOCLING_SUPPORTED,
    SUPPORTED_EPUB_TYPES,
    SUPPORTED_OFFICE_TYPES,
    SUPPORTED_PDF_TYPES,
    _route_for_mime,
)
from pydantic import ValidationError

from open_notebook.connectors import sharepoint_auth
from open_notebook.connectors.base import (
    ConnectorDocument,
    ConnectorDrive,
    ConnectorItem,
    ConnectorSite,
)
from open_notebook.exceptions import (
    AuthenticationError,
    ExternalServiceError,
    NetworkError,
    RateLimitError,
)

GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
MAX_LIST_ITEMS = 1000
EXTENSION_MIME_TYPES = FileDetector().extension_mapping
SUPPORTED_MIME_TYPES = frozenset(
    (
        *SUPPORTED_PDF_TYPES,
        *SUPPORTED_EPUB_TYPES,
        *SUPPORTED_OFFICE_TYPES,
        *DOCLING_SUPPORTED,
        "text/plain",
        "text/html",
    )
)


class SharePointConnector:
    def __init__(self, user_id: str, client: httpx.AsyncClient | None = None):
        self.user_id = user_id
        self.client = client

    async def _get_json(
        self, url: str, params: dict[str, str] | None = None
    ) -> dict[str, Any]:
        token = await sharepoint_auth.acquire_delegated_token(self.user_id)
        try:
            if self.client:
                response = await self.client.get(
                    url, params=params, headers={"Authorization": f"Bearer {token}"}
                )
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        url,
                        params=params,
                        headers={"Authorization": f"Bearer {token}"},
                    )
        except httpx.RequestError as exc:
            raise NetworkError("SharePoint is temporarily unavailable. Try again.") from exc
        if response.status_code in (401, 403):
            raise AuthenticationError(
                "SharePoint consent expired or was revoked. Connect SharePoint again."
            )
        if response.status_code == 429:
            raise RateLimitError("SharePoint is busy. Try again later.")
        if response.is_error:
            raise ExternalServiceError(
                "SharePoint could not complete the request. Try again."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ExternalServiceError(
                "SharePoint returned an invalid response. Try again."
            ) from exc
        if not isinstance(payload, dict):
            raise ExternalServiceError(
                "SharePoint returned an invalid response. Try again."
            )
        return payload

    @staticmethod
    def _validated_next_link(value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ExternalServiceError(
                "SharePoint returned an invalid paging link. Try again."
            )
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError as exc:
            raise ExternalServiceError(
                "SharePoint returned an unsafe paging link. Try again."
            ) from exc
        if (
            parsed.scheme != "https"
            or parsed.hostname != "graph.microsoft.com"
            or port not in (None, 443)
            or parsed.username
            or parsed.password
        ):
            raise ExternalServiceError(
                "SharePoint returned an unsafe paging link. Try again."
            )
        return value

    async def _list(
        self, url: str, params: dict[str, str] | None = None
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        while url:
            if url in seen:
                raise ExternalServiceError(
                    "SharePoint returned a repeated paging link. Try again."
                )
            seen.add(url)
            payload = await self._get_json(url, params)
            params = None
            page = payload.get("value")
            if not isinstance(page, list) or not all(
                isinstance(item, dict) for item in page
            ):
                raise ExternalServiceError(
                    "SharePoint returned an invalid response. Try again."
                )
            items.extend(page[: MAX_LIST_ITEMS - len(items)])
            if len(items) == MAX_LIST_ITEMS:
                break
            url = self._validated_next_link(payload.get("@odata.nextLink")) or ""
        return items

    async def list_sites(self, query: str) -> list[ConnectorSite]:
        rows = await self._list(f"{GRAPH_ROOT}/sites", {"search": query})
        try:
            return [
                ConnectorSite(
                    id=row["id"],
                    name=row.get("displayName") or row["name"],
                    web_url=row.get("webUrl"),
                )
                for row in rows
            ]
        except (KeyError, ValidationError) as exc:
            raise ExternalServiceError(
                "SharePoint returned invalid site data. Try again."
            ) from exc

    async def list_drives(self, site_id: str) -> list[ConnectorDrive]:
        rows = await self._list(
            f"{GRAPH_ROOT}/sites/{quote(site_id, safe='')}/drives"
        )
        try:
            return [
                ConnectorDrive(
                    id=row["id"], name=row["name"], kind=row["driveType"]
                )
                for row in rows
            ]
        except (KeyError, ValidationError) as exc:
            raise ExternalServiceError(
                "SharePoint returned invalid drive data. Try again."
            ) from exc

    @staticmethod
    def _is_importable(name: str) -> bool:
        mime = EXTENSION_MIME_TYPES.get(Path(name).suffix.lower())
        if not mime or not (
            mime in SUPPORTED_MIME_TYPES
            or mime.startswith("audio/")
            or mime.startswith("video/")
        ):
            return False
        try:
            return bool(_route_for_mime(mime, get_default_config()))
        except ContentCoreConfigurationError:
            return False

    async def list_children(
        self, drive_id: str, item_id: str | None = None
    ) -> list[ConnectorItem]:
        drive = quote(drive_id, safe="")
        location = (
            f"items/{quote(item_id, safe='')}/children"
            if item_id is not None
            else "root/children"
        )
        rows = await self._list(f"{GRAPH_ROOT}/drives/{drive}/{location}")
        try:
            return [
                ConnectorItem(
                    id=row["id"],
                    name=row["name"],
                    kind=(
                        "folder"
                        if "folder" in row
                        else "file"
                        if "file" in row
                        else "unsupported"
                    ),
                    browsable="folder" in row,
                    importable="file" in row and self._is_importable(row["name"]),
                )
                for row in rows
            ]
        except (KeyError, TypeError, ValidationError) as exc:
            raise ExternalServiceError(
                "SharePoint returned invalid item data. Try again."
            ) from exc

    async def iter_documents(
        self, drive_id: str, item_id: str | None = None
    ) -> AsyncIterator[ConnectorDocument]:
        pending = [item_id]
        seen_folders: set[str] = set()
        seen_items = 0
        while pending:
            folder_id = pending.pop()
            if folder_id is not None:
                if folder_id in seen_folders:
                    raise ExternalServiceError(
                        "SharePoint returned a repeated folder. Try again."
                    )
                seen_folders.add(folder_id)
            for item in await self.list_children(drive_id, folder_id):
                if seen_items == MAX_LIST_ITEMS:
                    return
                seen_items += 1
                if item.browsable:
                    pending.append(item.id)
                elif item.importable:
                    yield ConnectorDocument(
                        drive_id=drive_id, item_id=item.id, name=item.name
                    )

    @staticmethod
    def _check_download_response(response: httpx.Response) -> None:
        if response.status_code in (401, 403):
            raise AuthenticationError(
                "SharePoint consent expired or was revoked. Connect SharePoint again."
            )
        if response.status_code == 429:
            raise RateLimitError("SharePoint is busy. Try again later.")
        if response.is_error:
            raise ExternalServiceError(
                "SharePoint could not complete the request. Try again."
            )

    async def _download_with_client(
        self, client: httpx.AsyncClient, url: str, token: str
    ) -> AsyncIterator[bytes]:
        headers = {"Authorization": f"Bearer {token}"}
        seen: set[str] = set()
        for _ in range(6):
            if url in seen:
                raise ExternalServiceError(
                    "SharePoint returned a repeated download link. Try again."
                )
            seen.add(url)
            async with client.stream(
                "GET", url, headers=headers, follow_redirects=False
            ) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    try:
                        redirect = urljoin(url, location) if location else ""
                        parsed = urlsplit(redirect)
                    except ValueError as exc:
                        raise ExternalServiceError(
                            "SharePoint returned an unsafe download link. Try again."
                        ) from exc
                    if (
                        parsed.scheme != "https"
                        or not parsed.hostname
                        or parsed.username
                        or parsed.password
                    ):
                        raise ExternalServiceError(
                            "SharePoint returned an unsafe download link. Try again."
                        )
                    url = redirect
                    headers = {}
                    continue
                self._check_download_response(response)
                async for chunk in response.aiter_bytes():
                    yield chunk
                return
        raise ExternalServiceError(
            "SharePoint returned too many download redirects. Try again."
        )

    async def download(
        self, drive_id: str, item_id: str
    ) -> AsyncIterator[bytes]:
        token = await sharepoint_auth.acquire_delegated_token(self.user_id)
        url = (
            f"{GRAPH_ROOT}/drives/{quote(drive_id, safe='')}/items/"
            f"{quote(item_id, safe='')}/content"
        )
        try:
            if self.client:
                async for chunk in self._download_with_client(self.client, url, token):
                    yield chunk
            else:
                async with httpx.AsyncClient() as client:
                    async for chunk in self._download_with_client(client, url, token):
                        yield chunk
        except httpx.RequestError as exc:
            raise NetworkError("SharePoint is temporarily unavailable. Try again.") from exc
