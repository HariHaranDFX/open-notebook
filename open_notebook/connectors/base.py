"""Normalized read contract for external source connectors."""

from collections.abc import AsyncIterator
from typing import Protocol

from pydantic import BaseModel


class ConnectorSite(BaseModel):
    id: str
    name: str
    web_url: str | None = None


class ConnectorDrive(BaseModel):
    id: str
    name: str
    kind: str


class ConnectorItem(BaseModel):
    id: str
    name: str
    kind: str
    browsable: bool
    importable: bool


class ConnectorDocument(BaseModel):
    drive_id: str
    item_id: str
    name: str
    etag: str | None = None
    size: int | None = None


class SourceConnector(Protocol):
    async def list_sites(self, query: str) -> list[ConnectorSite]: ...

    async def list_drives(self, site_id: str) -> list[ConnectorDrive]: ...

    async def list_children(
        self, drive_id: str, item_id: str | None = None
    ) -> list[ConnectorItem]: ...

    def iter_documents(
        self, drive_id: str, item_id: str | None = None
    ) -> AsyncIterator[ConnectorDocument]: ...

    def download(self, drive_id: str, item_id: str) -> AsyncIterator[bytes]: ...
