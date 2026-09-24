"""Durable SharePoint import; extraction remains in process_source."""

import asyncio
import tempfile
from hashlib import sha256
from pathlib import Path
from time import time
from uuid import uuid4

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
from open_notebook.connectors.models import (
    ConnectorBatch,
    ConnectorBatchDocument,
    ConnectorRemoteVersion,
)
from open_notebook.connectors.sharepoint import (
    SUPPORTED_MIME_TYPES,
    SharePointConnector,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.user import User
from open_notebook.exceptions import (
    AuthenticationError,
    ExternalServiceError,
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


async def _claim_version(document, batch, user_id, version_id, identity, digest):
    """Claim one remote version in SurrealDB before downloading any bytes."""
    source_id = "source:connector_" + digest
    record_id = ensure_record_id(version_id)
    for _ in range(50):
        rows = await repo_query("SELECT * FROM $id", {"id": record_id})
        row = rows[0] if rows else None
        if row and row["status"] == "completed":
            current = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(str(row["source_id"]))})
            if current:
                return str(row["source_id"]), None
            source_id = "source:connector_" + sha256((identity + "\0" + document.id).encode()).hexdigest()
        elif row and row.get("source_id"):
            source_id = str(row["source_id"])
        claim_id = uuid4().hex
        lease_until = time() + 900
        if not row:
            version = ConnectorRemoteVersion(
                id=version_id, user_id=user_id, connection_id=batch.connection_id,
                drive_id=document.drive_id, item_id=document.item_id, etag=document.etag,
                source_id=source_id, claim_id=claim_id, lease_until=lease_until,
            )
            data = version._prepare_save_data()
            data.pop("id", None)
            try:
                await repo_query("CREATE $id CONTENT $data;", {"id": record_id, "data": data})
                return source_id, claim_id
            except Exception:
                if not await repo_query("SELECT * FROM $id", {"id": record_id}):
                    raise
        elif row["status"] != "claiming" or (row.get("lease_until") or 0) < time():
            changed = await repo_query(
                "UPDATE $id SET status = 'claiming', claim_id = $claim_id, lease_until = $lease_until, source_id = $source_id WHERE status = $old_status AND (status != 'claiming' OR lease_until < $now) RETURN AFTER;",
                {"id": record_id, "claim_id": claim_id, "lease_until": lease_until,
                 "source_id": ensure_record_id(source_id), "old_status": row["status"], "now": time()},
            )
            if changed:
                return source_id, claim_id
        await asyncio.sleep(0.1)
    raise RuntimeError("Another SharePoint import is in progress. Retry this batch later.")


async def _finish_claim(version_id, claim_id, status, source_id):
    if claim_id:
        changed = await repo_query(
            "UPDATE $id SET status = $status, claim_id = NONE, lease_until = NONE, source_id = $source_id WHERE claim_id = $claim_id AND ($status = 'failed' OR lease_until > $now) RETURN AFTER;",
            {"id": ensure_record_id(version_id), "status": status,
             "source_id": ensure_record_id(source_id), "claim_id": claim_id, "now": time()},
        )
        if not changed and status == "completed":
            raise RuntimeError("SharePoint import claim expired. Retry this batch later.")


async def _assert_claim_owned(version_id, claim_id):
    if claim_id:
        rows = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(version_id)})
        if not rows or rows[0].get("claim_id") != claim_id or (rows[0].get("lease_until") or 0) <= time():
            raise RuntimeError("SharePoint import claim expired. Retry this batch later.")


async def _delete_unreferenced_copy(store, stored, source_id):
    rows = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(source_id)})
    asset = Source(**rows[0]).asset if rows else None
    if asset is None or asset.original_file_key != stored.key:
        await store.delete(OriginalFileRef(stored.provider, stored.key, stored.etag))


async def _import_document(connector, document, batch, user):
    metadata = await connector.get_document(document.drive_id, document.item_id)
    document.name, document.etag = metadata.name, metadata.etag.strip() if metadata.etag and metadata.etag.strip() else None
    identity = "\0".join((user.id, batch.connection_id, document.drive_id, document.item_id, document.etag or document.id))
    digest = sha256(identity.encode()).hexdigest()
    version_id = "connector_remote_version:" + digest
    document.source_id, claim_id = (
        await _claim_version(document, batch, user.id, version_id, identity, digest)
        if document.etag else ("source:connector_" + digest, None)
    )
    try:
        await asyncio.wait_for(_import_document_content(connector, document, batch, user, metadata, version_id, claim_id), timeout=840)
    except BaseException:
        await _finish_claim(version_id, claim_id, "failed", document.source_id)
        raise
    await _finish_claim(version_id, claim_id, "completed", document.source_id)


async def _import_document_content(connector, document, batch, user, metadata, version_id, claim_id):
    existing = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(document.source_id)})
    await document.save()
    if existing:
        source = Source(**existing[0])
        if source.user_id != user.id:
            raise ValueError("Source owner does not match")
        if source.asset is None:
            raise ValueError("Imported source has no managed copy")
        for notebook_id in batch.notebook_ids:
            await source.add_to_notebook(notebook_id)
        queued = await queue_source(source, {**source.asset.model_dump(exclude_none=True), "delete_source": False}, batch.notebook_ids, batch.transformations, batch.embed, recover=True)
        document.command_id = queued.command_id
        document.status, document.error = "queued", None
        await document.save()
        return
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
        await _assert_claim_owned(version_id, claim_id)
        store = get_original_file_store()
        save_task = asyncio.create_task(store.save(path, metadata.name))
        try:
            stored = await asyncio.shield(save_task)
        except BaseException:
            try:
                interrupted_copy = await save_task
            except BaseException:
                pass
            else:
                await _delete_unreferenced_copy(store, interrupted_copy, document.source_id)
            raise
    try:
        await _assert_claim_owned(version_id, claim_id)
        queued = await queue_managed_upload_source(
            stored, metadata.name, user, batch.notebook_ids, batch.transformations, batch.embed, action,
            source_id=document.source_id, version_id=version_id if claim_id else None, claim_id=claim_id,
        )
    except BaseException:
        # A retry can recover a persisted Source. Only discard the managed copy
        # when the Source write never succeeded and nothing references it.
        await _delete_unreferenced_copy(store, stored, document.source_id)
        raise
    document.source_id, document.command_id = queued.source.id, queued.command_id
    document.status, document.error = "queued", None
    await document.save()


async def _import_batch_once(batch: ConnectorBatch, owner: User) -> None:
    if owner.id is None or batch.id is None:
        raise NotFoundError("Connector import not found")
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
    if batch.folder_id is not None and not batch.retry_failed_only:
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
        except ExternalServiceError as exc:
            if "import limit" not in str(exc):
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
            if batch is None:
                raise
            batch.status = "partial" if batch.completed else "failed"
            batch.error = "SharePoint folder exceeds the 1,000-item import limit. Choose a smaller folder." if "import limit" in str(exc) else "Could not complete the SharePoint import. Try again."
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
