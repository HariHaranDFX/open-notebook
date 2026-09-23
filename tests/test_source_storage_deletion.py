"""Deletion boundaries for Open Notebook-owned originals."""

from copy import deepcopy
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from api import source_file_service
from commands import source_commands, source_file_commands
from open_notebook.domain.base import ObjectModel
from open_notebook.domain.notebook import Asset, Source
from open_notebook.exceptions import ConfigurationError, FileOperationError
from open_notebook.storage.original_files import OriginalFileRef


@pytest.mark.asyncio
async def test_finalization_uses_asset_rebuilt_by_phase_one_save(monkeypatch):
    source = Source(
        id="source:real-save",
        asset=Asset(
            original_file_store="sharepoint_embedded",
            original_file_key="managed-copy",
            original_file_etag="etag",
        ),
    )
    writes = []

    async def repo_update(_table, _id, data):
        persisted = deepcopy(data)
        writes.append(persisted)
        response = deepcopy(persisted)
        response.pop("updated", None)
        return [response]

    monkeypatch.setattr("open_notebook.domain.base.repo_update", repo_update)
    store = AsyncMock()
    store.exists.return_value = True
    store.delete.return_value = True
    monkeypatch.setattr(
        source_file_service, "get_original_file_store", lambda _provider: store
    )

    assert (
        await source_file_service.delete_original_file(source, reason="source_owner")
        == "deleted"
    )

    assert len(writes) == 2
    assert writes[0]["asset"]["original_file_key"] == "managed-copy"
    assert writes[0]["asset"]["original_deletion_started_at"] is not None
    assert writes[1]["asset"]["original_file_key"] is None
    assert writes[1]["asset"]["original_deleted_at"] is not None
    assert source.asset is not None
    assert source.asset.original_file_key is None
    assert source.asset.original_deleted_at is not None


@pytest.fixture
def managed_source(monkeypatch):
    source = Source(
        id="source:managed",
        user_id="user:me",
        full_text="Successfully extracted text",
        asset=Asset(
            original_file_store="sharepoint_embedded",
            original_file_key="managed-copy",
            original_file_etag="etag",
            original_filename="report.pdf",
            original_size_bytes=10,
            original_file_action="delete_after_processing",
            url="https://tenant.sharepoint.com/external-connector-item",
        ),
    )
    saved = []

    async def save(_source):
        saved.append(_source.asset.model_copy(deep=True))

    monkeypatch.setattr(Source, "save", save)
    store = AsyncMock()
    store.exists.return_value = True
    store.delete.return_value = True
    monkeypatch.setattr(source_file_service, "get_original_file_store", lambda _: store, raising=False)
    # A remote reference must never become a local deletion target.
    monkeypatch.setattr(Path, "unlink", lambda *args, **kwargs: pytest.fail("Remote asset unlinked locally"))
    return source, store, saved


@pytest.mark.asyncio
async def test_explicit_delete_uses_recorded_provider_and_finalizes(managed_source):
    source, store, saved = managed_source

    assert await source_file_service.delete_original_file(source, reason="source_owner") == "deleted"

    store.delete.assert_awaited_once_with(OriginalFileRef("sharepoint_embedded", "managed-copy", "etag"))
    assert saved[0].original_deletion_started_at is not None
    assert saved[0].original_file_key == "managed-copy"
    assert saved[0].original_deleted_at is None
    assert source.asset.original_deleted_at is not None
    assert source.asset.original_deleted_reason == "source_owner"
    assert source.asset.original_file_key is None
    assert source.asset.original_file_store is None
    assert source.asset.original_file_etag is None

    assert await source_file_service.delete_original_file(source, reason="admin_cleanup") == "already_deleted"
    assert store.delete.await_count == 1


@pytest.mark.asyncio
async def test_retention_delete_after_success_uses_recorded_provider(
    managed_source, monkeypatch
):
    source, store, _ = managed_source
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))

    await source_commands._maybe_delete_original_after_success(source)

    store.delete.assert_awaited_once_with(
        OriginalFileRef("sharepoint_embedded", "managed-copy", "etag")
    )
    assert source.asset.original_deleted_reason == "retention_policy"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exists", "deleted", "expected", "delete_calls"),
    [
        (False, True, "already_deleted", 0),
        (True, False, "error", 1),
    ],
)
async def test_provider_boolean_results_are_handled(
    managed_source, exists, deleted, expected, delete_calls
):
    source, store, saved = managed_source
    store.exists.return_value = exists
    store.delete.return_value = deleted

    assert (
        await source_file_service.delete_original_file(source, reason="admin_cleanup")
        == expected
    )

    assert store.delete.await_count == delete_calls
    if expected == "error":
        assert source.asset.original_file_key == "managed-copy"
        assert source.asset.original_deleted_at is None
        assert saved[-1].original_deletion_started_at is not None
    else:
        assert source.asset.original_file_key is None
        assert source.asset.original_deleted_at is not None


@pytest.mark.asyncio
async def test_configuration_failure_retains_retry_marker_and_reference(
    managed_source, monkeypatch
):
    source, _, saved = managed_source

    def fail_configuration(_provider):
        raise ConfigurationError("missing storage configuration")

    monkeypatch.setattr(
        source_file_service, "get_original_file_store", fail_configuration
    )

    assert (
        await source_file_service.delete_original_file(source, reason="admin_cleanup")
        == "error"
    )
    assert saved[-1].original_deletion_started_at is not None
    assert source.asset.original_file_store == "sharepoint_embedded"
    assert source.asset.original_file_key == "managed-copy"
    assert source.asset.original_deleted_at is None


@pytest.mark.asyncio
async def test_cleanup_worker_accepts_provider_reference_without_file_path(
    managed_source, monkeypatch
):
    source, _, _ = managed_source
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    delete = AsyncMock(return_value="deleted")
    monkeypatch.setattr(source_file_service, "delete_original_file", delete)

    output = await source_file_commands.cleanup_original_files_command(
        source_file_commands.CleanupOriginalFilesInput(
            scope="mine",
            requesting_user_id="user:me",
            candidate_source_ids=["source:managed"],
        )
    )

    assert output.deleted == 1
    assert output.skipped == 0
    delete.assert_awaited_once_with(source, reason="source_owner")


@pytest.mark.asyncio
async def test_full_source_delete_removes_managed_copy_not_connector_item(
    managed_source, monkeypatch
):
    source, store, _ = managed_source
    repo_delete = AsyncMock(return_value=True)
    monkeypatch.setattr(ObjectModel, "delete", repo_delete)
    monkeypatch.setattr("open_notebook.domain.notebook.repo_query", AsyncMock())

    assert await source.delete() is True

    store.delete.assert_awaited_once_with(
        OriginalFileRef("sharepoint_embedded", "managed-copy", "etag")
    )
    assert all(
        "external-connector-item" not in str(call.args)
        for call in store.delete.await_args_list
    )
    repo_delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_full_source_delete_stops_when_provider_delete_fails(
    managed_source, monkeypatch
):
    source, store, _ = managed_source
    store.delete.return_value = False
    repo_delete = AsyncMock(return_value=True)
    monkeypatch.setattr(ObjectModel, "delete", repo_delete)
    repo_query = AsyncMock()
    monkeypatch.setattr("open_notebook.domain.notebook.repo_query", repo_query)

    with pytest.raises(FileOperationError):
        await source.delete()

    assert source.asset.original_deletion_started_at is not None
    assert source.asset.original_file_key == "managed-copy"
    assert source.asset.original_deleted_at is None
    repo_query.assert_not_awaited()
    repo_delete.assert_not_awaited()
