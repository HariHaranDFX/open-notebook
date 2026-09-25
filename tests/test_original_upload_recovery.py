"""Recovery for a managed original that survives a crash around the database."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.storage.original_files import OriginalFileRef
from open_notebook.storage.upload_operations import (
    reconcile_operation,
    save_tracked_original,
)


def test_upload_operation_migration_is_registered():
    manager = AsyncMigrationManager()
    assert "original_upload_operation" in manager.up_migrations[34].sql
    assert "operation_id UNIQUE" in manager.up_migrations[34].sql
    assert "REMOVE TABLE original_upload_operation" in manager.down_migrations[34].sql


def _operation(**overrides):
    operation = {
        "operation_id": "op-1",
        "object_name": "abc123.bin",
        "provider": "sharepoint_embedded",
        "profile_id": "profile-a",
        "container_id": "container-a",
        "source_id": "source:1",
        "status": "uploading",
        "item_key": None,
        "etag": None,
    }
    operation.update(overrides)
    return operation


def _harness(operation, *, referenced_ids=None, source=None, found=None):
    deleted = []
    queued = []

    async def persist(row, *, status, item_key, etag):
        row["status"] = status
        row["item_key"] = item_key
        row["etag"] = etag

    async def delete(ref):
        deleted.append(ref)
        return True

    store = SimpleNamespace(
        find_by_object_name=AsyncMock(return_value=found),
        delete=AsyncMock(side_effect=delete),
    )

    async def source_for(source_id):
        return source if source_id == operation["source_id"] else None

    async def referenced(key):
        return referenced_ids or []

    async def queue(item):
        queued.append(item)
        item.command = "command:1"

    return store, deleted, queued, source_for, referenced, queue, persist


@pytest.mark.asyncio
async def test_orphan_after_remote_save_is_deleted_once():
    operation = _operation(item_key="item-1", etag="etag-1", status="stored")
    store, deleted, queued, source_for, referenced, queue, persist = _harness(operation)

    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "deleted"
    )
    assert deleted == [
        OriginalFileRef(
            "sharepoint_embedded", "item-1", "etag-1",
            profile_id="profile-a", container_id="container-a",
        )
    ]
    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "skipped"
    )
    assert len(deleted) == 1
    assert queued == []


@pytest.mark.asyncio
async def test_crash_before_item_id_looks_up_the_object_name():
    operation = _operation()
    store, deleted, _, source_for, referenced, queue, persist = _harness(
        operation, found=("item-9", "etag-9")
    )

    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "deleted"
    )
    store.find_by_object_name.assert_awaited_once_with("abc123.bin")
    assert deleted[0].key == "item-9"


@pytest.mark.asyncio
async def test_source_without_a_queued_command_is_queued_once():
    source = SimpleNamespace(id="source:1", command=None, asset=None)
    operation = _operation(item_key="item-1", etag="etag-1")
    store, deleted, queued, source_for, referenced, queue, persist = _harness(
        operation, referenced_ids=["source:1"], source=source
    )

    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "queued"
    )
    assert queued == [source]
    assert deleted == []
    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "skipped"
    )
    assert queued == [source]


@pytest.mark.asyncio
async def test_another_source_referencing_the_object_is_retained():
    source = SimpleNamespace(id="source:other", command="command:existing", asset=None)
    operation = _operation(item_key="item-1", source_id="source:missing")
    store, deleted, queued, source_for, referenced, queue, persist = _harness(
        operation, referenced_ids=["source:other"], source=source
    )

    async def source_for_other(source_id):
        return source if source_id == "source:other" else None

    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for_other, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "retained"
    )
    assert deleted == []
    assert queued == []


@pytest.mark.asyncio
async def test_tracked_save_records_the_name_before_the_remote_call(monkeypatch):
    from open_notebook.storage import upload_operations

    order = []

    async def create(table, data):
        order.append(("record", data["object_name"]))
        assert table == "original_upload_operation"
        return {"id": "original_upload_operation:1"}

    async def finish(sql, params):
        order.append(("finish", params["item_key"]))
        return []

    async def save(path, filename, object_name=None):
        order.append(("save", object_name))
        from open_notebook.storage.original_files import StoredOriginal

        return StoredOriginal(
            "sharepoint_embedded", "item-1", 4, "etag-1",
            profile_id="profile-a", container_id="container-a",
        )

    store = SimpleNamespace(
        provider="sharepoint_embedded",
        profile_id="profile-a",
        container_id="container-a",
        allocate_object_name=lambda filename: "fixed.bin",
        save=save,
    )
    monkeypatch.setattr(upload_operations, "repo_create", create)
    monkeypatch.setattr(upload_operations, "repo_query", finish)

    stored = await save_tracked_original(store, "staged", "report.bin", user_id="user:1")

    assert stored.key == "item-1"
    assert order == [("record", "fixed.bin"), ("save", "fixed.bin"), ("finish", "item-1")]


def _capture_logs():
    from loguru import logger

    messages: list[str] = []
    sink_id = logger.add(lambda message: messages.append(str(message)), level="INFO")
    return messages, lambda: logger.remove(sink_id)


@pytest.mark.asyncio
async def test_reconcile_command_logs_nothing_to_do(monkeypatch):
    from commands import source_file_commands
    from open_notebook.storage import upload_operations

    monkeypatch.setattr(upload_operations, "repo_query", AsyncMock(return_value=[]))
    messages, remove = _capture_logs()
    try:
        output = await source_file_commands.reconcile_original_uploads_command(
            source_file_commands.ReconcileOriginalUploadsInput()
        )
    finally:
        remove()
    text = "\n".join(messages)
    assert output.deleted == 0
    assert "Starting original upload reconciliation" in text
    assert "Nothing to reconcile" in text
    assert "Original upload reconciliation DONE" in text
    assert "Elapsed:" in text


@pytest.mark.asyncio
async def test_reconcile_command_logs_each_operation(monkeypatch):
    from commands import source_file_commands
    from open_notebook.storage import upload_operations

    async def query(sql, params=None):
        if sql.startswith("SELECT * FROM original_upload_operation"):
            return [_operation(item_key="item-1", etag="v1")]
        return []

    store = SimpleNamespace(delete=AsyncMock(return_value=True))
    monkeypatch.setattr(upload_operations, "repo_query", query)
    monkeypatch.setattr(
        "open_notebook.storage.original_files.get_original_file_store",
        lambda *_args, **_kwargs: store,
    )
    messages, remove = _capture_logs()
    try:
        output = await source_file_commands.reconcile_original_uploads_command(
            source_file_commands.ReconcileOriginalUploadsInput()
        )
    finally:
        remove()
    text = "\n".join(messages)
    assert output.deleted == 1
    assert "Reconciling operation_id=op-1" in text
    assert "operation_id=op-1 deleted" in text
    assert "abc123.bin" not in text
    assert "Original upload reconciliation DONE" in text


@pytest.mark.asyncio
async def test_reconcile_command_logs_the_exception_class(monkeypatch):
    from commands import source_file_commands

    monkeypatch.setattr(
        "open_notebook.storage.upload_operations.reconcile_due_uploads",
        AsyncMock(side_effect=RuntimeError("etag=secret")),
    )
    messages, remove = _capture_logs()
    try:
        with pytest.raises(RuntimeError):
            await source_file_commands.reconcile_original_uploads_command(
                source_file_commands.ReconcileOriginalUploadsInput()
            )
    finally:
        remove()
    text = "\n".join(messages)
    assert "Original upload reconciliation FAILED after" in text
    assert "RuntimeError" in text
    assert "secret" not in text
    assert "Original upload reconciliation DONE" not in text
