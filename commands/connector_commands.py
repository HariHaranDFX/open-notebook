"""Durable SharePoint import; extraction remains in process_source."""

import asyncio
import tempfile
from hashlib import sha256
from pathlib import Path

from content_core import check_file_support
from content_core.content.identification import FileDetector
from fastapi import HTTPException, Request
from surreal_commands import CommandInput, CommandOutput, command

from api.auth.types import AuthenticatedUser
from api.middleware import get_max_upload_size_bytes
from api.models import SourceCreate
from api.ownership import assert_can_edit_notebook_or_403
from api.source_file_service import resolve_action_for_source_create
from api.source_ingestion_service import queue_managed_upload_source, queue_source
from open_notebook.connectors.models import ConnectorBatch, ConnectorBatchDocument
from open_notebook.connectors.sharepoint import (
    SUPPORTED_MIME_TYPES,
    SharePointConnector,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.user import User
from open_notebook.exceptions import (
    AuthenticationError,
    NotFoundError,
    UnsupportedTypeException,
)
from open_notebook.storage.original_files import (
    OriginalFileRef,
    get_original_file_store,
)


class ImportSharePointBatchInput(CommandInput):
    batch_id: str
    user_id: str


class ImportSharePointBatchOutput(CommandOutput):
    success: bool


async def _import_document(connector, document, batch, user):
    document.source_id = document.source_id or "source:connector_" + sha256(document.id.encode()).hexdigest()
    await document.save()
    existing = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(document.source_id)})
    if existing:
        source = Source(**existing[0])
        if source.user_id != user.id:
            raise ValueError("Source owner does not match")
        queued = await queue_source(source, {**source.asset.model_dump(exclude_none=True), "delete_source": False}, batch.notebook_ids, batch.transformations, batch.embed, recover=True)
        document.command_id = queued.command_id
        document.status, document.error = "queued", None
        await document.save()
        return
    metadata = await connector.get_document(document.drive_id, document.item_id)
    document.name, document.etag = metadata.name, metadata.etag
    document.status = "running"
    await document.save()
    limit = get_max_upload_size_bytes()
    if metadata.size is not None and metadata.size > limit:
        raise ValueError("File exceeds the upload size limit.")
    # A fixed local basename avoids interpreting remote names as paths.
    with tempfile.TemporaryDirectory(prefix="open-notebook-connector-") as directory:
        path = Path(directory) / ("original" + Path(metadata.name).suffix)
        size = 0
        with path.open("wb") as target:
            async for chunk in connector.download(document.drive_id, document.item_id):
                size += len(chunk)
                if size > limit:
                    raise ValueError("File exceeds the upload size limit.")
                await asyncio.to_thread(target.write, chunk)
        mime = await FileDetector().detect(str(path))
        if not connector._is_importable(metadata.name) or not (
            mime in SUPPORTED_MIME_TYPES or mime.startswith(("audio/", "video/"))
        ):
            raise UnsupportedTypeException("Unsupported file type.")
        support = await check_file_support(str(path))
        if not support.supported:
            raise UnsupportedTypeException("Unsupported file type.")
        action = await resolve_action_for_source_create(SourceCreate(type="upload"))
        store = get_original_file_store()
        stored = await store.save(path, metadata.name)
    try:
        queued = await queue_managed_upload_source(
            stored, metadata.name, user, batch.notebook_ids, batch.transformations, batch.embed, action,
            source_id=document.source_id,
        )
    except Exception:
        # A retry can recover a persisted Source. Only discard the managed copy
        # when the Source write never succeeded and nothing references it.
        if not await repo_query("SELECT * FROM $id", {"id": ensure_record_id(document.source_id)}):
            await store.delete(OriginalFileRef(stored.provider, stored.key, stored.etag))
        raise
    document.source_id, document.command_id = queued.source.id, queued.command_id
    document.status, document.error = "queued", None
    await document.save()


async def _import_batch_once(batch: ConnectorBatch, owner: User) -> None:
    user = AuthenticatedUser(owner.id, owner.email, owner.display_name, owner.role, owner.entra_oid, owner.client_id)
    request = Request({"type": "http", "state": {"user": user}})
    for notebook_id in batch.notebook_ids:
        notebook = await Notebook.get(notebook_id)
        await assert_can_edit_notebook_or_403(notebook.user_id, notebook_id, request, "Notebook not found")
    batch.status, batch.error = "running", None
    await batch.save()
    connector = SharePointConnector(user.id)
    documents = await ConnectorBatchDocument.for_batch(batch.id, user.id)
    existing = {document.item_id: document for document in documents}
    if batch.folder_id is not None:
        async for metadata in connector.iter_documents(batch.drive_id, batch.folder_id):
            if metadata.item_id not in existing:
                document = ConnectorBatchDocument(user_id=user.id, batch_id=batch.id, drive_id=batch.drive_id, item_id=metadata.item_id, name=metadata.name)
                await document.save()
                documents.append(document)
                existing[metadata.item_id] = document
    else:
        for item in batch.item_ids:
            if item not in existing:
                document = ConnectorBatchDocument(user_id=user.id, batch_id=batch.id, drive_id=batch.drive_id, item_id=item, name="Selected file")
                await document.save()
                documents.append(document)
                existing[item] = document
    batch.total = len(documents)
    batch.completed = sum(document.status == "queued" for document in documents)
    batch.failed = 0
    await batch.save()
    transient_failure = False
    for document in documents:
        if document.status == "queued":
            continue
        try:
            await _import_document(connector, document, batch, user)
            batch.completed += 1
        except AuthenticationError:
            document.status, document.error = "failed", "Connect SharePoint again."
            await document.save()
            batch.failed += 1
            await batch.save()
            raise
        except (UnsupportedTypeException, ValueError):
            document.status, document.error = "failed", "This file cannot be imported."
            await document.save()
            batch.failed += 1
        except Exception:
            document.status, document.error = "failed", "Could not import this file. Try again."
            await document.save()
            batch.failed += 1
            transient_failure = True
        await batch.save()
    if transient_failure:
        raise RuntimeError("Some SharePoint documents need another import attempt")
    batch.status = "partial" if batch.failed and batch.completed else "failed" if batch.failed else "completed"
    await batch.save()


@command("import_sharepoint_batch", app="open_notebook", retry={"max_attempts": 1})
async def import_sharepoint_batch_command(input_data: ImportSharePointBatchInput) -> ImportSharePointBatchOutput:
    batch: ConnectorBatch | None = None
    for attempt in range(3):
        try:
            if batch is None:
                batch = await ConnectorBatch.get_for_user(input_data.batch_id, input_data.user_id)
            owner = await User.get(batch.user_id)
            await _import_batch_once(batch, owner)
            break
        except AuthenticationError:
            if batch is None:
                raise
            batch.status, batch.error = "failed", "Connect SharePoint again."
            await batch.save()
            break
        except (HTTPException, NotFoundError):
            if batch is None:
                raise
            batch.status, batch.error = "failed", "Notebook access is no longer available."
            await batch.save()
            break
        except Exception:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            if batch is None:
                raise
            batch.status = "partial" if batch.completed else "failed"
            batch.error = "Could not complete the SharePoint import. Try again."
            await batch.save()
    assert batch is not None
    return ImportSharePointBatchOutput(success=batch.status == "completed")
