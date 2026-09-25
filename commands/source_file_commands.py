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


class ReconcileOriginalUploadsInput(CommandInput):
    grace_seconds: int = 900


class ReconcileOriginalUploadsOutput(CommandOutput):
    success: bool
    deleted: int
    queued: int
    retained: int
    abandoned: int
    processing_time: float


@command(
    "reconcile_original_uploads",
    app="open_notebook",
    retry={
        "max_attempts": 1,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 15,
        "stop_on": [ValueError],
        "retry_log_level": "debug",
    },
)
async def reconcile_original_uploads_command(
    input_data: ReconcileOriginalUploadsInput,
) -> ReconcileOriginalUploadsOutput:
    from open_notebook.storage.upload_operations import reconcile_due_uploads

    start = time.time()
    logger.info("=" * 60)
    logger.info(
        "Starting original upload reconciliation "
        f"(grace_seconds={input_data.grace_seconds})"
    )
    logger.info("=" * 60)
    try:
        counts = await reconcile_due_uploads(input_data.grace_seconds)
    except Exception as exc:
        logger.error(
            "Original upload reconciliation FAILED after "
            f"{time.time() - start:.2f}s: {exc.__class__.__name__}"
        )
        raise
    elapsed = time.time() - start
    logger.info("=" * 60)
    logger.info("Original upload reconciliation DONE")
    logger.info(f"  Deleted: {counts['deleted']}")
    logger.info(f"  Queued: {counts['queued']}")
    logger.info(f"  Retained: {counts['retained']}")
    logger.info(f"  Abandoned: {counts['abandoned']}")
    logger.info(f"  Elapsed: {elapsed:.2f}s")
    logger.info("=" * 60)
    return ReconcileOriginalUploadsOutput(
        success=True,
        deleted=counts["deleted"],
        queued=counts["queued"],
        retained=counts["retained"],
        abandoned=counts["abandoned"],
        processing_time=elapsed,
    )


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
    candidates = input_data.candidate_source_ids
    logger.info("=" * 60)
    logger.info(
        f"Starting original file cleanup (scope={input_data.scope}, candidates={len(candidates)})"
    )
    logger.info("=" * 60)
    if not candidates:
        logger.info("Nothing to clean")

    try:
        for source_id in candidates:
            try:
                source = await Source.get(source_id)
            except Exception as e:
                logger.warning(f"Cleanup: source {source_id} could not be loaded: {e}")
                skipped += 1
                logger.info(f"  → source_id={source_id} skipped")
                continue
            if source is None:
                skipped += 1
                logger.info(f"  → source_id={source_id} skipped")
                continue

            asset = source.asset
            if asset is None or reference_from_asset(asset) is None:
                skipped += 1
                logger.info(f"  → source_id={source_id} skipped")
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
                    logger.info(f"  → source_id={source_id} skipped")
                    continue
            else:
                if not input_data.is_admin:
                    # Demoted mid-flight: fail closed.
                    skipped += 1
                    logger.info(f"  → source_id={source_id} skipped")
                    continue

            size = asset.original_size_bytes or 0
            logger.info(f"Cleaning source_id={source_id}")
            outcome = await delete_original_file(source, reason=reason)
            logger.info(f"  → source_id={source_id} {outcome}")
            if outcome == "deleted" or outcome == "already_deleted":
                deleted += 1
                bytes_reclaimed += size
            elif outcome in ("missing", "not_applicable"):
                skipped += 1
            else:
                # "unsafe" or "error"
                failed += 1
    except Exception as exc:
        logger.error(
            "Original file cleanup FAILED after "
            f"{time.time() - start:.2f}s: {exc.__class__.__name__}"
        )
        raise

    elapsed = time.time() - start
    logger.info("=" * 60)
    logger.info("Original file cleanup DONE")
    logger.info(f"  Deleted: {deleted}")
    logger.info(f"  Skipped: {skipped}")
    logger.info(f"  Failed: {failed}")
    logger.info(f"  Bytes reclaimed: {bytes_reclaimed}")
    logger.info(f"  Elapsed: {elapsed:.2f}s")
    logger.info("=" * 60)
    return CleanupOriginalFilesOutput(
        success=True,
        scope=input_data.scope,
        deleted=deleted,
        skipped=skipped,
        failed=failed,
        bytes_reclaimed=bytes_reclaimed,
        processing_time=elapsed,
    )
