"""Source-file service — retention policy application + safe file lifecycle.

One focused module owning:

- resolution of the effective ``original_file_action`` at upload time,
- safe deletion of the original file after successful processing,
- containment/eligibility checks reused by the cleanup APIs,
- the public asset-model mapper that keeps ``asset.file_path`` server-side.

Routers stay thin — they call helpers here rather than reaching into
domain internals directly.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Optional

from fastapi import UploadFile
from loguru import logger

from api.models import AssetModel, SourceCreate
from open_notebook.config import UPLOADS_FOLDER
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.notebook import Asset, Source
from open_notebook.domain.original_file_policy import (
    OriginalFileAction,
    OriginalFileDeletionReason,
    OriginalFileStatus,
    resolve_original_file_action,
)
from open_notebook.storage.original_files import (
    OriginalFileRef,
    OriginalFileStore,
    get_original_file_store,
    reference_from_asset,
)

_SOURCE_COMMAND_RESULT_FIELDS = frozenset(
    {"success", "source_id", "embedded_chunks", "insights_created", "processing_time"}
)


def build_public_command_status(status_data: dict) -> dict:
    """Map every persisted source-processing command status to safe fields."""
    if (
        status_data.get("command_app") != "open_notebook"
        or status_data.get("command_name") != "process_source"
    ):
        return status_data

    result = status_data.get("result")
    return {
        key: status_data.get(key)
        for key in ("job_id", "status", "created", "updated")
    } | {
        "result": (
            {key: result[key] for key in _SOURCE_COMMAND_RESULT_FIELDS if key in result}
            if isinstance(result, dict)
            else None
        ),
        "error_message": "Source processing failed"
        if status_data.get("error_message")
        else None,
        "progress": None,
    }


@asynccontextmanager
async def stage_upload(upload: UploadFile) -> AsyncIterator[Path]:
    """Stage bounded upload chunks in a private directory, cleaned on every exit."""
    filename = Path(upload.filename or "").name
    if filename in {"", ".", ".."}:
        raise ValueError("No filename provided")
    with tempfile.TemporaryDirectory(prefix="open-notebook-upload-") as directory:
        path = Path(directory) / filename
        with path.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                await asyncio.to_thread(target.write, chunk)
        yield path


@asynccontextmanager
async def materialize_original_file(
    store: OriginalFileStore, ref: OriginalFileRef, filename: Optional[str]
) -> AsyncIterator[Path]:
    """Keep the upload's extension for extractors when a provider uses opaque temp names."""
    async with store.materialize(ref) as path:
        suffix = Path(filename or "").suffix
        if not suffix or path.suffix == suffix:
            yield path
            return
        with tempfile.TemporaryDirectory(prefix="open-notebook-extract-") as directory:
            named_path = Path(directory) / f"original{suffix}"
            try:
                await asyncio.to_thread(os.link, path, named_path)
            except OSError:
                await asyncio.to_thread(shutil.copyfile, path, named_path)
            yield named_path


async def resolve_action_for_source_create(
    source_data: SourceCreate,
    settings: Optional[ContentSettings] = None,
) -> OriginalFileAction:
    """Resolve the effective retention action for one upload request.

    Loads ``ContentSettings`` once (or accepts an injected instance for
    tests) and delegates to the pure resolver. Backward-compat: when the
    client omits ``original_file_action`` and the policy mode is
    ``user_choice``, the legacy ``delete_source`` boolean is translated
    into an action; forced admin modes still win, so the deprecated flag
    can never override an ``always_keep`` install.

    If loading settings fails (e.g. characterization tests without a
    live DB, or a first-boot install), fall back to the safe default —
    keep originals until an admin explicitly chooses a policy.
    """
    if settings is None:
        try:
            loaded = await ContentSettings.get_instance()
            if isinstance(loaded, ContentSettings):
                settings = loaded
        except Exception:
            # Fail-safe: default to keep — matches the legacy-install
            # invariant from the plan.
            settings = None

    policy = settings.original_file_policy if settings else "always_keep"
    default_action = (
        settings.original_file_user_default if settings else "keep"
    )

    requested: OriginalFileAction | None = source_data.original_file_action
    if requested is None and source_data.delete_source:
        # DEPRECATED translation window: the old boolean maps to
        # "delete_after_processing" only when the policy actually lets
        # the owner choose. Forced modes ignore it.
        requested = "delete_after_processing"

    return resolve_original_file_action(
        policy=policy,
        default_action=default_action,
        requested_action=requested,
    )


def build_upload_asset(
    file_path: str,
    original_filename: str,
    action: OriginalFileAction,
) -> Asset:
    """Construct the internal ``Asset`` for a new upload with snapshot fields.

    The size is measured from the saved file (not the client-declared
    Content-Length) so the recorded byte count matches what's on disk.
    """
    try:
        size = Path(file_path).stat().st_size
    except OSError:
        # Should not happen on the accept path (we just wrote it), but
        # never let a failed stat prevent the source from being created.
        size = 0
    return Asset(
        file_path=file_path,
        original_filename=original_filename,
        original_size_bytes=size,
        original_file_action=action,
    )


def _derive_original_file_status(asset: Asset) -> OriginalFileStatus:
    """Derive the public status from stored fields without touching disk.

    Callers that need to know whether a retained file is *actually* on
    disk (e.g. the download endpoint) run their own containment check
    against ``UPLOADS_FOLDER``; this helper answers based on metadata.
    """
    if asset.original_deleted_at is not None:
        return "deleted"
    if reference_from_asset(asset):
        return "retained"
    if asset.original_filename:
        # Snapshot exists but no on-disk path — treat as missing.
        return "missing"
    return "not_applicable"


