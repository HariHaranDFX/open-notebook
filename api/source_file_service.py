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

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

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
    """
    if settings is None:
        settings = await ContentSettings.get_instance()

    requested: OriginalFileAction | None = source_data.original_file_action
    if requested is None and source_data.delete_source:
        # DEPRECATED translation window: the old boolean maps to
        # "delete_after_processing" only when the policy actually lets
        # the owner choose. Forced modes ignore it.
        requested = "delete_after_processing"

    return resolve_original_file_action(
        policy=settings.original_file_policy,
        default_action=settings.original_file_user_default,
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
    if asset.file_path:
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
    or ``"unsafe"``. Callers pass the loaded ``Source`` (never a raw
    request path); this helper resolves the stored path, verifies
    containment beneath ``UPLOADS_FOLDER``, and never touches anything
    else on disk.

    Two-phase write so a crashed unlink is recoverable:

    1. Set ``original_deletion_started_at`` + ``original_deleted_reason``
       and save.
    2. Unlink the file.
    3. Clear ``file_path`` and set ``original_deleted_at`` and save.

    On retry: a source with a start marker and an absent file finalizes
    step 3; a source with ``original_deleted_at`` already set returns
    ``already_deleted``. A missing file WITHOUT a start marker is
    reported as ``missing`` (not called an application deletion).
    """
    asset = source.asset
    if asset is None:
        return "not_applicable"

    # Already recorded as deleted — nothing to do.
    if asset.original_deleted_at is not None and asset.file_path is None:
        return "already_deleted"

    if not asset.file_path:
        # No path to delete; if we started, finalize as missing.
        if asset.original_deletion_started_at is not None:
            asset.original_deleted_at = datetime.now(timezone.utc)
            await source.save()
            return "already_deleted"
        return "missing"

    safe_path = _resolve_contained_upload_path(asset.file_path)
    if safe_path is None:
        logger.warning(
            "Refusing to delete file outside uploads root for source "
            f"{source.id}"
        )
        return "unsafe"

    # Phase 1: record the intent so a crash between unlink and save is recoverable.
    if asset.original_deletion_started_at is None:
        asset.original_deletion_started_at = datetime.now(timezone.utc)
        asset.original_deleted_reason = reason
        await source.save()

    # Phase 2: unlink. Missing-on-disk is fine — we'll still finalize.
    unlinked = False
    if safe_path.exists() and safe_path.is_file():
        try:
            safe_path.unlink()
            unlinked = True
        except OSError as e:
            # Retain state so a retry can attempt again. Do NOT clear
            # file_path or set original_deleted_at — the file may still
            # be on disk.
            logger.warning(
                f"Failed to unlink original file for source {source.id}: {e}"
            )
            return "error"

    # Phase 3: finalize.
    asset.file_path = None
    asset.original_deleted_at = datetime.now(timezone.utc)
    await source.save()

    return "deleted" if unlinked else "already_deleted"
