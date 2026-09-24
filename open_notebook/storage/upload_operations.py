"""Durable record for a managed original that may outlive the upload process."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from open_notebook.database.repository import repo_create, repo_query
from open_notebook.storage.original_files import OriginalFileRef, StoredOriginal

GRACE_SECONDS = 900


async def begin_original_upload(
    *,
    user_id: str | None,
    provider: str,
    profile_id: str | None,
    container_id: str | None,
    source_id: str | None,
    object_name: str,
) -> str:
    operation_id = uuid.uuid4().hex
    await repo_create(
        "original_upload_operation",
        {
            "operation_id": operation_id,
            "object_name": object_name,
            "user_id": user_id,
            "provider": provider,
            "profile_id": profile_id,
            "container_id": container_id,
            "source_id": source_id,
            "status": "uploading",
        },
    )
    return operation_id


async def finish_original_upload(
    operation_id: str, item_key: str, etag: str | None
) -> None:
    await repo_query(
        "UPDATE original_upload_operation SET item_key = $item_key, etag = $etag, "
        "status = 'stored' WHERE operation_id = $operation_id",
        {"operation_id": operation_id, "item_key": item_key, "etag": etag},
    )


async def save_tracked_original(
    store: Any,
    staged_path: Any,
    filename: str,
    *,
    user_id: str | None = None,
    source_id: str | None = None,
) -> StoredOriginal:
    if getattr(store, "provider", None) != "sharepoint_embedded":
        return await store.save(staged_path, filename)
    object_name = store.allocate_object_name(filename)
    operation_id = await begin_original_upload(
        user_id=user_id,
        provider=store.provider,
        profile_id=getattr(store, "profile_id", None),
        container_id=getattr(store, "container_id", None),
        source_id=source_id,
        object_name=object_name,
    )
    stored = await store.save(staged_path, filename, object_name=object_name)
    await finish_original_upload(operation_id, stored.key, stored.etag)
    return stored


async def reconcile_operation(
    operation: dict[str, Any],
    *,
    store: Any,
    source_for: Callable[[str], Awaitable[Any]],
    referenced: Callable[[str], Awaitable[list[str]]],
    queue: Callable[[Any], Awaitable[None]],
    persist: Callable[..., Awaitable[None]],
) -> str:
    """Finish or remove one managed upload. A referenced original is never deleted."""
    if operation.get("status") == "completed":
        return "skipped"
    key = operation.get("item_key")
    etag = operation.get("etag")
    if not key:
        found = await store.find_by_object_name(operation["object_name"])
        if found is None:
            await persist(operation, status="completed", item_key=None, etag=None)
            return "abandoned"
        key, etag = found
    source_ids = await referenced(key)
    if source_ids:
        queued = False
        for source_id in source_ids:
            source = await source_for(source_id)
            if source is not None and not getattr(source, "command", None):
                await queue(source)
                queued = True
        await persist(operation, status="completed", item_key=key, etag=etag)
        return "queued" if queued else "retained"
    await store.delete(
        OriginalFileRef(
            operation["provider"],
            key,
            etag,
            profile_id=operation.get("profile_id"),
            container_id=operation.get("container_id"),
        )
    )
    await persist(operation, status="completed", item_key=key, etag=etag)
    return "deleted"


async def reconcile_due_uploads(grace_seconds: int = GRACE_SECONDS) -> dict[str, int]:
    from open_notebook.domain.notebook import Source
    from open_notebook.storage.original_files import get_original_file_store

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=grace_seconds)
    rows = await repo_query(
        "SELECT * FROM original_upload_operation WHERE status != 'completed' "
        "AND created < $cutoff",
        {"cutoff": cutoff},
    )
    counts = {"deleted": 0, "queued": 0, "retained": 0, "abandoned": 0, "skipped": 0}

    async def source_for(source_id: str):
        return await Source.get(source_id)

    async def referenced(key: str) -> list[str]:
        found = await repo_query(
            "SELECT id FROM source WHERE asset.original_file_key = $key",
            {"key": key},
        )
        return [str(row["id"]) for row in found or []]

    async def queue(source) -> None:
        from api.source_ingestion_service import queue_source

        asset = source.asset
        await queue_source(
            source,
            asset.model_dump(exclude_none=True) if asset is not None else {},
            [],
            [],
            True,
            recover=True,
        )

    async def persist(operation, *, status: str, item_key, etag) -> None:
        operation["status"] = status
        operation["item_key"] = item_key
        operation["etag"] = etag
        await repo_query(
            "UPDATE original_upload_operation SET status = $status, item_key = $item_key, "
            "etag = $etag WHERE operation_id = $operation_id",
            {
                "operation_id": operation["operation_id"],
                "status": status,
                "item_key": item_key,
                "etag": etag,
            },
        )

    for row in rows or []:
        provider = row.get("provider")
        store = get_original_file_store(provider, row.get("profile_id"))
        outcome = await reconcile_operation(
            row,
            store=store,
            source_for=source_for,
            referenced=referenced,
            queue=queue,
            persist=persist,
        )
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts
