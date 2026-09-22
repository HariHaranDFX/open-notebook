import time
from contextlib import AsyncExitStack
from typing import Any, Dict, List, Optional

from langchain_core.runnables import RunnableConfig
from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from api.source_file_service import materialize_original_file
from open_notebook.database.repository import ensure_record_id
from open_notebook.domain.notebook import Source
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import ConfigurationError, ContextLengthExceededError
from open_notebook.storage.original_files import (
    get_original_file_store,
    reference_from_asset,
)

try:
    from open_notebook.graphs.source import source_graph
    from open_notebook.graphs.transformation import graph as transform_graph
except ImportError as e:
    logger.error(f"Failed to import graphs: {e}")
    raise ValueError("graphs not available")


async def _maybe_delete_original_after_success(source: Source) -> None:
    """Post-success retention hook.

    Called only from ``process_source_command`` once the source_graph has
    returned. Deletion executes only when:

    - the source has an asset with ``original_file_action == "delete_after_processing"``,
    - ``full_text`` is populated (guard against a "successful" empty extract),
    - the file is still on the filesystem and safely contained (helper enforces).

    Failure to unlink raises through so the command retries. Once deleted,
    the helper is idempotent on subsequent calls.
    """
    # Reload so we see everything the graph just saved (full_text + asset).
    reloaded = await Source.get(str(source.id))
    if reloaded is None:
        return
    asset = reloaded.asset
    if asset is None or asset.original_file_action != "delete_after_processing":
        return
    if not reloaded.full_text:
        # Safety net — the graph raises on empty extract, but if a future
        # code path ever bypasses that, do not delete the input we still
        # need for retry.
        logger.warning(
            f"Skipping post-success delete for {source.id}: full_text empty"
        )
        return

    from api.source_file_service import delete_original_file

    outcome = await delete_original_file(reloaded, reason="retention_policy")
    logger.info(f"Retention delete outcome for {source.id}: {outcome}")
    if outcome == "error":
        # Fail the command so surreal-commands retries; the two-phase
        # write keeps the marker, so a retry finalizes cleanly.
        raise RuntimeError(
            f"Failed to delete original file for source {source.id}"
        )


class SourceProcessingInput(CommandInput):
    source_id: str
    content_state: Dict[str, Any]
    notebook_ids: List[str]
    transformations: List[str]
    embed: bool


class SourceProcessingOutput(CommandOutput):
    success: bool
    source_id: str
    embedded_chunks: int = 0
    insights_created: int = 0
    processing_time: float
    error_message: Optional[str] = None


@command(
    "process_source",
    app="open_notebook",
    retry={
        "max_attempts": 15,  # Handle deep queues (workaround for SurrealDB v2 transaction conflicts)
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 120,  # Allow queue to drain
        "stop_on": [ValueError, ConfigurationError, ContextLengthExceededError],  # Don't retry validation/config errors
        "retry_log_level": "debug",  # Avoid log noise during transaction conflicts
    },
)
async def process_source_command(
    input_data: SourceProcessingInput,
) -> SourceProcessingOutput:
    """
    Process source content using the source_graph workflow
    """
    start_time = time.time()

    try:
        logger.info(f"Starting source processing for source: {input_data.source_id}")
        logger.info(f"Notebook IDs: {input_data.notebook_ids}")
        logger.info(f"Transformations: {input_data.transformations}")
        logger.info(f"Embed: {input_data.embed}")

        # 1. Load transformation objects from IDs
        transformations = []
        for trans_id in input_data.transformations:
            logger.info(f"Loading transformation: {trans_id}")
            transformation = await Transformation.get(trans_id)
            if not transformation:
                raise ValueError(f"Transformation '{trans_id}' not found")
            transformations.append(transformation)

        logger.info(f"Loaded {len(transformations)} transformations")

        # 2. Get existing source record to update its command field
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        # Update source with command reference
        source.command = (
            ensure_record_id(input_data.execution_context.command_id)
            if input_data.execution_context
            else None
        )
        await source.save()

        logger.info(f"Updated source {source.id} with command reference")

        # 3. Process source with all notebooks
        logger.info(f"Processing source with {len(input_data.notebook_ids)} notebooks")

        # Execute source_graph with all notebooks.
        # LangGraph accepts a partial state dict at runtime, but its typed
        # overloads require the full state type (langgraph typing limitation).
        content_state = dict(input_data.content_state)
        ref = reference_from_asset(source.asset)
        async with AsyncExitStack() as stack:
            if ref is not None and ref.legacy_file_path is None:
                # Provider details belong on the persisted Asset, never in
                # the extractor state or its result/error payloads.
                for field in (
                    "original_file_store",
                    "original_file_key",
                    "original_file_etag",
                ):
                    content_state.pop(field, None)
                path = await stack.enter_async_context(
                    materialize_original_file(
                        get_original_file_store(ref.provider), ref, source.asset.original_filename
                    )
                )
                content_state["file_path"] = str(path)
            result = await source_graph.ainvoke(  # type: ignore[call-overload]
                {
                    "content_state": content_state,
                    "notebook_ids": input_data.notebook_ids,
                    "apply_transformations": transformations,
                    "embed": input_data.embed,
                    "source_id": input_data.source_id,
                }
            )

        processed_source = result["source"]

        # 4. Retention governance (Task 3): now that the graph succeeded and
        # ``full_text`` has been persisted, delete the original upload if
        # the snapshotted action asks us to. This runs AFTER the graph so
        # a downstream failure never leaves us without the file to retry.
        # Reload the source to pick up the graph's saves and confirm
        # full_text is present before touching the file.
        await _maybe_delete_original_after_success(processed_source)

        # 5. Gather processing results (notebook associations handled by source_graph)
        # Note: embedding is fire-and-forget (async job), so we can't query the
        # count here — it hasn't completed yet. The embed_source_command logs
        # the actual count when it finishes.
        insights_list = await processed_source.get_insights()
        insights_created = len(insights_list)

        processing_time = time.time() - start_time
        embed_status = "submitted" if input_data.embed else "skipped"
        logger.info(
            f"Successfully processed source: {processed_source.id} in {processing_time:.2f}s"
        )
        logger.info(
            f"Created {insights_created} insights, embedding {embed_status}"
        )

        return SourceProcessingOutput(
            success=True,
            source_id=str(processed_source.id),
            embedded_chunks=0,
            insights_created=insights_created,
            processing_time=processing_time,
        )

    except (ValueError, ConfigurationError) as e:
        # Permanent failures. Re-raise so surreal-commands marks the job as
        # `failed` (stop_on above already covers both types and prevents
        # pointless retries). Returning a success=False result instead marks
        # the job `completed` (is_success() checks job status, not the
        # payload), which hid extraction failures and left the source without
        # a retryable `failed` status in the UI. Catching ConfigurationError
        # here (not just ValueError) keeps the log wording honest -- password-
        # protected PDF and missing-ffmpeg errors are permanent, not
        # transient.
        logger.error(f"Source processing failed (permanent): {e}")
        raise
    except Exception as e:
        # Transient failure - will be retried by surreal-commands. Split by
        # cause: SurrealDB transaction conflicts are expected noise during
        # concurrent writes (see open_notebook/AGENTS.md), keep them at DEBUG.
        # Everything else raised to WARNING with the exception TYPE included,
        # because surreal-commands' worker overrides loguru's log level to
        # INFO+ regardless of env vars -- a bare DEBUG log meant retry-loop
        # failures were completely silent for 15 attempts.
        is_transaction_conflict = isinstance(e, RuntimeError) and (
            "transaction" in str(e).lower() or "conflict" in str(e).lower()
        )
        log = logger.debug if is_transaction_conflict else logger.warning
        log(
            f"Transient error processing source {input_data.source_id}: "
            f"{type(e).__name__}: {e}"
        )
        raise


