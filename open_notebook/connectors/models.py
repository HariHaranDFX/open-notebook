"""Connector records. Secret fields are never included in API serialization."""

from datetime import datetime
from typing import ClassVar, Literal, Self

from pydantic import BaseModel, Field

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import NotFoundError


class ConnectorConnection(BaseModel):
    id: str
    user_id: str
    provider: Literal["sharepoint"] = "sharepoint"
    token_cache: str | None = Field(default=None, exclude=True, repr=False)
    granted_scopes: list[str] = Field(default_factory=list)
    external_tenant_id: str | None = None
    external_account_id: str | None = None
    status: Literal["connected", "reauth_required", "disconnected"] = "connected"
    connected_at: datetime | None = None
    disconnected_at: datetime | None = None


class ConnectorOAuthState(BaseModel):
    user_id: str
    state_hash: str = Field(exclude=True, repr=False)
    auth_flow: str = Field(exclude=True, repr=False)
    expires_at: datetime


class _OwnedConnectorRecord(ObjectModel):
    user_id: str
    record_fields: ClassVar[tuple[str, ...]] = ("user_id",)

    @classmethod
    async def get_for_user(cls, record_id: str, user_id: str) -> Self:
        if not record_id.startswith(cls.table_name + ":"):
            raise NotFoundError("Connector record not found")
        rows = await repo_query(
            "SELECT * FROM $id WHERE user_id = $user_id;",
            {"id": ensure_record_id(record_id), "user_id": ensure_record_id(user_id)},
        )
        if not rows:
            raise NotFoundError("Connector record not found")
        return cls(**rows[0])

    def _prepare_save_data(self):
        data = super()._prepare_save_data()
        for field in self.record_fields:
            if data.get(field):
                data[field] = ensure_record_id(data[field])
        if "notebook_ids" in data:
            data["notebook_ids"] = [
                ensure_record_id(item) for item in data["notebook_ids"]
            ]
        return data


class ConnectorBatch(_OwnedConnectorRecord):
    table_name: ClassVar[str] = "connector_batch"
    record_fields: ClassVar[tuple[str, ...]] = ("user_id", "connection_id")
    connection_id: str
    drive_id: str
    folder_id: str | None = None
    item_ids: list[str] = Field(default_factory=list)
    notebook_ids: list[str] = Field(default_factory=list)
    transformations: list[str] = Field(default_factory=list)
    embed: bool = True
    status: Literal["pending", "running", "completed", "partial", "failed"] = "pending"
    total: int = 0
    completed: int = 0
    failed: int = 0
    command_id: str | None = None
    error: str | None = None


class ConnectorBatchDocument(_OwnedConnectorRecord):
    table_name: ClassVar[str] = "connector_batch_document"
    record_fields: ClassVar[tuple[str, ...]] = ("user_id", "batch_id", "source_id")
    batch_id: str
    drive_id: str
    item_id: str
    name: str
    etag: str | None = None
    source_id: str | None = None
    command_id: str | None = None
    status: Literal["pending", "running", "queued", "failed", "skipped"] = "pending"
    error: str | None = None

    @classmethod
    async def for_batch(cls, batch_id: str, user_id: str) -> list[Self]:
        rows = await repo_query(
            "SELECT * FROM connector_batch_document WHERE batch_id = $batch_id AND user_id = $user_id ORDER BY created;",
            {"batch_id": ensure_record_id(batch_id), "user_id": ensure_record_id(user_id)},
        )
        return [cls(**row) for row in rows]


class ConnectorRemoteVersion(_OwnedConnectorRecord):
    table_name: ClassVar[str] = "connector_remote_version"
    record_fields: ClassVar[tuple[str, ...]] = ("user_id", "connection_id", "source_id")
    connection_id: str
    drive_id: str
    item_id: str
    etag: str
    source_id: str
