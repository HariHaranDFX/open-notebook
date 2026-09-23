"""Import API/worker integration with an in-memory repository and mocked Graph."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from api.auth.types import AuthenticatedUser
from open_notebook.exceptions import NotFoundError, OpenNotebookError


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

    records, edges, jobs, requests = {}, [], [], []
    user = AuthenticatedUser("user:alice", "alice@test", "Alice", "user", None, "client")

    async def save(obj):
        obj.id = obj.id or f"{obj.table_name}:record{len(records) + 1}"
        records[obj.id] = obj.model_dump()

    async def query(sql, params=None):
        params = params or {}
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
        return httpx.Response(200, json={"id": item_id, "name": name, "file": {}, "size": len(content), "eTag": "v1"})

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
    state = SimpleNamespace(app=app, records=records, edges=edges, jobs=jobs, user=user, requests=requests, files=files, store=store, token=token, query=query)
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
    from open_notebook.domain.base import ObjectModel
    from open_notebook.domain.notebook import Source

    original_save = ObjectModel.save
    failed = False

    async def interrupted_save(obj):
        nonlocal failed
        if isinstance(obj, Source) and obj.command and not failed:
            failed = True
            raise RuntimeError("simulated crash after queue persisted")
        await original_save(obj)

    monkeypatch.setattr(ObjectModel, "save", interrupted_save)
    await run_batch(imports, monkeypatch, item_ids=["one"])
    result = await run_batch(imports, monkeypatch, retry=True)
    assert result.json()["status"] == "completed"
    assert len([r for r in imports.records if r.startswith("source:")]) == 1
    assert len(imports.jobs) == 2
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


@pytest.mark.asyncio
async def test_failed_source_write_removes_unreferenced_managed_copy(imports, monkeypatch):
    from api import source_ingestion_service

    original_upsert = source_ingestion_service.repo_upsert

    async def failed_upsert(*args, **kwargs):
        raise RuntimeError("simulated source write failure")

    monkeypatch.setattr(source_ingestion_service, "repo_upsert", failed_upsert)
    result = await run_batch(imports, monkeypatch, item_ids=["one"])
    assert result.json()["status"] == "failed"
    assert not list(imports.store.uploads_folder.iterdir())

    monkeypatch.setattr(source_ingestion_service, "repo_upsert", original_upsert)
    retried = await run_batch(imports, monkeypatch, retry=True)
    assert retried.json()["status"] == "completed"
    assert len(list(imports.store.uploads_folder.iterdir())) == 1


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
    payload = imports.jobs[1]["args"]
    assert payload["source_id"] == source["id"]
    assert payload["notebook_ids"] == ["notebook:one"]
    assert payload["embed"] is False
    assert payload["content_state"]["original_file_store"] == "filesystem"
    assert "delegated-secret" not in str(imports.records)
    assert "original_file_key" not in status.text
