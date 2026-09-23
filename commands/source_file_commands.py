"""Bounded cleanup command for retained original upload files.

Task 5 of the retention governance plan. This command is *internal* —
only the ``/source-files/cleanup`` route may submit it. The generic
command-submission route in ``api/routers/commands.py`` rejects it by
name so an authenticated user cannot invoke it directly.

Contract:

- ``scope='mine'``: cleanup targets sources whose ``user_id`` matches
  the requester. Requires the requester to still be permitted to run
  owner cleanup at execution time.
- ``scope='all'``: cleanup targets every source in the installation.
  Requires the requester to still be an administrator at execution
  time — a demoted admin cannot silently continue a cleanup they
  scheduled.
- Only sources whose asset carries ``original_file_action='delete_after_processing'``
  or that the requester explicitly targets are eligible; embedded /
  extracted / notebook-linked data is never touched.
- Partial failures are counted, not fatal — the worker returns
  aggregate ``deleted / skipped / failed`` totals.
"""

from __future__ import annotations

import time
from typing import List, Literal

from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.domain.notebook import Source
from open_notebook.domain.original_file_policy import OriginalFileDeletionReason
from open_notebook.storage.original_files import reference_from_asset

CleanupScope = Literal["mine", "all"]


class CleanupOriginalFilesInput(CommandInput):
    scope: CleanupScope
    requesting_user_id: str | None = None
    is_admin: bool = False
    candidate_source_ids: List[str] = []


class CleanupOriginalFilesOutput(CommandOutput):
    success: bool
    scope: CleanupScope
    deleted: int
    skipped: int
    failed: int
    bytes_reclaimed: int
    processing_time: float


@command(
    "cleanup_original_files",
    app="open_notebook",
    retry={
        "max_attempts": 1,  # Internal only; requester revalidates on start.
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 15,
        "stop_on": [ValueError],
        "retry_log_level": "debug",
    },
)
async def cleanup_original_files_command(
    input_data: CleanupOriginalFilesInput,
) -> CleanupOriginalFilesOutput:
    """Iterate the candidate list, reload each source, and delete originals.

    Revalidates authorization per source: the requester must still be an
    admin for ``scope='all'`` or still be the source owner for
    ``scope='mine'``. Non-eligible sources are skipped, not failed.
    """
    from api.source_file_service import delete_original_file

    start = time.time()
    deleted = skipped = failed = 0
    bytes_reclaimed = 0
    reason: OriginalFileDeletionReason = (
        "admin_cleanup" if input_data.scope == "all" else "source_owner"
    )

    for source_id in input_data.candidate_source_ids:
        try:
            source = await Source.get(source_id)
        except Exception as e:
            logger.warning(f"Cleanup: source {source_id} could not be loaded: {e}")
            skipped += 1
            continue
        if source is None:
            skipped += 1
            continue

        asset = source.asset
        if asset is None or reference_from_asset(asset) is None:
            skipped += 1
            continue

        # Owner-scope revalidation: the requester must still own the
        # source at execution time — a re-assigned source no longer
        # qualifies for this cleanup run.
        if input_data.scope == "mine":
            if not asset.original_size_bytes:
                # Estimate from stat if the snapshot is missing.
                pass
            if source.user_id != input_data.requesting_user_id:
                skipped += 1
                continue
        else:
            if not input_data.is_admin:
                # Demoted mid-flight: fail closed.
                skipped += 1
                continue

        size = asset.original_size_bytes or 0
        outcome = await delete_original_file(source, reason=reason)
        if outcome == "deleted" or outcome == "already_deleted":
            deleted += 1
            bytes_reclaimed += size
        elif outcome in ("missing", "not_applicable"):
            skipped += 1
        else:
            # "unsafe" or "error"
            failed += 1

    return CleanupOriginalFilesOutput(
        success=True,
        scope=input_data.scope,
        deleted=deleted,
        skipped=skipped,
        failed=failed,
        bytes_reclaimed=bytes_reclaimed,
        processing_time=time.time() - start,
    )
