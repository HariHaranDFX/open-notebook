"""Create/link sources and queue the existing extraction pipeline."""

import asyncio
from dataclasses import dataclass
from hashlib import sha256
from time import time

from api.auth.types import AuthenticatedUser
from api.command_service import CommandService
from open_notebook.database.repository import ensure_record_id, repo_query, repo_upsert
from open_notebook.domain.notebook import Asset, Source
from open_notebook.storage.original_files import StoredOriginal


@dataclass
class QueuedSource:
    source: Source
    command_id: str


async def queue_source(
    source: Source,
    content_state: dict,
    notebook_ids: list[str],
    transformations: list[str],
    embed: bool,
    *,
    recover: bool = False,
) -> QueuedSource:
    from commands.source_commands import SourceProcessingInput

    if recover and source.command:
        return QueuedSource(source, str(source.command))
    await source.save()
    for notebook_id in notebook_ids:
        await source.add_to_notebook(notebook_id)
    command_input = SourceProcessingInput(
        source_id=str(source.id),
        content_state=content_state,
        notebook_ids=notebook_ids,
        transformations=transformations,
        embed=embed,
    )
    existing = await repo_query(
        "SELECT id FROM command WHERE app = 'open_notebook' AND name = 'process_source' AND args.source_id = $source_id LIMIT 1;",
        {"source_id": source.id},
    ) if recover else []
    command_id = str(existing[0]["id"]) if existing else await CommandService.submit_command_job(
        "open_notebook", "process_source", command_input.model_dump()
    )
    source.command = ensure_record_id(command_id)
    await source.save()
    return QueuedSource(source, command_id)


async def queue_managed_upload_source(
    stored: StoredOriginal,
    original_filename: str,
    user: AuthenticatedUser | None,
    notebook_ids: list[str],
    transformations: list[str],
    embed: bool,
    retention_action: str,
    *,
    title: str | None = None,
    delete_source: bool = False,
    source_id: str | None = None,
    version_id: str | None = None,
    claim_id: str | None = None,
) -> QueuedSource:
    asset = Asset(
        file_path=stored.file_path,
        original_file_store=stored.provider,
        original_file_key=stored.key,
        original_file_etag=stored.etag,
        original_file_profile_id=stored.profile_id,
        original_file_container_id=stored.container_id,
        original_filename=original_filename,
        original_size_bytes=stored.size_bytes,
        original_file_action=retention_action,
    )
    source = Source(
        id=source_id,
        title=title or original_filename,
        topics=[],
        asset=asset,
        user_id=user.id if user else None,
        client_id=user.client_id if user else None,
    )
    try:
        if version_id and claim_id and source_id:
            from commands.source_commands import SourceProcessingInput

            command_id = "command:connector_" + sha256(source_id.encode()).hexdigest()
            source.command = ensure_record_id(command_id)
            content_state = {**asset.model_dump(exclude_none=True), "delete_source": delete_source}
            args = SourceProcessingInput(
                source_id=source_id, content_state=content_state,
                notebook_ids=notebook_ids, transformations=transformations, embed=embed,
            ).model_dump()
            transaction = asyncio.create_task(repo_query(
                "BEGIN TRANSACTION; "
                "LET $owned = SELECT id FROM $version_id WHERE claim_id = $claim_id AND lease_until > $now AND status = 'claiming'; "
                "IF array::len($owned) != 1 THEN THROW 'SharePoint import claim expired' END; "
                "CREATE $source_id CONTENT $source_data; "
                "CREATE $command_id CONTENT $command_data; "
                "COMMIT TRANSACTION;",
                {"version_id": ensure_record_id(version_id), "claim_id": claim_id,
                 "now": time(), "source_id": ensure_record_id(source_id),
                 "source_data": {k: v for k, v in source._prepare_save_data().items() if k != "id"},
                 "command_id": ensure_record_id(command_id),
                 "command_data": {"app": "open_notebook", "name": "process_source", "args": args,
                                  "context": {}, "status": "new"}},
            ))
            try:
                await asyncio.shield(transaction)
            except asyncio.CancelledError:
                # The database may commit after the caller is cancelled. Let the
                # transaction settle before the caller decides whether to delete
                # the stored original.
                await transaction
                raise
            for notebook_id in notebook_ids:
                await source.add_to_notebook(notebook_id)
            return QueuedSource(source, command_id)
        if source_id:
            await repo_upsert("source", source_id, source._prepare_save_data(), add_timestamp=True)
        return await queue_source(
            source,
            {**asset.model_dump(exclude_none=True), "delete_source": delete_source},
            notebook_ids,
            transformations,
            embed,
            recover=source_id is not None,
        )
    except Exception:
        # Upload requests have no durable batch to retry. Preserve connector
        # sources for recovery, but discard a half-created ordinary upload.
        if source_id is None and source.id is not None:
            try:
                await source.delete()
            except Exception:
                pass
        raise
