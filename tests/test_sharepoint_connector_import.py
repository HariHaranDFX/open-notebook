"""Import API/worker integration with an in-memory repository and mocked Graph."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import (
    ExternalServiceError,
    NotFoundError,
    OpenNotebookError,
)


def test_remote_version_migration_is_registered_with_unique_owner_identity():
    from open_notebook.database.async_migrate import AsyncMigrationManager

    manager = AsyncMigrationManager()
    assert len(manager.up_migrations) == len(manager.down_migrations) == 34
    assert "connector_remote_version_identity" in manager.up_migrations[33].sql
    assert "user_id, connection_id, drive_id, item_id, etag UNIQUE" in manager.up_migrations[33].sql
    assert "lease_until ON TABLE connector_remote_version" in manager.up_migrations[33].sql
    assert "retry_failed_only ON TABLE connector_batch" in manager.up_migrations[33].sql


@pytest.fixture
def imports(monkeypatch, tmp_path):
    from api import ownership, source_ingestion_service
    from api.command_service import CommandService
    from api.routers import connectors
    from commands import connector_commands
    from open_notebook.connectors import models, sharepoint_auth
    from open_notebook.connectors.sharepoint import SharePointConnector
    from open_notebook.domain import base, notebook
    from open_notebook.storage.original_files import FilesystemOriginalFileStore

    records: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, str]] = []
    jobs: list[dict[str, Any]] = []
    requests: list[httpx.Request] = []
    user = AuthenticatedUser("user:alice", "alice@test", "Alice", "user", None, "client")

    async def save(obj):
        obj.id = obj.id or f"{obj.table_name}:record{len(records) + 1}"
        records[obj.id] = obj.model_dump()

    async def query(sql, params=None):
        params = params or {}
        if sql.startswith("BEGIN TRANSACTION"):
            from open_notebook.domain.notebook import Source

            version = records.get(str(params["version_id"]))
            if not version or version["claim_id"] != params["claim_id"] or version["lease_until"] <= params["now"]:
                raise RuntimeError("SharePoint import claim expired")
            source_id, command_id = str(params["source_id"]), str(params["command_id"])
            if source_id in records or any(job["id"] == command_id for job in jobs):
                raise RuntimeError("record already exists")
            source_data = {**params["source_data"], "id": source_id, "user_id": str(params["source_data"]["user_id"])}
            records[source_id] = Source(**source_data).model_dump()
            jobs.append({"id": command_id, **deepcopy(params["command_data"])})
            return []
        if sql.startswith("CREATE $id CONTENT"):
            record_id = str(params["id"])
            if record_id in records:
                raise RuntimeError("record already exists")
            records[record_id] = {**params["data"], "id": record_id, "user_id": str(params["data"]["user_id"]), "connection_id": str(params["data"]["connection_id"]), "source_id": str(params["data"]["source_id"])}
            return [deepcopy(records[record_id])]
        if sql.startswith("UPDATE $id SET status"):
            row = records.get(str(params["id"]))
            if not row:
                return []
            if "old_status" in params:
                if row["status"] != params["old_status"] or (row["status"] == "claiming" and row["lease_until"] >= params["now"]):
                    return []
                row.update(status="claiming", claim_id=params["claim_id"], lease_until=params["lease_until"], source_id=str(params["source_id"]))
            else:
                if row["claim_id"] != params["claim_id"] or (params["status"] == "completed" and row["lease_until"] <= params["now"]):
                    return []
                row.update(status=params["status"], claim_id=None, lease_until=None, source_id=str(params["source_id"]))
            return [deepcopy(row)]
        if "FROM reference" in sql:
            return [edge for edge in edges if edge["in"] == str(params["source_id"]) and edge["out"] == str(params["notebook_id"])]
        if "FROM command" in sql:
            return [{"id": j["id"]} for j in jobs if j["name"] == "process_source" and j["args"].get("source_id") == params.get("source_id")]
        if "FROM connector_batch_document" in sql:
            return [deepcopy(r) for r in records.values() if r["id"].startswith("connector_batch_document:") and r["batch_id"] == str(params["batch_id"]) and r["user_id"] == str(params["user_id"])]
        if "SELECT" in sql and "id" in params:
            row = records.get(str(params["id"]))
            return [deepcopy(row)] if row and ("user_id" not in params or row["user_id"] == str(params["user_id"])) else []
        if sql.startswith("DELETE"):
            return []
        raise AssertionError((sql, params))

    async def relate(source, relationship, target, data=None):
        assert relationship == "reference"
        edge = {"in": source, "out": target}
        edges.append(edge)
        return [edge]

    async def submit(app, name, args, **kwargs):
        job = {"id": f"command:{len(jobs) + 1}", "app": app, "name": name, "args": deepcopy(args)}
        jobs.append(job)
        return job["id"]

    async def upsert(table, record_id, data, **kwargs):
        from open_notebook.domain.notebook import Source
        row = {**data, "id": record_id, "user_id": str(data["user_id"])}
        records[record_id] = Source(**row).model_dump()
        return [deepcopy(records[record_id])]

    monkeypatch.setattr(base.ObjectModel, "save", save)
    monkeypatch.setattr(base, "repo_query", query)
    monkeypatch.setattr(base, "repo_relate", relate)
    monkeypatch.setattr(notebook, "repo_query", query)
    monkeypatch.setattr(models, "repo_query", query)
    monkeypatch.setattr(source_ingestion_service, "repo_query", query)
    monkeypatch.setattr(source_ingestion_service, "repo_upsert", upsert)
    monkeypatch.setattr(connector_commands, "repo_query", query)
    monkeypatch.setattr(CommandService, "submit_command_job", submit)
    monkeypatch.setattr(ownership, "auth_enforces_ownership", lambda: True)
    monkeypatch.setattr(sharepoint_auth, "get_connection", AsyncMock(return_value=models.ConnectorConnection(id="connector_connection:alice", user_id=user.id)))
    token = AsyncMock(return_value="delegated-secret")
    monkeypatch.setattr(sharepoint_auth, "acquire_delegated_token", token)
    records["notebook:one"] = {"id": "notebook:one", "name": "One", "description": "", "user_id": user.id}
    records[user.id] = {"id": user.id, "email": user.email, "display_name": user.display_name, "client_id": user.client_id}
    files = {"one": ("report.txt", b"A supported plain text document with enough content.")}
    etags = {"one": "v1"}

    def graph(request):
        requests.append(request)
        assert request.method == "GET"
        assert request.headers["Authorization"] == "Bearer delegated-secret"
        parts = request.url.path.split("/")
        item_id = parts[-2] if parts[-1] == "content" else parts[-1]
        name, content = files[item_id]
        if isinstance(content, int):
            return httpx.Response(content, text="private Graph response delegated-secret")
        if parts[-1] == "content":
            return httpx.Response(200, content=content)
        return httpx.Response(200, json={"id": item_id, "name": name, "file": {}, "size": len(content), "eTag": etags.get(item_id)})

    graph_client = httpx.AsyncClient(transport=httpx.MockTransport(graph))
    original_init = SharePointConnector.__init__

    def init(self, user_id, **kwargs):
        original_init(self, user_id, client=graph_client, **kwargs)

    monkeypatch.setattr(SharePointConnector, "__init__", init)
    store = FilesystemOriginalFileStore(tmp_path / "managed")
    app = FastAPI()

    @app.middleware("http")
    async def auth(request, call_next):
        request.state.user = state.user
        return await call_next(request)

    @app.exception_handler(OpenNotebookError)
    async def domain_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404 if isinstance(exc, NotFoundError) else 400)

    app.include_router(connectors.router, prefix="/api")
    state = SimpleNamespace(app=app, records=records, edges=edges, jobs=jobs, user=user, requests=requests, files=files, etags=etags, store=store, token=token, query=query)
    return state


async def run_batch(imports, monkeypatch, *, retry=False, **selection):
    from commands import connector_commands
    monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
    monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        if not retry:
            response = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", **selection})
            assert response.status_code == 202, response.text
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[0]["args"]))
        return await client.get(f"/api/connectors/sharepoint/batches/{imports.jobs[0]['args']['batch_id']}")


@pytest.mark.asyncio
async def test_partial_failure_retry_reuses_batch_items_sources_and_copy(imports, monkeypatch):
    imports.files["bad"] = ("payload.exe", b"Untrusted executable")
    response = await run_batch(imports, monkeypatch, item_ids=["one", "bad", "one"])
    assert response.json()["status"] == "partial"
    assert response.json()["total"] == 2
    assert response.json()["completed"] == 1
    assert response.json()["failed"] == 1
    assert "delegated-secret" not in response.text
    source_id = response.json()["documents"][0]["source_id"]
    retried = await run_batch(imports, monkeypatch, retry=True)
    assert retried.json()["completed"] == 1
    assert len(retried.json()["documents"]) == 2
    assert retried.json()["documents"][0]["source_id"] == source_id
    assert len([r for r in imports.records if r.startswith("source:")]) == 1
    assert len(imports.jobs) == 2
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


@pytest.mark.asyncio
async def test_retry_after_queue_persistence_failure_recovers_existing_source_and_job(imports, monkeypatch):
    from open_notebook.connectors.models import ConnectorBatchDocument
    from open_notebook.domain.base import ObjectModel

    original_save = ObjectModel.save
    failed = False

    async def interrupted_save(obj):
        nonlocal failed
        if isinstance(obj, ConnectorBatchDocument) and obj.status == "queued" and not failed:
            failed = True
            raise RuntimeError("simulated crash after queue persisted")
        await original_save(obj)

    monkeypatch.setattr(ObjectModel, "save", interrupted_save)
    await run_batch(imports, monkeypatch, item_ids=["one"])
    assert failed
    result = await run_batch(imports, monkeypatch, retry=True)
    assert result.json()["status"] == "completed"
    assert len([r for r in imports.records if r.startswith("source:")]) == 1
    assert len(imports.jobs) == 2
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


@pytest.mark.asyncio
async def test_failed_source_write_removes_unreferenced_managed_copy(imports, monkeypatch):
    from api import source_ingestion_service

    original_query = source_ingestion_service.repo_query

    async def failed_write(sql, params=None):
        if sql.startswith("BEGIN TRANSACTION"):
            raise RuntimeError("simulated source write failure")
        return await original_query(sql, params)

    monkeypatch.setattr(source_ingestion_service, "repo_query", failed_write)
    result = await run_batch(imports, monkeypatch, item_ids=["one"])
    assert result.json()["status"] == "failed"
    assert not list(imports.store.uploads_folder.iterdir())

    monkeypatch.setattr(source_ingestion_service, "repo_query", original_query)
    retried = await run_batch(imports, monkeypatch, retry=True)
    assert retried.json()["status"] == "completed"
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


@pytest.mark.asyncio
async def test_transient_source_write_retries_without_duplicate_copy(imports, monkeypatch):
    from api import source_ingestion_service

    original_query = source_ingestion_service.repo_query
    attempts = 0

    async def flaky_write(sql, params=None):
        nonlocal attempts
        if sql.startswith("BEGIN TRANSACTION"):
            attempts += 1
            if attempts == 1:
                raise RuntimeError("temporary database failure")
        return await original_query(sql, params)

    monkeypatch.setattr(source_ingestion_service, "repo_query", flaky_write)
    result = await run_batch(imports, monkeypatch, item_ids=["one"])
    assert result.json()["status"] == "completed"
    assert attempts == 2
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


@pytest.mark.asyncio
async def test_transient_initial_batch_lookup_retries(imports, monkeypatch):
    from commands import connector_commands
    from open_notebook.connectors.models import ConnectorBatch

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        response = await client.post("/api/connectors/sharepoint/import", json={
            "drive_id": "drive", "item_ids": ["one"],
        })
        assert response.status_code == 202
        original_lookup = ConnectorBatch.get_for_user
        attempts = 0

        async def flaky_lookup(batch_id, user_id):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("temporary database failure")
            return await original_lookup(batch_id, user_id)

        monkeypatch.setattr(ConnectorBatch, "get_for_user", flaky_lookup)
        monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
        monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
        await connector_commands.import_sharepoint_batch_command(
            connector_commands.ImportSharePointBatchInput(**imports.jobs[0]["args"])
        )
        monkeypatch.setattr(ConnectorBatch, "get_for_user", original_lookup)
        status = await client.get(f"/api/connectors/sharepoint/batches/{response.json()['batch_id']}")
    assert attempts == 2
    assert status.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_revoked_notebook_access_finishes_batch_failed(imports, monkeypatch):
    from commands import connector_commands

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        response = await client.post("/api/connectors/sharepoint/import", json={
            "drive_id": "drive", "item_ids": ["one"], "notebook_ids": ["notebook:one"],
        })
        assert response.status_code == 202
        monkeypatch.setattr(connector_commands, "assert_can_edit_notebook_or_403", AsyncMock(side_effect=HTTPException(403)))
        await connector_commands.import_sharepoint_batch_command(
            connector_commands.ImportSharePointBatchInput(**imports.jobs[0]["args"])
        )
        status = await client.get(f"/api/connectors/sharepoint/batches/{response.json()['batch_id']}")
    assert status.json()["status"] == "failed"
    assert status.json()["error"]


@pytest.mark.asyncio
async def test_folder_enumeration_exhaustion_finishes_batch_failed(imports, monkeypatch):
    from open_notebook.connectors.sharepoint import SharePointConnector

    attempts = 0

    async def broken_folder(self, drive_id, folder_id):
        nonlocal attempts
        attempts += 1
        raise ExternalServiceError("temporary Graph failure")
        yield  # pragma: no cover - preserve async-generator protocol

    monkeypatch.setattr(SharePointConnector, "iter_documents", broken_folder)
    result = await run_batch(imports, monkeypatch, folder_id="folder")
    assert attempts == 3
    assert result.json()["status"] == "failed"
    assert result.json()["error"]


@pytest.mark.asyncio
async def test_ordinary_upload_failure_cleans_half_created_source(monkeypatch):
    from api import source_ingestion_service
    from open_notebook.domain.notebook import Source
    from open_notebook.storage.original_files import StoredOriginal

    async def failed_queue(source, *args, **kwargs):
        source.id = "source:half_created"
        raise RuntimeError("simulated queue failure")

    delete = AsyncMock(return_value=True)
    monkeypatch.setattr(source_ingestion_service, "queue_source", failed_queue)
    monkeypatch.setattr(Source, "delete", delete)
    with pytest.raises(RuntimeError, match="simulated queue failure"):
        await source_ingestion_service.queue_managed_upload_source(
            StoredOriginal("filesystem", "report.txt", 20), "report.txt", None,
            [], [], True, "keep",
        )
    delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_import_command_cannot_bypass_owner_checked_route(imports):
    from api.routers import commands
    imports.app.include_router(commands.router, prefix="/api")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        response = await client.post("/api/commands/jobs", json={"app": "open_notebook", "command": "import_sharepoint_batch", "input": {"batch_id": "connector_batch:victim", "user_id": "user:victim"}})
    assert response.status_code == 403
    assert imports.jobs == []


@pytest.mark.asyncio
async def test_batch_status_is_private_to_its_owner(imports, monkeypatch):
    result = await run_batch(imports, monkeypatch, item_ids=["one"])
    batch_id = result.json()["batch_id"]
    imports.user = AuthenticatedUser("user:bob", "bob@test", "Bob", "user", None, "client")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        response = await client.get(f"/api/connectors/sharepoint/batches/{batch_id}")
    assert response.status_code == 404
    assert "report.txt" not in response.text


@pytest.mark.asyncio
async def test_deleting_imported_source_only_deletes_managed_copy(imports, monkeypatch):
    from api import source_file_service
    from open_notebook.domain import base
    from open_notebook.domain.notebook import Source

    result = await run_batch(imports, monkeypatch, item_ids=["one"])
    source_id = result.json()["documents"][0]["source_id"]
    source = Source(**imports.records[source_id])

    async def delete_record(record_id):
        imports.records.pop(str(record_id), None)
        return True

    monkeypatch.setattr(source_file_service, "get_original_file_store", lambda provider=None: imports.store)
    monkeypatch.setattr(base, "repo_delete", delete_record)
    assert await source.delete()
    assert source_id not in imports.records
    assert not list(imports.store.uploads_folder.iterdir())
    assert all(request.method == "GET" for request in imports.requests)


@pytest.mark.asyncio
async def test_import_one_file_queues_existing_source_pipeline(imports, monkeypatch):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        response = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"], "notebook_ids": ["notebook:one"], "embed": False})
        assert response.status_code == 202, response.text
        from commands import connector_commands
        monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
        monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[0]["args"]))
        status = await client.get(f"/api/connectors/sharepoint/batches/{response.json()['batch_id']}")

    assert status.status_code == 200
    assert status.json()["status"] == "completed"
    assert status.json()["completed"] == 1
    sources = [r for r in imports.records.values() if r["id"].startswith("source:")]
    assert len(sources) == 1
    source = sources[0]
    assert source["user_id"] == "user:alice"
    assert source["title"] == "report.txt"
    assert imports.edges == [{"in": source["id"], "out": "notebook:one"}]
    assert len(list(imports.store.uploads_folder.iterdir())) == 1
    assert imports.jobs[1]["name"] == "process_source"
    assert imports.jobs[1]["status"] == "new"
    assert imports.jobs[1]["context"] == {}
    assert str(source["command"]) == imports.jobs[1]["id"]
    payload = imports.jobs[1]["args"]
    from commands.source_commands import SourceProcessingInput
    assert SourceProcessingInput(**payload).model_dump() == payload
    assert payload["source_id"] == source["id"]
    assert payload["notebook_ids"] == ["notebook:one"]
    assert payload["embed"] is False
    assert payload["content_state"]["original_file_store"] == "filesystem"
    assert "delegated-secret" not in str(imports.records)
    assert "original_file_key" not in status.text


@pytest.mark.asyncio
async def test_same_remote_version_in_new_batch_reuses_source_and_links_new_notebook(imports, monkeypatch):
    first = await run_batch(imports, monkeypatch, item_ids=["one"], notebook_ids=["notebook:one"])
    source_id = first.json()["documents"][0]["source_id"]
    imports.records["notebook:two"] = {"id": "notebook:two", "name": "Two", "description": "", "user_id": imports.user.id}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"], "notebook_ids": ["notebook:two"]})
        assert created.status_code == 202
        from commands import connector_commands
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[-1]["args"]))
        second = await client.get(f"/api/connectors/sharepoint/batches/{created.json()['batch_id']}")
    assert second.json()["documents"][0]["source_id"] == source_id
    assert len([r for r in imports.records if r.startswith("source:")]) == 1
    assert {edge["out"] for edge in imports.edges} == {"notebook:one", "notebook:two"}
    assert len([job for job in imports.jobs if job["name"] == "process_source"]) == 1


@pytest.mark.asyncio
async def test_changed_etag_creates_new_source_snapshot(imports, monkeypatch):
    first = await run_batch(imports, monkeypatch, item_ids=["one"])
    old_source = first.json()["documents"][0]["source_id"]
    imports.etags["one"] = "v2"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
        from commands import connector_commands
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[-1]["args"]))
        second = await client.get(f"/api/connectors/sharepoint/batches/{created.json()['batch_id']}")
    assert second.json()["documents"][0]["source_id"] != old_source
    assert len([r for r in imports.records if r.startswith("source:")]) == 2


@pytest.mark.asyncio
async def test_deleted_prior_source_is_recreated_and_processed(imports, monkeypatch):
    first = await run_batch(imports, monkeypatch, item_ids=["one"])
    old_source = first.json()["documents"][0]["source_id"]
    imports.records.pop(old_source)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
        from commands import connector_commands
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[-1]["args"]))
        second = await client.get(f"/api/connectors/sharepoint/batches/{created.json()['batch_id']}")
    assert second.json()["status"] == "completed"
    assert second.json()["documents"][0]["source_id"] != old_source
    assert len([job for job in imports.jobs if job["name"] == "process_source"]) == 2


@pytest.mark.asyncio
async def test_missing_etag_does_not_reuse_source_across_batches(imports, monkeypatch):
    imports.etags["one"] = None
    first = await run_batch(imports, monkeypatch, item_ids=["one"])
    old_source = first.json()["documents"][0]["source_id"]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
        from commands import connector_commands
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[-1]["args"]))
        second = await client.get(f"/api/connectors/sharepoint/batches/{created.json()['batch_id']}")
    assert second.json()["documents"][0]["source_id"] != old_source


@pytest.mark.asyncio
async def test_concurrent_same_version_batches_make_one_copy_and_processing_job(imports, monkeypatch):
    from commands import connector_commands
    from open_notebook.connectors.sharepoint import SharePointConnector

    original_get = SharePointConnector.get_document
    arrived = 0
    both = asyncio.Event()

    async def synchronized_get(self, drive_id, item_id):
        nonlocal arrived
        metadata = await original_get(self, drive_id, item_id)
        arrived += 1
        if arrived == 2:
            both.set()
        await both.wait()
        return metadata

    monkeypatch.setattr(SharePointConnector, "get_document", synchronized_get)
    monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
    monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        first = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
        second = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
        assert first.status_code == second.status_code == 202
        commands = [connector_commands.ImportSharePointBatchInput(**job["args"]) for job in imports.jobs]
        await asyncio.gather(*(connector_commands.import_sharepoint_batch_command(command) for command in commands))
        statuses = [await client.get(f"/api/connectors/sharepoint/batches/{response.json()['batch_id']}") for response in (first, second)]
    assert [status.json()["status"] for status in statuses] == ["completed", "completed"]
    assert len([row for row in imports.records if row.startswith("source:")]) == 1
    assert len(list(imports.store.uploads_folder.iterdir())) == 1
    assert len([job for job in imports.jobs if job["name"] == "process_source"]) == 1


@pytest.mark.asyncio
async def test_owner_can_retry_only_failed_items_in_durable_batch(imports, monkeypatch):
    imports.files["bad"] = ("payload.exe", b"unsafe")
    first = await run_batch(imports, monkeypatch, item_ids=["one", "bad"])
    batch_id = first.json()["batch_id"]
    assert first.json()["status"] == "partial"
    imports.files["bad"] = ("fixed.txt", b"A fixed text document with enough content")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        retried = await client.post(f"/api/connectors/sharepoint/batches/{batch_id}/retry")
        assert retried.status_code == 202
        assert retried.json()["batch_id"] == batch_id
        assert len([job for job in imports.jobs if job["name"] == "import_sharepoint_batch"]) == 2
        from commands import connector_commands
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[-1]["args"]))
        status = await client.get(f"/api/connectors/sharepoint/batches/{batch_id}")
    assert status.json()["status"] == "completed"
    assert status.json()["completed"] == 2
    assert len([job for job in imports.jobs if job["name"] == "process_source"]) == 2


@pytest.mark.asyncio
async def test_folder_retry_uses_original_failed_selection_only(imports, monkeypatch):
    from commands import connector_commands
    from open_notebook.connectors.base import ConnectorDocument
    from open_notebook.connectors.sharepoint import SharePointConnector

    imports.files["bad"] = ("payload.exe", b"unsafe")
    imports.files["new"] = ("new.txt", b"A newly added document with enough content")
    folder_items = ["one", "bad"]

    async def documents(self, drive_id, folder_id):
        for item_id in folder_items:
            yield ConnectorDocument(drive_id=drive_id, item_id=item_id, name=imports.files[item_id][0])

    monkeypatch.setattr(SharePointConnector, "iter_documents", documents)
    first = await run_batch(imports, monkeypatch, folder_id="folder")
    assert first.json()["status"] == "partial"
    folder_items.append("new")
    imports.files["bad"] = ("fixed.txt", b"A fixed text document with enough content")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        retry = await client.post(f"/api/connectors/sharepoint/batches/{first.json()['batch_id']}/retry")
        assert retry.status_code == 202
        await connector_commands.import_sharepoint_batch_command(connector_commands.ImportSharePointBatchInput(**imports.jobs[-1]["args"]))
        status = await client.get(f"/api/connectors/sharepoint/batches/{first.json()['batch_id']}")
    assert status.json()["status"] == "completed"
    assert {row["item_id"] for row in status.json()["documents"]} == {"one", "bad"}
    assert len([job for job in imports.jobs if job["name"] == "process_source"]) == 2


@pytest.mark.asyncio
async def test_retry_enqueue_failure_leaves_batch_retryable(imports, monkeypatch):
    from api.command_service import CommandService

    imports.files["bad"] = ("payload.exe", b"unsafe")
    first = await run_batch(imports, monkeypatch, item_ids=["one", "bad"])
    batch_id = first.json()["batch_id"]

    async def failed_enqueue(*args, **kwargs):
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr(CommandService, "submit_command_job", failed_enqueue)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        with pytest.raises(RuntimeError, match="queue unavailable"):
            await client.post(f"/api/connectors/sharepoint/batches/{batch_id}/retry")
        status = await client.get(f"/api/connectors/sharepoint/batches/{batch_id}")
    assert status.json()["status"] == "partial"
    assert status.json()["failed"] == 1
    assert {doc["item_id"]: doc["status"] for doc in status.json()["documents"]} == {"one": "queued", "bad": "failed"}


@pytest.mark.asyncio
async def test_expired_remote_version_claim_can_be_recovered(imports, monkeypatch):
    from hashlib import sha256

    identity = "\0".join((imports.user.id, "connector_connection:alice", "drive", "one", "v1"))
    digest = sha256(identity.encode()).hexdigest()
    version_id = "connector_remote_version:" + digest
    imports.records[version_id] = {
        "id": version_id, "user_id": imports.user.id,
        "connection_id": "connector_connection:alice", "drive_id": "drive",
        "item_id": "one", "etag": "v1", "source_id": "source:connector_" + digest,
        "status": "claiming", "claim_id": "dead-worker", "lease_until": 0,
    }
    result = await run_batch(imports, monkeypatch, item_ids=["one"])
    assert result.json()["status"] == "completed"
    assert imports.records[version_id]["status"] == "completed"
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


@pytest.mark.asyncio
async def test_expired_claim_owner_cannot_finalize_after_takeover(imports):
    from hashlib import sha256

    from commands import connector_commands

    document = SimpleNamespace(id="connector_batch_document:one", drive_id="drive", item_id="one", etag="v1")
    batch = SimpleNamespace(connection_id="connector_connection:alice")
    identity = "\0".join((imports.user.id, batch.connection_id, "drive", "one", "v1"))
    digest = sha256(identity.encode()).hexdigest()
    version_id = "connector_remote_version:" + digest
    source_id, first_claim = await connector_commands._claim_version(document, batch, imports.user.id, version_id, identity, digest)
    imports.records[version_id]["lease_until"] = 0
    replacement_id, second_claim = await connector_commands._claim_version(document, batch, imports.user.id, version_id, identity, digest)
    assert first_claim != second_claim
    assert source_id == replacement_id
    await connector_commands._finish_claim(version_id, second_claim, "completed", replacement_id)
    with pytest.raises(RuntimeError, match="expired"):
        await connector_commands._assert_claim_owned(version_id, first_claim)
    with pytest.raises(RuntimeError, match="expired"):
        await connector_commands._finish_claim(version_id, first_claim, "completed", source_id)
    assert imports.records[version_id]["status"] == "completed"
    assert imports.records[version_id]["source_id"] == replacement_id


@pytest.mark.asyncio
async def test_failed_claim_is_immediately_retryable(imports):
    from hashlib import sha256

    from commands import connector_commands

    document = SimpleNamespace(id="connector_batch_document:one", drive_id="drive", item_id="one", etag="v1")
    batch = SimpleNamespace(connection_id="connector_connection:alice")
    identity = "\0".join((imports.user.id, batch.connection_id, "drive", "one", "v1"))
    digest = sha256(identity.encode()).hexdigest()
    version_id = "connector_remote_version:" + digest
    source_id, first_claim = await connector_commands._claim_version(document, batch, imports.user.id, version_id, identity, digest)
    await connector_commands._finish_claim(version_id, first_claim, "failed", source_id)
    assert imports.records[version_id]["status"] == "failed"
    _, second_claim = await connector_commands._claim_version(document, batch, imports.user.id, version_id, identity, digest)
    assert second_claim != first_claim


@pytest.mark.asyncio
async def test_late_claim_owner_cleans_only_its_own_copy(imports, monkeypatch, tmp_path):
    from hashlib import sha256

    from commands import connector_commands
    from open_notebook.connectors.models import ConnectorBatch, ConnectorBatchDocument
    from open_notebook.connectors.sharepoint import SharePointConnector
    from open_notebook.domain.notebook import Asset, Source

    monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
    monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
    batch = ConnectorBatch(**imports.records[created.json()["batch_id"]])
    document = ConnectorBatchDocument(user_id=imports.user.id, batch_id=batch.id, drive_id="drive", item_id="one", name="report.txt")
    await document.save()
    identity = "\0".join((imports.user.id, batch.connection_id, "drive", "one", "v1"))
    digest = sha256(identity.encode()).hexdigest()
    source_id = "source:connector_" + digest
    version_id = "connector_remote_version:" + digest
    original_save = imports.store.save
    winning_key = None

    async def competing_save(path, name):
        nonlocal winning_key
        stale = await original_save(path, name)
        winner_input = tmp_path / "winner.txt"
        winner_input.write_bytes(imports.files["one"][1])
        winner = await original_save(winner_input, name)
        winning_key = winner.key
        imports.records[version_id]["claim_id"] = "winner"
        asset = Asset(file_path=winner.file_path, original_file_store=winner.provider,
                      original_file_key=winner.key, original_file_etag=winner.etag,
                      original_filename=name, original_size_bytes=winner.size_bytes,
                      original_file_action="keep")
        imports.records[source_id] = Source(id=source_id, title=name, topics=[], asset=asset,
                                            user_id=imports.user.id, client_id=imports.user.client_id).model_dump()
        return stale

    monkeypatch.setattr(imports.store, "save", competing_save)
    with pytest.raises(RuntimeError, match="expired"):
        await connector_commands._import_document(SharePointConnector(imports.user.id), document, batch, imports.user)
    assert winning_key is not None
    assert len(list(imports.store.uploads_folder.iterdir())) == 1
    assert imports.records[source_id]["asset"]["original_file_key"] == winning_key


@pytest.mark.asyncio
async def test_cancellation_after_storage_save_cleans_unreferenced_copy(imports, monkeypatch):
    from commands import connector_commands
    from open_notebook.connectors.models import ConnectorBatch, ConnectorBatchDocument
    from open_notebook.connectors.sharepoint import SharePointConnector

    monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
    monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
    batch = ConnectorBatch(**imports.records[created.json()["batch_id"]])
    document = ConnectorBatchDocument(user_id=imports.user.id, batch_id=batch.id, drive_id="drive", item_id="one", name="report.txt")
    await document.save()
    original_save = imports.store.save
    saved = asyncio.Event()
    release = asyncio.Event()

    async def interrupted_save(path, name):
        stored = await original_save(path, name)
        saved.set()
        await release.wait()
        return stored

    monkeypatch.setattr(imports.store, "save", interrupted_save)
    task = asyncio.create_task(connector_commands._import_document(SharePointConnector(imports.user.id), document, batch, imports.user))
    await asyncio.wait_for(saved.wait(), 5)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not list(imports.store.uploads_folder.iterdir())
    versions = [row for key, row in imports.records.items() if key.startswith("connector_remote_version:")]
    assert versions[0]["status"] == "failed"


@pytest.mark.asyncio
async def test_claim_takeover_between_check_and_source_write_has_no_side_effects(imports, monkeypatch):
    from commands import connector_commands
    from open_notebook.connectors.models import ConnectorBatch, ConnectorBatchDocument
    from open_notebook.connectors.sharepoint import SharePointConnector

    monkeypatch.setattr(connector_commands, "get_original_file_store", lambda: imports.store)
    monkeypatch.setattr(connector_commands, "resolve_action_for_source_create", AsyncMock(return_value="keep"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        created = await client.post("/api/connectors/sharepoint/import", json={"drive_id": "drive", "item_ids": ["one"]})
    batch = ConnectorBatch(**imports.records[created.json()["batch_id"]])
    document = ConnectorBatchDocument(user_id=imports.user.id, batch_id=batch.id, drive_id="drive", item_id="one", name="report.txt")
    await document.save()
    original_check = connector_commands._assert_claim_owned
    checks = 0

    async def takeover_after_check(version_id, claim_id):
        nonlocal checks
        await original_check(version_id, claim_id)
        checks += 1
        if checks == 2:
            imports.records[version_id]["claim_id"] = "new-owner"

    monkeypatch.setattr(connector_commands, "_assert_claim_owned", takeover_after_check)
    with pytest.raises(RuntimeError, match="claim"):
        await connector_commands._import_document(SharePointConnector(imports.user.id), document, batch, imports.user)
    assert not [key for key in imports.records if key.startswith("source:")]
    assert not [job for job in imports.jobs if job["name"] == "process_source"]
    assert not list(imports.store.uploads_folder.iterdir())


@pytest.mark.asyncio
async def test_folder_limit_failure_is_actionable_in_batch_status(imports, monkeypatch):
    from open_notebook.connectors.sharepoint import SharePointConnector

    async def over_limit(self, drive_id, folder_id):
        raise ExternalServiceError("SharePoint folder exceeds the import limit.")
        yield  # pragma: no cover

    monkeypatch.setattr(SharePointConnector, "iter_documents", over_limit)
    result = await run_batch(imports, monkeypatch, folder_id="folder")
    assert result.json()["status"] == "failed"
    assert "1,000" in result.json()["error"]


@pytest.mark.asyncio
async def test_other_owner_cannot_retry_batch(imports, monkeypatch):
    first = await run_batch(imports, monkeypatch, item_ids=["one"])
    imports.user = AuthenticatedUser("user:bob", "bob@test", "Bob", "user", None, "client")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=imports.app), base_url="http://test") as client:
        response = await client.post(f"/api/connectors/sharepoint/batches/{first.json()['batch_id']}/retry")
    assert response.status_code == 404