def _asset_from_row(row: Optional[dict]) -> Optional[Asset]:
    """Best-effort ``Asset`` reconstruction from a library-query row dict.

    The library route returns row dicts (not domain objects) for
    performance. Unknown / legacy rows may omit any subset of
    retention-governance fields; ``Asset`` allows all of them to be
    None, so a partial dict passes validation.
    """
    if row is None:
        return None
    return Asset(**{k: row.get(k) for k in Asset.model_fields.keys()})


def build_public_asset_model(
    asset: Optional[Asset | dict],
) -> Optional[AssetModel]:
    """Map an internal ``Asset`` (or raw row dict) to the public ``AssetModel``.

    Never emits ``file_path`` — the internal storage location stays
    server-side. For legacy assets that only have ``file_path`` (before
    Task 1 landed), the safe basename is derived and used as the
    original filename display; only after containment validation, which
    happens in the download endpoint before streaming.
    """
    if asset is None:
        return None
    if isinstance(asset, dict):
        asset = _asset_from_row(asset)
    elif not isinstance(asset, Asset):
        # A duck-typed / MagicMock payload can't be trusted to satisfy
        # Pydantic's strict validators on the response model. Behave as
        # if there were no asset rather than raising through.
        return None
    if asset is None:
        return None

    original_filename = asset.original_filename
    if original_filename is None and asset.file_path:
        # Legacy row: use basename only. Never expose the parent dirs.
        original_filename = Path(asset.file_path).name

    return AssetModel(
        url=asset.url,
        original_filename=original_filename,
        original_size_bytes=asset.original_size_bytes,
        original_file_action=asset.original_file_action,
        original_deleted_at=(
            asset.original_deleted_at.isoformat()
            if asset.original_deleted_at
            else None
        ),
        original_deleted_reason=asset.original_deleted_reason,
        original_file_status=_derive_original_file_status(asset),
    )


def build_public_processing_info(info: Optional[dict], asset: Optional[Asset | dict]) -> Optional[dict]:
    """Keep provider-backed command errors and raw result payloads server-side."""
    if not isinstance(asset, (Asset, dict)):
        return info
    provider = asset.get("original_file_store") if isinstance(asset, dict) else asset.original_file_store
    if not provider or not info:
        return info
    public = {
        key: info[key]
        for key in ("status", "started_at", "completed_at", "async", "queued", "retry")
        if key in info
    }
    if "error" in info:
        public["error"] = "Source processing failed" if info["error"] else None
    return public


def _resolve_contained_upload_path(file_path: str) -> Optional[Path]:
    """Resolve ``file_path`` to an absolute path that lives beneath the
    configured uploads root. Returns None for any path that escapes it or
    fails to resolve — callers treat None as "reject, do nothing".
    """
    try:
        uploads_root = Path(UPLOADS_FOLDER).resolve()
        candidate = Path(file_path).resolve()
    except (OSError, ValueError):
        return None
    try:
        candidate.relative_to(uploads_root)
    except ValueError:
        return None
    return candidate


async def delete_original_file(
    source: Source,
    *,
    reason: OriginalFileDeletionReason,
) -> str:
    """Idempotently delete the original file backing ``source``.

    Returns one of ``"deleted"``, ``"already_deleted"``, ``"missing"``,
    ``"unsafe"``, ``"error"``, or ``"not_applicable"``. Only the asset's
    recorded provider reference is used; legacy paths require containment.

    Two-phase write so a failed provider delete is recoverable:

    1. Set ``original_deletion_started_at`` + ``original_deleted_reason``
       and save.
    2. Delete through the provider (failures retain the intent and reference).
    3. Clear storage references, set ``original_deleted_at``, and save.

    On retry: a source with a start marker and an absent file finalizes
    step 3; a source with ``original_deleted_at`` already set returns
    ``already_deleted``. Assets with no reference or marker return ``missing``.
    """
    asset = source.asset
    if asset is None:
        return "not_applicable"

    # Already recorded as deleted — nothing to do.
    ref = reference_from_asset(asset)
    if asset.original_deleted_at is not None and ref is None:
        return "already_deleted"

    if ref is None:
        # No path to delete; if we started, finalize as missing.
        if asset.original_deletion_started_at is not None:
            asset.original_deleted_at = datetime.now(timezone.utc)
            await source.save()
            return "already_deleted"
        return "missing"

    if (
        ref.legacy_file_path
        and _resolve_contained_upload_path(ref.legacy_file_path) is None
    ):
        logger.warning(
            "Refusing to delete file outside uploads root for source "
            f"{source.id}"
        )
        return "unsafe"

    # Phase 1: persist intent before any provider call, including configuration.
    if asset.original_deletion_started_at is None:
        asset.original_deletion_started_at = datetime.now(timezone.utc)
        asset.original_deleted_reason = reason
        await source.save()

    # Phase 2: a missing object is safe to finalize after a partial failure.
    try:
        store = get_original_file_store(ref.provider)
        existed = await store.exists(ref)
        if existed and not await store.delete(ref):
            return "error"
    except Exception:
        logger.warning(f"Failed to delete original file for source {source.id}")
        return "error"

    # Phase 3: finalize.
    asset.file_path = None
    asset.original_file_store = None
    asset.original_file_key = None
    asset.original_file_etag = None
    asset.original_deleted_at = datetime.now(timezone.utc)
    await source.save()

    return "deleted" if existed else "already_deleted"
