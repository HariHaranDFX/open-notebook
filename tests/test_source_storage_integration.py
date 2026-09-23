"""Original-file storage at the ingestion, worker, and download boundaries."""

import asyncio
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock
from urllib.parse import quote

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from langchain_core.runnables import RunnableConfig
from loguru import logger
from starlette.datastructures import UploadFile

from api.routers import sources
from commands import source_commands
from open_notebook.domain.notebook import Asset, Source
from open_notebook.exceptions import ConfigurationError, ContextLengthExceededError
from open_notebook.graphs.source import (
    SourceState,
    save_source,
    trigger_transformations,
)
from open_notebook.storage.original_files import StoredOriginal


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


@pytest.fixture
def saved_sources(monkeypatch):
    saved = []

    async def save(source):
        source.id = source.id or "source:storage-test"
        saved.append(source)

    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "delete", AsyncMock(return_value=True))
    monkeypatch.setattr(Source, "add_to_notebook", AsyncMock())
    monkeypatch.setattr(
        "api.source_file_service.ContentSettings.get_instance", AsyncMock()
    )
    return saved


@pytest.fixture
def remote_source(monkeypatch):
    source = Source(
        id="source:storage-test", title="report.txt",
        asset=Asset(
            original_file_store="sharepoint_embedded",
            original_file_key="opaque-private-key",
            original_file_etag="etag", original_filename="original résumé.txt",
            original_size_bytes=14, original_file_action="keep",
        ),
    )
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_embedded_chunks", AsyncMock(return_value=0))
    return source


@pytest.fixture
def provider_store(monkeypatch, tmp_path):
    # The remote provider's private tempfile has no suffix.
    materialized = tmp_path / "materialized"

    @asynccontextmanager
    async def materialize(ref):
        assert ref.key == "opaque-private-key"
        materialized.write_bytes(b"original bytes")
        try:
            yield materialized
        finally:
            materialized.unlink()

    async def iter_bytes(ref):
        assert ref.key == "opaque-private-key"
        yield b"original "
        yield b"bytes"

    store = SimpleNamespace(
        materialize=materialize, iter_bytes=iter_bytes,
        exists=AsyncMock(return_value=True), delete=AsyncMock(return_value=True),
        save=AsyncMock(return_value=StoredOriginal("sharepoint_embedded", "opaque-private-key", 14, "etag")),
        materialized=materialized,
    )
    monkeypatch.setattr(sources, "get_original_file_store", lambda provider=None: store)
    return store


def test_multipart_upload_stages_bounded_chunks_and_queues_opaque_reference(
    client, saved_sources, monkeypatch
):
    payload = b"a" * (1024 * 1024 + 7)
    reads = []
    original_read = UploadFile.read

    async def bounded_read(upload, size=-1):
        reads.append(size)
        assert 0 < size <= 1024 * 1024
        return await original_read(upload, size)

    staged = []

    async def save_original(path, filename):
        staged.append(Path(path))
        assert Path(path).read_bytes() == payload
        assert filename == "report.txt"
        return StoredOriginal("sharepoint_embedded", "opaque-private-key", len(payload), "etag")

    store = AsyncMock()
    store.save.side_effect = save_original
    monkeypatch.setattr(UploadFile, "read", bounded_read)
    monkeypatch.setattr(sources, "get_original_file_store", lambda provider=None: store, raising=False)
    monkeypatch.setattr(sources, "_assert_file_supported", AsyncMock())
    submit = AsyncMock(return_value="command:storage-test")
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)

    response = client.post(
        "/api/sources",
        data={"type": "upload", "async_processing": "true"},
        files={"file": ("report.txt", payload, "text/plain")},
    )

    assert response.status_code == 200, response.text
    assert reads == [1024 * 1024] * 3
    assert staged and not staged[0].exists()
    asset = saved_sources[0].asset
    assert asset.original_file_store == "sharepoint_embedded"
    assert asset.original_file_key == "opaque-private-key"
    assert asset.original_file_etag == "etag"
    assert asset.file_path is None
    assert submit.await_args is not None
    state = submit.await_args.args[2]["content_state"]
    assert state["original_file_store"] == "sharepoint_embedded"
    assert state["original_file_key"] == "opaque-private-key"
    assert "file_path" not in state
    assert "opaque-private-key" not in response.text
    assert "original_file_store" not in response.text