# =============================================================================
# RUN TRANSFORMATION COMMAND
# =============================================================================


class RunTransformationInput(CommandInput):
    """Input for running a transformation on an existing source."""

    source_id: str
    transformation_id: str


class RunTransformationOutput(CommandOutput):
    """Output from transformation command."""

    success: bool
    source_id: str
    transformation_id: str
    processing_time: float
    error_message: Optional[str] = None


@command(
    "run_transformation",
    app="open_notebook",
    retry={
        "max_attempts": 5,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 60,
        "stop_on": [ValueError, ConfigurationError, ContextLengthExceededError],  # Don't retry validation/config errors
        "retry_log_level": "warning",
    },
)
async def run_transformation_command(
    input_data: RunTransformationInput,
) -> RunTransformationOutput:
    """
    Run a transformation on an existing source to generate an insight.

    This command runs the transformation graph which:
    1. Loads the source and transformation
    2. Calls the LLM to generate insight content
    3. Creates the insight via create_insight command (fire-and-forget)

    Use this command for UI-triggered insight generation to avoid blocking
    the HTTP request while the LLM processes.

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors)
    """
    start_time = time.time()

    try:
        logger.info(
            f"Running transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}"
        )

        # Load source
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        # Load transformation
        transformation = await Transformation.get(input_data.transformation_id)
        if not transformation:
            raise ValueError(
                f"Transformation '{input_data.transformation_id}' not found"
            )

        # Run transformation graph (includes LLM call + insight creation).
        # LangGraph accepts a partial state dict at runtime, but its typed
        # overloads require the full state type (langgraph typing limitation).
        await transform_graph.ainvoke(  # type: ignore[call-overload]
            input=dict(source=source, transformation=transformation),
            config=RunnableConfig(configurable={"model_id": transformation.model_id}),
        )

        processing_time = time.time() - start_time
        logger.info(
            f"Successfully ran transformation {input_data.transformation_id} "
            f"on source {input_data.source_id} in {processing_time:.2f}s"
        )

        return RunTransformationOutput(
            success=True,
            source_id=input_data.source_id,
            transformation_id=input_data.transformation_id,
            processing_time=processing_time,
        )

    except ValueError as e:
        # Validation errors are permanent failures - don't retry
        processing_time = time.time() - start_time
        logger.error(
            f"Failed to run transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}: {e}"
        )
        return RunTransformationOutput(
            success=False,
            source_id=input_data.source_id,
            transformation_id=input_data.transformation_id,
            processing_time=processing_time,
            error_message=str(e),
        )
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        logger.debug(
            f"Transient error running transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}: {e}"
        )
        raise