@pytest.mark.parametrize("operation", ["upload", "retry"])
def test_preflight_failure_keeps_private_paths_and_errors_out_of_logs(
    client, saved_sources, remote_source, provider_store, monkeypatch, operation
):
    paths = []

    async def fail_preflight(path):
        paths.append(str(path))
        raise OSError(f"Private extractor diagnostic for {path}: opaque-private-key")

    monkeypatch.setattr(sources, "check_file_support", fail_preflight)
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[]))
    submit = AsyncMock(return_value="command:preflight-test")
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    logs: list[str] = []
    sink = logger.add(logs.append, format="{message}", level="DEBUG")
    try:
        if operation == "upload":
            response = client.post(
                "/api/sources", data={"type": "upload", "async_processing": "true"},
                files={"file": ("report.txt", b"original bytes", "text/plain")},
            )
        else:
            response = client.post("/api/sources/source:storage-test/retry")
    finally:
        logger.remove(sink)

    assert response.status_code == 200, response.text
    submit.assert_awaited_once()
    assert len(paths) == 1
    diagnostic = "".join(logs)
    assert "Pre-flight file-support check skipped" in diagnostic
    assert paths[0] not in diagnostic
    assert "Private extractor diagnostic" not in diagnostic
    assert "opaque-private-key" not in diagnostic


def test_head_and_download_use_recorded_provider_and_preserve_filename(
    client, remote_source, provider_store, monkeypatch
):
    providers = []

    def select(provider=None):
        providers.append(provider)
        return provider_store

    monkeypatch.setattr(sources, "get_original_file_store", select)
    monkeypatch.setenv("OPEN_NOTEBOOK_ORIGINAL_FILE_STORE", "filesystem")
    head = client.head("/api/sources/source:storage-test/download")
    assert head.status_code == 200
    response = client.get("/api/sources/source:storage-test/download")
    assert response.status_code == 200, response.text
    assert response.content == b"original bytes"
    assert response.headers["content-disposition"] == (
        "attachment; filename*=utf-8''" + quote("original résumé.txt")
    )
    assert providers and set(providers) == {"sharepoint_embedded"}
    assert provider_store.exists.await_count == 2
    provider_store.exists.return_value = False
    assert client.head("/api/sources/source:storage-test/download").status_code == 404
    assert client.get("/api/sources/source:storage-test/download").status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("graph_fails", [False, True])
async def test_worker_materializes_only_during_graph_and_preserves_original(
    saved_sources, monkeypatch, tmp_path, graph_fails
):
    source = Source(
        id="source:storage-test",
        title="report.txt",
        asset=Asset(
            original_file_store="sharepoint_embedded",
            original_file_key="opaque-private-key",
            original_file_etag="etag",
            original_filename="report.txt",
            original_file_action="keep",
        ),
    )
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_insights", AsyncMock(return_value=[]))
    materialized = tmp_path / "materialized.txt"

    @asynccontextmanager
    async def materialize(ref):
        assert ref.provider == "sharepoint_embedded"
        assert ref.key == "opaque-private-key"
        materialized.write_bytes(b"original bytes")
        try:
            yield materialized
        finally:
            materialized.unlink()

    store = SimpleNamespace(materialize=materialize)
    monkeypatch.setattr(
        source_commands, "get_original_file_store", lambda provider=None: store, raising=False
    )

    async def run_graph(state):
        assert Path(state["content_state"]["file_path"]).read_bytes() == b"original bytes"
        assert "original_file_store" not in state["content_state"]
        assert "original_file_key" not in state["content_state"]
        assert source.asset is not None
        assert source.asset.file_path is None
        if graph_fails:
            raise RuntimeError("extraction failed")
        graph_result = await save_source(cast(SourceState, {
            **state,
            "extraction": SimpleNamespace(content="extracted text", title="Report"),
        }))
        graph_source = graph_result["source"]
        assert graph_source.asset is None
        send = trigger_transformations(
            cast(SourceState, {"source": graph_source, "apply_transformations": [SimpleNamespace()]}),
            cast(RunnableConfig, None),  # This node does not read its config.
        )[0]
        assert send.arg["source"].asset is None
        return graph_result

    monkeypatch.setattr(source_commands.source_graph, "ainvoke", AsyncMock(side_effect=run_graph))
    command = source_commands.SourceProcessingInput(
        source_id=source.id,
        content_state={
            "original_file_store": "sharepoint_embedded",
            "original_file_key": "opaque-private-key",
            "original_filename": "report.txt",
        },
        notebook_ids=[], transformations=[], embed=False,
    )
    if graph_fails:
        with pytest.raises(RuntimeError, match="Source processing failed"):
            await source_commands.process_source_command(command)
    else:
        result = await source_commands.process_source_command(command)
        assert result.success
        assert source.full_text == "extracted text"
    assert not materialized.exists()
    assert source.asset is not None
    assert source.asset.file_path is None
    assert source.asset.original_file_store == "sharepoint_embedded"
    assert source.asset.original_file_key == "opaque-private-key"
    assert source.asset.original_file_etag == "etag"
    assert "file_path" not in command.content_state


def test_retry_preflights_materialized_original_and_queues_recorded_reference(
    client, saved_sources, remote_source, provider_store, monkeypatch
):
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[]))

    async def preflight(path):
        assert Path(path).read_bytes() == b"original bytes"
        assert Path(path).suffix == ".txt"

    preflight_mock = AsyncMock(side_effect=preflight)
    monkeypatch.setattr(sources, "_assert_file_supported", preflight_mock)

    async def queue(*args):
        assert not provider_store.materialized.exists()
        return "command:retry"

    submit = AsyncMock(side_effect=queue)
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    response = client.post("/api/sources/source:storage-test/retry")
    assert response.status_code == 200, response.text
    preflight_mock.assert_awaited_once()
    assert submit.await_args is not None
    state = submit.await_args.args[2]["content_state"]
    assert state["original_file_store"] == "sharepoint_embedded"
    assert state["original_file_key"] == "opaque-private-key"
    assert "file_path" not in state
    assert response.json()["asset"]["original_file_status"] == "retained"
    assert "opaque-private-key" not in response.text


def test_source_details_report_provider_file_availability(
    client, remote_source, provider_store, monkeypatch
):
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=[]))
    response = client.get("/api/sources/source:storage-test")
    assert response.status_code == 200, response.text
    assert response.json()["file_available"] is True
    assert response.json()["asset"]["original_file_status"] == "retained"
    assert "opaque-private-key" not in response.text
    provider_store.exists.return_value = False
    assert client.get("/api/sources/source:storage-test").json()["file_available"] is False


def test_sync_upload_runs_worker_without_persisting_temporary_path(
    client, saved_sources, provider_store, monkeypatch
):
    monkeypatch.setattr(sources, "_assert_file_supported", AsyncMock())
    monkeypatch.setattr(Source, "get", AsyncMock(side_effect=lambda _: saved_sources[-1]))
    monkeypatch.setattr(Source, "get_insights", AsyncMock(return_value=[]))
    monkeypatch.setattr(Source, "get_embedded_chunks", AsyncMock(return_value=0))
    monkeypatch.setattr(source_commands, "get_original_file_store", lambda provider=None: provider_store)

    async def run_graph(state):
        assert saved_sources[0].asset.original_file_key == "opaque-private-key"
        assert Path(state["content_state"]["file_path"]).read_bytes() == b"original bytes"
        assert Path(state["content_state"]["file_path"]).suffix == ".txt"
        return await save_source(cast(SourceState, {
            **state,
            "extraction": SimpleNamespace(content="extracted text", title="Report"),
        }))

    def execute(app_name, command_name, payload, **kwargs):
        result = asyncio.run(source_commands.process_source_command(
            source_commands.SourceProcessingInput(**payload)
        ))
        return SimpleNamespace(is_success=lambda: result.success)

    monkeypatch.setattr(source_commands.source_graph, "ainvoke", AsyncMock(side_effect=run_graph))
    monkeypatch.setattr(sources, "execute_command_sync", execute)
    response = client.post(
        "/api/sources", data={"type": "upload", "async_processing": "false"},
        files={"file": ("report.txt", b"original bytes", "text/plain")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["full_text"] == "extracted text"
    assert response.json()["title"] == "Report"
    assert response.json()["asset"]["original_file_status"] == "retained"
    assert saved_sources[0].asset.file_path is None
    assert saved_sources[0].asset.original_file_key == "opaque-private-key"
    assert not provider_store.materialized.exists()
    provider_store.delete.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("error_type", [None, RuntimeError, ValueError, ConfigurationError, ContextLengthExceededError])
async def test_sync_processing_redacts_command_failures_in_logs_and_exceptions(
    saved_sources, monkeypatch, error_type
):
    from api.models import SourceCreate

    private = "opaque-private-key C:/private/extract/original.txt"

    def execute(*args, **kwargs):
        if error_type:
            raise error_type(private)
        return SimpleNamespace(is_success=lambda: False, error_message=private)

    monkeypatch.setattr(sources, "execute_command_sync", execute)
    state = {"original_file_store": "sharepoint_embedded", "original_file_key": "opaque-private-key"}
    logs: list[str] = []
    sink = logger.add(logs.append, format="{message}")
    try:
        with pytest.raises(Exception) as caught:
            await sources._create_source_sync_path(
                SourceCreate(type="upload", notebooks=[]), state, [], None
            )
    finally:
        logger.remove(sink)
    if error_type:
        stop_on = (ValueError, ConfigurationError, ContextLengthExceededError)
        assert isinstance(caught.value, stop_on) == issubclass(error_type, stop_on)
    else:
        assert isinstance(caught.value, HTTPException)
        assert caught.value.status_code == 500
    diagnostic = "".join(logs) + "".join(traceback.format_exception(caught.value))
    assert "opaque-private-key" not in diagnostic
    assert "C:/private/extract/original.txt" not in diagnostic


@pytest.mark.parametrize("failure", ["source_save", "notebook_link", "queue", "sync"])
def test_failed_source_creation_compensates_durable_original_save(
    client, saved_sources, provider_store, monkeypatch, failure
):
    monkeypatch.setattr(sources, "_assert_file_supported", AsyncMock())
    submit = AsyncMock(return_value="command:test")
    monkeypatch.setattr(sources.CommandService, "submit_command_job", submit)
    data = {"type": "upload", "async_processing": "true"}
    if failure == "source_save":
        monkeypatch.setattr(Source, "save", AsyncMock(side_effect=RuntimeError("DB failed")))
    elif failure == "notebook_link":
        data["notebooks"] = '["notebook:test"]'
        monkeypatch.setattr(sources.Notebook, "get", AsyncMock(return_value=SimpleNamespace(user_id=None)))
        monkeypatch.setattr(Source, "add_to_notebook", AsyncMock(side_effect=RuntimeError("link failed")))
    elif failure == "queue":
        submit.side_effect = RuntimeError("queue failed")
    else:
        data["async_processing"] = "false"
        monkeypatch.setattr(sources, "execute_command_sync", lambda *args, **kwargs: SimpleNamespace(
            is_success=lambda: False, error_message="Graph error opaque-private-key /tmp/private-file"
        ))

    response = client.post(
        "/api/sources", data=data,
        files={"file": ("report.txt", b"original bytes", "text/plain")},
    )
    assert response.status_code == 500, response.text
    provider_store.delete.assert_awaited_once()
    ref = provider_store.delete.await_args.args[0]
    assert ref.provider == "sharepoint_embedded"
    assert ref.key == "opaque-private-key"
    assert "opaque-private-key" not in response.text
    assert "/tmp/private-file" not in response.text


@pytest.mark.parametrize("endpoint", ["/sources/source:storage-test", "/sources/source:storage-test/status", "/sources", "/sources/library"])
@pytest.mark.parametrize("original_deleted", [False, True])
def test_provider_processing_errors_never_expose_storage_internals(
    client, saved_sources, remote_source, provider_store, monkeypatch, endpoint, original_deleted
):
    if original_deleted:
        from api import source_file_service

        monkeypatch.setattr(source_file_service, "get_original_file_store", lambda _: provider_store)
        assert asyncio.run(source_file_service.delete_original_file(
            remote_source, reason="source_owner"
        )) == "deleted"
        assert remote_source.asset.original_file_store is None
    error = "Graph raw body secret credential opaque-private-key /tmp/private-file"
    remote_source.command = "command:failed"
    monkeypatch.setattr(Source, "get_status", AsyncMock(return_value="failed"))
    monkeypatch.setattr(Source, "get_processing_progress", AsyncMock(return_value={
        "status": "failed", "error": error,
        "result": {"input": {"original_file_key": "opaque-private-key"}},
    }))
    rows = []
    if endpoint in {"/sources", "/sources/library"}:
        rows = [{
            **remote_source.model_dump(), "created": "2026-09-22", "updated": "2026-09-22",
            "command": {"id": "command:failed", "status": "failed", "error_message": error},
        }]
    monkeypatch.setattr(sources, "repo_query", AsyncMock(return_value=rows))
    response = client.get("/api" + endpoint)
    assert response.status_code == 200, response.text
    for private in ("opaque-private-key", "/tmp/private-file", "Graph raw body", "secret credential"):
        assert private not in response.text


@pytest.mark.asyncio
async def test_worker_keeps_legacy_direct_file_path(saved_sources, monkeypatch, tmp_path):
    original = tmp_path / "legacy.txt"
    original.write_bytes(b"legacy bytes")
    source = Source(id="source:legacy", title="legacy.txt", asset=Asset(file_path=str(original)))
    monkeypatch.setattr(Source, "get", AsyncMock(return_value=source))
    monkeypatch.setattr(Source, "get_insights", AsyncMock(return_value=[]))

    async def run_graph(state):
        assert state["content_state"]["file_path"] == str(original)
        return await save_source(cast(SourceState, {
            **state, "extraction": SimpleNamespace(content="legacy text", title="Legacy")
        }))

    monkeypatch.setattr(source_commands.source_graph, "ainvoke", AsyncMock(side_effect=run_graph))
    result = await source_commands.process_source_command(source_commands.SourceProcessingInput(
        source_id=source.id, content_state={"file_path": str(original)},
        notebook_ids=[], transformations=[], embed=False,
    ))
    assert result.success
    assert original.read_bytes() == b"legacy bytes"
    assert source.asset is not None
    assert source.asset.file_path == str(original)
    assert source.asset.original_file_store is None


def test_rejected_upload_removes_stage_without_saving_original(
    client, saved_sources, provider_store, monkeypatch
):
    from open_notebook.exceptions import UnsupportedTypeException

    staged = []

    async def reject(path):
        staged.append(Path(path))
        assert Path(path).read_bytes() == b"unsupported"
        raise UnsupportedTypeException("Unsupported file type")

    monkeypatch.setattr(sources, "_assert_file_supported", reject)
    response = client.post(
        "/api/sources", data={"type": "upload", "async_processing": "true"},
        files={"file": ("bad.exe", b"unsupported", "application/octet-stream")},
    )
    assert response.status_code == 415
    assert staged and not staged[0].exists()
    provider_store.save.assert_not_awaited()
    provider_store.delete.assert_not_awaited()


def test_generic_command_status_hides_source_storage_internals(client, monkeypatch):
    """The generic command endpoint must not bypass source response redaction."""
    private = "opaque-private-key C:\\Users\\worker\\AppData\\Local\\Temp\\extract"
    monkeypatch.setattr(
        "api.routers.commands.CommandService.get_command_status",
        AsyncMock(
            return_value={
                "job_id": "command:storage-test",
                "command_app": "open_notebook",
                "command_name": "process_source",
                "status": "failed",
                "result": {
                    "success": False,
                    "source_id": "source:storage-test",
                    "original_file_key": "opaque-private-key",
                    "file_path": "C:\\Users\\worker\\AppData\\Local\\Temp\\extract",
                    "raw": private,
                },
                "error_message": f"Graph failed: {private}",
                "progress": {"input": {"original_file_key": "opaque-private-key"}},
            }
        ),
    )

    response = client.get("/api/commands/jobs/command:storage-test")

    assert response.status_code == 200, response.text
    assert response.json()["result"] == {"success": False, "source_id": "source:storage-test"}
    assert response.json()["error_message"] == "Source processing failed"
    for private_value in ("opaque-private-key", "AppData", "Graph failed"):
        assert private_value not in response.text


def test_generic_command_status_keeps_non_sensitive_diagnostics(client, monkeypatch):
    monkeypatch.setattr(
        "api.routers.commands.CommandService.get_command_status",
        AsyncMock(
            return_value={
                "job_id": "command:ordinary-test",
                "command_app": "open_notebook",
                "command_name": "generate_podcast",
                "status": "failed",
                "result": {"output": "useful diagnostic"},
                "error_message": "ordinary failure detail",
            }
        ),
    )

    response = client.get("/api/commands/jobs/command:ordinary-test")

    assert response.status_code == 200, response.text
    assert response.json()["result"] == {"output": "useful diagnostic"}
    assert response.json()["error_message"] == "ordinary failure detail"


def test_generic_source_command_status_hides_error_only_failure(client, monkeypatch):
    opaque_id = "01JNPZ6B5MZFT4Z4M0QFJ72CFP"
    monkeypatch.setattr(
        "api.routers.commands.CommandService.get_command_status",
        AsyncMock(
            return_value={
                "job_id": "command:storage-error-only",
                "command_app": "open_notebook",
                "command_name": "process_source",
                "status": "failed",
                "result": None,
                "error_message": f"Failed to read item {opaque_id}",
            }
        ),
    )

    response = client.get("/api/commands/jobs/command:storage-error-only")

    assert response.status_code == 200, response.text
    assert response.json()["result"] is None
    assert response.json()["error_message"] == "Source processing failed"
    assert opaque_id not in response.text


@pytest.mark.asyncio
async def test_command_status_reads_trusted_command_metadata(monkeypatch):
    from api import command_service

    monkeypatch.setattr(
        command_service,
        "get_command_status",
        AsyncMock(return_value=SimpleNamespace(status="failed", result=None, error_message="opaque")),
    )
    metadata = AsyncMock(return_value=[{"app": "open_notebook", "name": "process_source"}])
    monkeypatch.setattr(command_service, "repo_query", metadata)

    status = await command_service.CommandService.get_command_status("command:storage-test")

    assert status["command_app"] == "open_notebook"
    assert status["command_name"] == "process_source"
    assert metadata.await_args is not None
    assert metadata.await_args.args[0] == "SELECT app, name FROM $job_id"


@pytest.mark.asyncio
async def test_worker_retry_finalizes_retention_after_remote_delete_and_save_failure(
    remote_source, monkeypatch, tmp_path
):
    from api import source_file_service

    remote_source.asset.original_file_action = "delete_after_processing"
    persisted = remote_source.model_copy(deep=True)
    fail_final_save = True

    async def save(source):
        nonlocal persisted, fail_final_save
        if source.asset.original_deleted_at and fail_final_save:
            fail_final_save = False
            raise RuntimeError("final save failed")
        persisted = source.model_copy(deep=True)

    monkeypatch.setattr(Source, "save", save)
    monkeypatch.setattr(Source, "get", AsyncMock(side_effect=lambda _: persisted.model_copy(deep=True)))
    monkeypatch.setattr(Source, "get_insights", AsyncMock(return_value=[{"id": "insight:one"}]))
    original = tmp_path / "original.txt"
    original.write_text("original bytes")

    @asynccontextmanager
    async def materialize(ref):
        if not original.exists():
            raise FileNotFoundError("original already deleted")
        yield original

    async def delete(ref):
        original.unlink()
        return True

    store = SimpleNamespace(
        materialize=materialize, delete=AsyncMock(side_effect=delete),
        exists=AsyncMock(side_effect=lambda _: original.exists()),
    )
    monkeypatch.setattr(source_commands, "get_original_file_store", lambda _: store)
    monkeypatch.setattr(source_file_service, "get_original_file_store", lambda _: store)

    async def run_graph(state):
        return await save_source(cast(SourceState, {
            **state, "extraction": SimpleNamespace(content="extracted text", title="Report")
        }))

    graph = AsyncMock(side_effect=run_graph)
    monkeypatch.setattr(source_commands.source_graph, "ainvoke", graph)
    command = source_commands.SourceProcessingInput(
        source_id=remote_source.id, content_state={}, notebook_ids=[],
        transformations=[], embed=False,
    )
    with pytest.raises(RuntimeError, match="Source processing failed"):
        await source_commands.process_source_command(command)
    assert not original.exists()
    assert persisted.asset.original_deletion_started_at is not None
    assert persisted.asset.original_deleted_at is None

    for _ in range(2):
        result = await source_commands.process_source_command(command)
        assert result.success
        assert result.insights_created == 1
    assert persisted.asset.original_deleted_at is not None
    assert persisted.asset.original_file_key is None
    assert persisted.full_text == "extracted text"
    graph.assert_awaited_once()
    store.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_extraction_save_keeps_original_deleted_during_materialization(
    saved_sources, remote_source, provider_store, monkeypatch
):
    from api import source_file_service
    from open_notebook.storage.original_files import reference_from_asset

    monkeypatch.setattr(source_file_service, "get_original_file_store", lambda _: provider_store)
    ref = reference_from_asset(remote_source.asset)
    assert ref is not None
    async with source_file_service.materialize_original_file(
        provider_store, ref, "report.txt"
    ) as path:
        # Another request deletes the original while extraction is in flight.
        assert await source_file_service.delete_original_file(
            remote_source, reason="source_owner"
        ) == "deleted"
        await save_source(cast(SourceState, {
            "source_id": remote_source.id,
            "content_state": {"file_path": str(path)},
            "extraction": SimpleNamespace(content="extracted text", title="Report"),
            "embed": False,
        }))
    assert remote_source.full_text == "extracted text"
    assert remote_source.asset.file_path is None
    assert remote_source.asset.original_file_store is None
    assert remote_source.asset.original_file_key is None
    assert remote_source.asset.original_deleted_at is not None
    assert remote_source.asset.original_deleted_reason == "source_owner"


@pytest.mark.asyncio
@pytest.mark.parametrize("error_type", [FileNotFoundError, ValueError, ConfigurationError, ContextLengthExceededError])
async def test_worker_redacts_extractor_errors_without_changing_retry_classification(
    saved_sources, remote_source, provider_store, monkeypatch, error_type
):
    from open_notebook.graphs import source as source_graph_module

    monkeypatch.setattr(source_commands, "get_original_file_store", lambda _: provider_store)
    monkeypatch.setattr(source_graph_module.ContentSettings, "get_instance", AsyncMock(
        return_value=source_graph_module.ContentSettings()
    ))
    monkeypatch.setattr(source_graph_module.ModelManager, "get_defaults", AsyncMock(
        return_value=SimpleNamespace(default_speech_to_text_model=None)
    ))
    paths = []

    async def extract(**kwargs):
        paths.append(kwargs["file_path"])
        raise error_type(f"Cannot extract {kwargs['file_path']} opaque-private-key")

    monkeypatch.setattr(source_graph_module, "extract_content", extract)
    logs: list[str] = []
    sink = logger.add(logs.append, format="{message}")
    try:
        with pytest.raises(Exception) as caught:
            await source_commands.process_source_command(source_commands.SourceProcessingInput(
                source_id=remote_source.id, content_state={}, notebook_ids=[],
                transformations=[], embed=False,
            ))
    finally:
        logger.remove(sink)
    assert len(paths) == 1
    stop_on = (ValueError, ConfigurationError, ContextLengthExceededError)
    assert isinstance(caught.value, stop_on) == issubclass(error_type, stop_on)
    diagnostic = "".join(logs) + "".join(traceback.format_exception(caught.value))
    assert paths[0] not in diagnostic
    assert "opaque-private-key" not in diagnostic
    assert not provider_store.materialized.exists()
