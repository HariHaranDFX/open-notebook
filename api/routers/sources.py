import asyncio
import os
from pathlib import Path
from typing import Any, List, Optional
from urllib.parse import quote

from content_core import check_file_support
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, Response, StreamingResponse
from loguru import logger
from pydantic import ValidationError
from surreal_commands import execute_command_sync, submit_command

from api.auth.deps import current_user_optional
from api.auth.types import AuthenticatedUser
from api.command_service import CommandService
from api.credentials_service import validate_url
from api.models import (
    AccessSummary,
    CreateSourceInsightRequest,
    InsightCreationResponse,
    SourceCreate,
    SourceInsightResponse,
    SourceLibraryPageResponse,
    SourceListResponse,
    SourceResponse,
    SourceStatusResponse,
    SourceUpdate,
)
from api.ownership import (
    access_summary_for_source,
    assert_can_delete_source_or_403,
    assert_can_edit_notebook_or_403,
    assert_can_view_notebook_or_404,
    assert_can_view_source_or_404,
    role_at_least,
    source_access_where,
)
from api.pagination import (
    CURSOR_VERSION,
    CursorValidationError,
    decode_cursor,
    encode_cursor,
    fingerprint_filters,
)
from api.source_file_service import (
    build_public_asset_model,
    build_public_processing_info,
    materialize_original_file,
    stage_upload,
)
from commands.source_commands import SourceProcessingInput
from open_notebook.config import UPLOADS_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Asset, Notebook, Source
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import (
    InvalidInputError,
    NotFoundError,
    OpenNotebookError,
    UnsupportedTypeException,
)
from open_notebook.graphs.source import default_source_title
from open_notebook.storage.original_files import (
    OriginalFileRef,
    StoredOriginal,
    get_original_file_store,
    reference_from_asset,
)

router = APIRouter()


async def _assert_file_supported(file_path: str) -> None:
    """Pre-flight check that content-core can actually extract this file.

    Rejects unsupported uploads at ingestion time (HTTP 415) instead of letting
    them enqueue a background job that fails and then burns the full retry
    budget before surfacing a generic error (#975). Uses content-core's
    header-only routing, which is the same logic real extraction uses, so the
    verdict can't disagree with what would happen downstream.

    Unexpected errors (e.g. the file no longer exists on a retry) are swallowed
    so this never turns a transient problem into a hard rejection — real
    extraction will surface those.
    """
    try:
        support = await check_file_support(file_path)
    except Exception as e:  # pragma: no cover - defensive
        logger.debug(f"Pre-flight file-support check skipped for {file_path}: {e}")
        return

    if not support.supported:
        detail = support.reason or "Unsupported file type"
        if support.identified_type:
            detail = f"{detail} (detected type: {support.identified_type})"
        raise UnsupportedTypeException(detail)


def _truncate_error(msg: Optional[str], limit: int = 200) -> Optional[str]:
    """Cap error text surfaced to clients.

    Command/processing failures can carry arbitrary internal exception text;
    return at most ``limit`` characters so a raw traceback message can't leak
    to the API response. ``None`` passes through unchanged.
    """
    if not msg:
        return msg
    return msg if len(msg) <= limit else msg[:limit] + "…"


SOURCE_SORT_FIELDS = {
    "created": "created",
    "updated": "updated",
    # `title` carries a SEARCH (BM25) index; SurrealDB's planner tries to use
    # it for ORDER BY and fails ("No iterator has been found"), so we sort by
    # a computed alias instead — which also makes the sort case-insensitive.
    "title": "title_sort",
    "insights_count": "insights_count",
    "embedded": "embedded",
    "type": "type",
}

SOURCE_TYPE_EXPRESSION = (
    "IF asset.file_path != NONE OR "
    "(asset.original_file_store != NONE AND asset.original_file_key != NONE) THEN 'file' "
    "ELSE IF asset.url != NONE THEN 'link' ELSE 'text' END"
)

# Sort expressions inlined into the WHERE keyset predicate for each sort key.
# ORDER BY still references the SELECT alias (SOURCE_SORT_FIELDS above), which
# SurrealDB resolves; WHERE can't reference an alias, so it must inline the
# same expression that produced the alias.
SOURCE_LIBRARY_SORT_EXPR = {
    "created": "created",
    "updated": "updated",
    "title": "string::lowercase(title OR '')",
    "insights_count": (
        "(SELECT VALUE count() FROM source_insight "
        "WHERE source = $parent.id GROUP ALL)[0].count OR 0"
    ),
    "embedded": (
        "(SELECT VALUE id FROM source_embedding "
        "WHERE source = $parent.id LIMIT 1) != []"
    ),
    "type": SOURCE_TYPE_EXPRESSION,
}

# Default page size and cap for the library route. Kept modest — clients
# paginate with cursors, so a big page here doesn't help anyone.
SOURCE_LIBRARY_DEFAULT_LIMIT = 30
SOURCE_LIBRARY_MAX_LIMIT = 200


async def _stamp_source_view(source_id: str) -> None:
    # Best-effort write-on-read: recording the view timestamp must never turn a
    # successful read into a 500. Log and move on if the stamp update fails.
    try:
        await repo_query(
            "UPDATE $source_id SET last_viewed_at = time::now();",
            {"source_id": ensure_record_id(source_id)},
        )
    except Exception as e:
        logger.warning(f"Failed to stamp last_viewed_at for source {source_id}: {e}")


def generate_unique_filename(original_filename: str, upload_folder: str) -> str:
    """Generate unique filename like Streamlit app (append counter if file exists),
    atomically reserving it so two concurrent uploads that land on the same
    candidate name can't both pass the check and then clobber each other -
    the loser's claim attempt fails and moves on to the next candidate."""
    file_path = Path(upload_folder)
    file_path.mkdir(parents=True, exist_ok=True)

    # Strip directory components to prevent path traversal
    safe_filename = os.path.basename(original_filename)
    if not safe_filename:
        raise ValueError("Invalid filename")

    # Split filename and extension
    stem = Path(safe_filename).stem
    suffix = Path(safe_filename).suffix
    safe_root = file_path.resolve()

    # Find and atomically claim a unique name
    counter = 0
    while True:
        if counter == 0:
            new_filename = safe_filename
        else:
            new_filename = f"{stem} ({counter}){suffix}"

        full_path = file_path / new_filename
        # Verify resolved path stays within upload folder
        resolved = full_path.resolve()
        if not str(resolved).startswith(str(safe_root) + os.sep):
            raise ValueError("Invalid filename: path traversal detected")

        try:
            # O_EXCL via touch(exist_ok=False): atomically create-or-fail,
            # instead of exists() (check) followed by a separate write
            # (act) elsewhere with a race window in between.
            resolved.touch(exist_ok=False)
            return str(resolved)
        except FileExistsError:
            counter += 1


async def save_uploaded_file(upload_file: UploadFile) -> StoredOriginal:
    """Preflight a staged upload, then save it to the configured provider."""
    async with stage_upload(upload_file) as path:
        await _assert_file_supported(str(path))
        return await get_original_file_store().save(path, path.name)


def parse_source_form_data(
    type: str = Form(...),
    notebook_id: Optional[str] = Form(None),
    notebooks: Optional[str] = Form(None),  # JSON string of notebook IDs
    url: Optional[str] = Form(None),
    content: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    transformations: Optional[str] = Form(None),  # JSON string of transformation IDs
    embed: str = Form("false"),  # Accept as string, convert to bool
    delete_source: str = Form("false"),  # Accept as string, convert to bool
    async_processing: str = Form("false"),  # Accept as string, convert to bool
    file: Optional[UploadFile] = File(None),
) -> tuple[SourceCreate, Optional[UploadFile]]:
    """Parse form data into SourceCreate model and return upload file separately."""
    import json

    # Convert string booleans to actual booleans
    def str_to_bool(value: str) -> bool:
        return value.lower() in ("true", "1", "yes", "on")

    embed_bool = str_to_bool(embed)
    delete_source_bool = str_to_bool(delete_source)
    async_processing_bool = str_to_bool(async_processing)

    # Parse JSON strings
    notebooks_list = None
    if notebooks:
        try:
            notebooks_list = json.loads(notebooks)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON in notebooks field: {notebooks}")
            raise HTTPException(
                status_code=422, detail="Invalid JSON in notebooks field"
            )

    transformations_list = []
    if transformations:
        try:
            transformations_list = json.loads(transformations)
        except json.JSONDecodeError:
            logger.error(f"Invalid JSON in transformations field: {transformations}")
            raise HTTPException(
                status_code=422, detail="Invalid JSON in transformations field"
            )

    # Create SourceCreate instance
    try:
        source_data = SourceCreate(
            type=type,
            notebook_id=notebook_id,
            notebooks=notebooks_list,
            url=url,
            content=content,
            title=title,
            file_path=None,  # Will be set later if file is uploaded
            transformations=transformations_list,
            embed=embed_bool,
            delete_source=delete_source_bool,
            async_processing=async_processing_bool,
        )
    except ValidationError as e:
        errors = "; ".join(err.get("msg", "invalid value") for err in e.errors())
        logger.error(f"Invalid source form data: {errors}")
        raise HTTPException(status_code=422, detail=f"Invalid source data: {errors}")
    except Exception as e:
        logger.error(f"Failed to create SourceCreate instance: {e}")
        raise

    return source_data, file


@router.get("/sources", response_model=List[SourceListResponse])
async def get_sources(
    request: Request,
    notebook_id: Optional[str] = Query(None, description="Filter by notebook ID"),
    query: Optional[str] = Query(None, max_length=200, description="Filter by source title"),
    limit: int = Query(
        50, ge=1, le=100, description="Number of sources to return (1-100)"
    ),
    offset: int = Query(0, ge=0, description="Number of sources to skip"),
    sort_by: str = Query(
        "updated",
        description="Field to sort by (type, title, created, updated, insights_count, or embedded)",
    ),
    sort_order: str = Query("desc", description="Sort order (asc or desc)"),
):
    """Get sources with pagination and sorting support."""
    try:
        # Validate sort parameters
        if sort_by not in SOURCE_SORT_FIELDS:
            raise HTTPException(
                status_code=400,
                detail=(
                    "sort_by must be one of: type, title, created, updated, "
                    "insights_count, embedded"
                ),
            )
        if sort_order.lower() not in ["asc", "desc"]:
            raise HTTPException(
                status_code=400, detail="sort_order must be 'asc' or 'desc'"
            )

        # Build ORDER BY clause
        order_clause = (
            f"ORDER BY {SOURCE_SORT_FIELDS[sort_by]} {sort_order.upper()}, id ASC"
        )

        # Build the query - same projection with or without the notebook
        # filter; only the FROM clause and bound params differ.
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if notebook_id:
            # Verify notebook exists and is viewable by the current user first
            notebook = await Notebook.get(notebook_id)
            await assert_can_view_notebook_or_404(
                notebook.user_id, notebook_id, request, "Notebook not found"
            )

            from_clause = "(select value in from reference where out=$notebook_id)"
            params["notebook_id"] = ensure_record_id(notebook_id)
        else:
            from_clause = "source"

        where_clause, where_params = await source_access_where(request)
        where_parts = [f"({where_clause})"] if where_clause else []
        normalized_query = query.strip().lower() if query else ""
        if normalized_query:
            where_parts.append("string::lowercase(title OR '') CONTAINS $title_query")
            params["title_query"] = normalized_query
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        params.update(where_params)

        # Query sources - include command field with FETCH
        query_sql = f"""
            SELECT id, asset, created, title, updated, topics, command, user_id,
            string::lowercase(title OR '') AS title_sort,
            ({SOURCE_TYPE_EXPRESSION}) AS type,
            (SELECT VALUE count() FROM source_insight WHERE source = $parent.id GROUP ALL)[0].count OR 0 AS insights_count,
            (SELECT VALUE id FROM source_embedding WHERE source = $parent.id LIMIT 1) != [] AS embedded
            FROM {from_clause}
            {where_sql}
            {order_clause}
            LIMIT $limit START $offset
            FETCH command
        """
        result = await repo_query(query_sql, params)

        # Convert result to response model
        # Command data is already fetched via FETCH command clause
        response_list = []
        for row in result:
            command = row.get("command")
            command_id = None
            status = None
            processing_info = None

            # Extract status from fetched command object (already resolved by FETCH)
            if command and isinstance(command, dict):
                command_id = str(command.get("id")) if command.get("id") else None
                status = command.get("status")
                # Extract execution metadata from nested result structure
                result_data = command.get("result")
                execution_metadata = (
                    result_data.get("execution_metadata", {})
                    if isinstance(result_data, dict)
                    else {}
                )
                processing_info = {
                    "started_at": execution_metadata.get("started_at"),
                    "completed_at": execution_metadata.get("completed_at"),
                    "error": _truncate_error(command.get("error_message")),
                }
            elif command:
                # Command exists but FETCH failed to resolve it (broken reference)
                command_id = str(command)
                status = "unknown"

            source_id = str(row["id"])
            summary = await access_summary_for_source(
                row.get("user_id"), source_id, request
            )
            response_list.append(
                SourceListResponse(
                    id=row["id"],
                    title=row.get("title"),
                    topics=row.get("topics") or [],
                    asset=build_public_asset_model(row.get("asset")),
                    embedded=row.get("embedded", False),
                    embedded_chunks=0,  # Not needed in list view
                    insights_count=row.get("insights_count", 0),
                    created=str(row["created"]),
                    updated=str(row["updated"]),
                    # Status fields from fetched command
                    command_id=command_id,
                    status=status,
                    processing_info=build_public_processing_info(processing_info, row.get("asset")),
                    access_role=summary.role if summary else None,
                    access_summary=summary,
                )
            )

        return response_list
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching sources: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching sources")


async def _build_source_list_response(
    row: dict[str, Any], request: Request
) -> SourceListResponse:
    """Convert one SurrealDB row from the library projection into a
    ``SourceListResponse``. Mirrors the loop inside :func:`get_sources` — the
    plan requires reusing that projection and status/access resolution."""
    command = row.get("command")
    command_id: Optional[str] = None
    status = None
    processing_info = None

    if command and isinstance(command, dict):
        command_id = str(command.get("id")) if command.get("id") else None
        status = command.get("status")
        result_data = command.get("result")
        execution_metadata = (
            result_data.get("execution_metadata", {})
            if isinstance(result_data, dict)
            else {}
        )
        processing_info = {
            "started_at": execution_metadata.get("started_at"),
            "completed_at": execution_metadata.get("completed_at"),
            "error": _truncate_error(command.get("error_message")),
        }
    elif command:
        command_id = str(command)
        status = "unknown"

    source_id = str(row["id"])
    summary = await access_summary_for_source(row.get("user_id"), source_id, request)
    return SourceListResponse(
        id=row["id"],
        title=row.get("title"),
        topics=row.get("topics") or [],
        asset=build_public_asset_model(row.get("asset")),
        embedded=row.get("embedded", False),
        embedded_chunks=0,
        insights_count=row.get("insights_count", 0),
        created=str(row["created"]),
        updated=str(row["updated"]),
        command_id=command_id,
        status=status,
        processing_info=build_public_processing_info(processing_info, row.get("asset")),
        access_role=summary.role if summary else None,
        access_summary=summary,
    )


def _source_library_fingerprint(query: str, sort_by: str, sort_order: str) -> str:
    """Fingerprint the request's filters so a cursor from one query can't be
    reused with a different query/sort. Kept minimal — text query + sort keys
    are the only user-controlled filters this route exposes today."""
    return fingerprint_filters(
        {"q": query, "sort_by": sort_by, "sort_order": sort_order}
    )


@router.get("/sources/library", response_model=SourceLibraryPageResponse)
async def get_sources_library(
    request: Request,
    query: Optional[str] = Query(
        None, max_length=200, description="Filter by source title"
    ),
    sort_by: str = Query(
        "updated",
        description=(
            "Field to sort by (type, title, created, updated, insights_count, "
            "or embedded)"
        ),
    ),
    sort_order: str = Query("desc", description="Sort order (asc or desc)"),
    limit: int = Query(
        SOURCE_LIBRARY_DEFAULT_LIMIT,
        ge=1,
        le=SOURCE_LIBRARY_MAX_LIMIT,
        description="Maximum sources to return (1-200)",
    ),
    cursor: Optional[str] = Query(
        None, description="Opaque cursor from a previous page"
    ),
) -> SourceLibraryPageResponse:
    """Keyset-paginated Sources library.

    Returns at most ``limit`` items plus an opaque ``next_cursor`` when
    another page exists. The cursor is version-tagged and fingerprint-bound
    to this request's filters — reusing one with a different query, sort
    field or sort order returns HTTP 400.

    Access predicate and the title text filter are applied *before* the
    keyset predicate, so cursors can never leak inaccessible records.
    """
    if sort_by not in SOURCE_SORT_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=(
                "sort_by must be one of: type, title, created, updated, "
                "insights_count, embedded"
            ),
        )
    if sort_order.lower() not in ("asc", "desc"):
        raise HTTPException(
            status_code=400, detail="sort_order must be 'asc' or 'desc'"
        )
    sort_order_norm = sort_order.lower()

    normalized_query = query.strip().lower() if query else ""
    fp = _source_library_fingerprint(normalized_query, sort_by, sort_order_norm)

    # Validate & decode the cursor before we build any SurrealQL. A bad
    # cursor is a client bug — reject fast with a stable HTTP 400 message.
    cursor_payload: Optional[dict[str, Any]] = None
    if cursor:
        try:
            cursor_payload = decode_cursor(
                cursor,
                allowed_sort_fields=SOURCE_SORT_FIELDS.keys(),
                expected_sort_by=sort_by,
                expected_sort_order=sort_order_norm,
                expected_fp=fp,
            )
        except CursorValidationError:
            raise HTTPException(status_code=400, detail="Invalid cursor")

    # Access + text filters go into WHERE before the keyset predicate.
    where_clause, where_params = await source_access_where(request)
    where_parts: list[str] = []
    params: dict[str, Any] = {}
    if where_clause:
        where_parts.append(f"({where_clause})")
    if normalized_query:
        where_parts.append("string::lowercase(title OR '') CONTAINS $title_query")
        params["title_query"] = normalized_query
    params.update(where_params)

    if cursor_payload is not None:
        sort_expr = SOURCE_LIBRARY_SORT_EXPR[sort_by]
        cmp = ">" if sort_order_norm == "asc" else "<"
        # (value, id) keyset predicate — deterministic when primary values tie.
        where_parts.append(
            f"({sort_expr} {cmp} $cursor_value "
            f"OR ({sort_expr} = $cursor_value AND id {cmp} $cursor_id))"
        )
        params["cursor_value"] = cursor_payload["value"]
        params["cursor_id"] = ensure_record_id(str(cursor_payload["id"]))

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    order_alias = SOURCE_SORT_FIELDS[sort_by]
    direction = sort_order_norm.upper()
    order_clause = (
        f"ORDER BY {order_alias} {direction}, id {direction}"
    )

    # limit + 1 internally — the extra row is our "another page exists" signal
    # and never returned to the caller.
    internal_limit = limit + 1
    params["limit"] = internal_limit

    query_sql = f"""
        SELECT id, asset, created, title, updated, topics, command, user_id,
        string::lowercase(title OR '') AS title_sort,
        ({SOURCE_TYPE_EXPRESSION}) AS type,
        (SELECT VALUE count() FROM source_insight WHERE source = $parent.id GROUP ALL)[0].count OR 0 AS insights_count,
        (SELECT VALUE id FROM source_embedding WHERE source = $parent.id LIMIT 1) != [] AS embedded
        FROM source
        {where_sql}
        {order_clause}
        LIMIT $limit
        FETCH command
    """

    try:
        rows = await repo_query(query_sql, params)
    except OpenNotebookError:
        raise
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Error fetching sources library: {e}")
        raise HTTPException(status_code=500, detail="Error fetching sources")

    has_next = len(rows) > limit
    visible_rows = rows[:limit]
    items = [await _build_source_list_response(row, request) for row in visible_rows]

    next_cursor: Optional[str] = None
    if has_next and visible_rows:
        last = visible_rows[-1]
        cursor_value: Any
        if sort_by == "title":
            cursor_value = last.get("title_sort", "")
        else:
            cursor_value = last.get(sort_by)
        next_cursor = encode_cursor(
            {
                "v": CURSOR_VERSION,
                "sort_by": sort_by,
                "sort_order": sort_order_norm,
                "value": cursor_value,
                "id": str(last["id"]),
                "fp": fp,
            }
        )

    return SourceLibraryPageResponse(items=items, next_cursor=next_cursor)


def _source_to_response(
    source: Source, embedded_chunks: int = 0, **extras: Any
) -> SourceResponse:
    """Build a SourceResponse from a Source, deriving the shared fields.

    Endpoint-specific fields (command_id, status, processing_info, notebooks,
    file_available, ...) are passed as keyword arguments and override the
    derived values.
    """
    fields: dict[str, Any] = {
        "id": source.id or "",
        "title": source.title,
        "topics": source.topics or [],
        "asset": build_public_asset_model(source.asset),
        "full_text": source.full_text,
        "embedded": embedded_chunks > 0,
        "embedded_chunks": embedded_chunks,
        "created": str(source.created),
        "updated": str(source.updated),
    }
    fields.update(extras)
    if "processing_info" in fields:
        fields["processing_info"] = build_public_processing_info(fields["processing_info"], source.asset)
    return SourceResponse(**fields)


async def _cleanup_uploaded_file(stored: Optional[StoredOriginal]) -> None:
    """Compensate a durable save when creating or queueing the source fails."""
    if stored:
        try:
            await get_original_file_store(stored.provider).delete(
                OriginalFileRef(stored.provider, stored.key, stored.etag)
            )
        except Exception:
            logger.warning("Failed to clean up original file after source creation failed")


async def _build_content_state(
    source_data: SourceCreate,
    original_file_action: Optional[str] = None,
    original_filename: Optional[str] = None,
    stored: Optional[StoredOriginal] = None,
) -> dict[str, Any]:
    """Validate the type-specific input and build the content_state passed to
    the processing command. The SSRF and LFI guards live here."""
    content_state: dict[str, Any] = {}

    if source_data.type == "link":
        if not source_data.url:
            raise HTTPException(status_code=400, detail="URL is required for link type")
        # Block SSRF to internal/metadata addresses before the server ever
        # fetches this URL (same guard used for provider-credential URLs).
        try:
            await validate_url(source_data.url, "source")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        content_state["url"] = source_data.url
    elif source_data.type == "upload":
        if stored is not None:
            return {
                **Asset(
                    file_path=stored.file_path,
                    original_file_store=stored.provider,
                    original_file_key=stored.key,
                    original_file_etag=stored.etag,
                    original_filename=original_filename,
                    original_size_bytes=stored.size_bytes,
                    original_file_action=original_file_action,
                ).model_dump(exclude_none=True),
                "delete_source": source_data.delete_source,
            }
        # Legacy JSON file_path remains contained beneath the uploads root.
        final_file_path = source_data.file_path
        if not final_file_path:
            raise HTTPException(
                status_code=400,
                detail="File upload or file_path is required for upload type",
            )
        # Validate file_path is within the uploads directory to prevent LFI
        uploads_resolved = Path(UPLOADS_FOLDER).resolve()
        file_resolved = Path(final_file_path).resolve()
        if not str(file_resolved).startswith(str(uploads_resolved) + os.sep):
            raise HTTPException(
                status_code=400,
                detail="Invalid file path: must be within the uploads directory",
            )
        # Reject unsupported files before enqueueing a doomed background job.
        await _assert_file_supported(final_file_path)
        content_state["file_path"] = final_file_path
        # Deprecated: kept for one release while workers/consumers migrate to
        # ``original_file_action``. The graph MUST NOT delete based on this
        # flag anymore — deletion moves to the successful-command boundary
        # in Task 3.
        content_state["delete_source"] = source_data.delete_source
        # Snapshot the resolved retention action + display metadata so
        # downstream (worker, cleanup APIs) never re-reads the current
        # admin policy for this source — future policy changes never
        # rewrite history.
        if original_file_action is not None:
            content_state["original_file_action"] = original_file_action
        # Prefer the client-provided upload filename; fall back to the
        # basename of the stored path (safe: dirs are stripped).
        content_state["original_filename"] = (
            original_filename or Path(final_file_path).name
        )
        try:
            content_state["original_size_bytes"] = Path(final_file_path).stat().st_size
        except OSError:
            content_state["original_size_bytes"] = None
    elif source_data.type == "text":
        if not source_data.content:
            raise HTTPException(
                status_code=400, detail="Content is required for text type"
            )
        content_state["content"] = source_data.content
    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid source type. Must be link, upload, or text",
        )

    return content_state


async def _create_source_async_path(
    source_data: SourceCreate,
    content_state: dict[str, Any],
    transformation_ids: List[str],
    user: Optional[AuthenticatedUser],
) -> SourceResponse:
    """ASYNC PATH: Create source record first, then queue command."""
    logger.info("Using async processing path")

    # Create source record with asset - let SurrealDB generate the ID
    # Persist asset before save so it's available for retry if processing fails
    if source_data.type == "link":
        source_asset = Asset(url=source_data.url)
    elif source_data.type == "upload":
        source_asset = Asset(**content_state)
    else:
        source_asset = None

    source = Source(
        title=source_data.title or default_source_title(content_state),
        topics=[],
        asset=source_asset,
        user_id=user.id if user else None,
        client_id=user.client_id if user else None,
    )
    await source.save()

    # Add source to notebooks immediately so it appears in the UI
    # The source_graph will skip adding duplicates
    for notebook_id in source_data.notebooks or []:
        await source.add_to_notebook(notebook_id)

    try:
        # Import command modules to ensure they're registered
        import commands.source_commands  # noqa: F401

        # Submit command for background processing
        command_input = SourceProcessingInput(
            source_id=str(source.id),
            content_state=content_state,
            notebook_ids=source_data.notebooks,
            transformations=transformation_ids,
            embed=source_data.embed,
        )

        command_id = await CommandService.submit_command_job(
            "open_notebook",  # app name
            "process_source",  # command name
            command_input.model_dump(),
        )

        logger.info(f"Submitted async processing command: {command_id}")

        # Update source with command reference immediately
        # command_id already includes 'command:' prefix
        source.command = ensure_record_id(command_id)
        await source.save()

        # Return source with command info
        return _source_to_response(
            source,
            asset=None,  # Will be populated after processing
            full_text=None,  # Will be populated after processing
            embedded=False,  # Will be updated after processing
            embedded_chunks=0,
            command_id=command_id,
            status="new",
            processing_info={"async": True, "queued": True},
            access_role="owner" if user else None,
            access_summary=AccessSummary(role="owner", origin="owner")
            if user
            else None,
        )

    except (HTTPException, OpenNotebookError):
        # Clean up source record before the error propagates (typed domain
        # errors are mapped by the global handlers in api/main.py)
        try:
            await source.delete()
        except Exception:
            pass
        raise
    except Exception as e:
        logger.error(f"Failed to submit async processing command: {e}")
        # Clean up source record on command submission failure
        try:
            await source.delete()
        except Exception:
            pass
        # The uploaded file (if any) is cleaned up by create_source's handlers
        raise HTTPException(status_code=500, detail="Failed to queue processing")


async def _create_source_sync_path(
    source_data: SourceCreate,
    content_state: dict[str, Any],
    transformation_ids: List[str],
    user: Optional[AuthenticatedUser],
) -> SourceResponse:
    """SYNC PATH: Execute synchronously using execute_command_sync."""
    logger.info("Using sync processing path")

    try:
        # Import command modules to ensure they're registered
        import commands.source_commands  # noqa: F401

        # Create source record - let SurrealDB generate the ID
        source = Source(
            title=source_data.title or default_source_title(content_state),
            topics=[],
            asset=Asset(**content_state) if source_data.type in {"link", "upload"} else None,
            user_id=user.id if user else None,
            client_id=user.client_id if user else None,
        )
        await source.save()

        # Add source to notebooks immediately so it appears in the UI
        # The source_graph will skip adding duplicates
        for notebook_id in source_data.notebooks or []:
            await source.add_to_notebook(notebook_id)

        # Execute command synchronously
        command_input = SourceProcessingInput(
            source_id=str(source.id),
            content_state=content_state,
            notebook_ids=source_data.notebooks,
            transformations=transformation_ids,
            embed=source_data.embed,
        )

        # Run in thread pool to avoid blocking the event loop
        # execute_command_sync uses asyncio.run() internally which can't
        # be called from an already-running event loop (FastAPI)
        result = await asyncio.to_thread(
            execute_command_sync,
            "open_notebook",  # app name
            "process_source",  # command name
            command_input.model_dump(),
            timeout=300,  # 5 minute timeout for sync processing
        )

        if not result.is_success():
            logger.error(f"Sync processing failed: {result.error_message}")
            # Clean up source record
            try:
                await source.delete()
            except Exception:
                pass
            raise HTTPException(
                status_code=500,
                detail=(
                    "Source processing failed"
                    if content_state.get("original_file_store")
                    else f"Processing failed: {_truncate_error(result.error_message)}"
                ),
            )

        # Get the processed source
        if not source.id:
            raise HTTPException(status_code=500, detail="Source ID is missing")
        processed_source = await Source.get(source.id)
        if not processed_source:
            raise HTTPException(status_code=500, detail="Processed source not found")

        embedded_chunks = await processed_source.get_embedded_chunks()
        # No command_id or status for sync processing (legacy behavior)
        return _source_to_response(
            processed_source,
            embedded_chunks=embedded_chunks,
            access_role="owner" if user else None,
            access_summary=AccessSummary(role="owner", origin="owner")
            if user
            else None,
        )

    except Exception as e:
        logger.error(f"Sync processing failed: {e}")
        # The uploaded file (if any) is cleaned up by create_source's handlers
        raise


@router.post("/sources", response_model=SourceResponse)
async def create_source(
    request: Request,
    form_data: tuple[SourceCreate, Optional[UploadFile]] = Depends(
        parse_source_form_data
    ),
):
    """Create a new source with support for both JSON and multipart form data."""
    source_data, upload_file = form_data
    user = current_user_optional(request)

    stored = None

    try:
        # Verify all specified notebooks exist and are editable by the current
        # user (adding a source requires editor+).
        for notebook_id in source_data.notebooks or []:
            notebook = await Notebook.get(notebook_id)
            if not notebook:
                raise HTTPException(
                    status_code=404, detail=f"Notebook {notebook_id} not found"
                )
            await assert_can_edit_notebook_or_403(
                notebook.user_id, notebook_id, request, f"Notebook {notebook_id} not found"
            )

        # Handle file upload if provided
        if upload_file and source_data.type == "upload":
            try:
                stored = await save_uploaded_file(upload_file)
            except OpenNotebookError:
                raise
            except Exception as e:
                logger.error(f"File upload failed: {e}")
                raise HTTPException(status_code=400, detail="File upload failed")

        # Capture the client-provided filename BEFORE any processing —
        # we snapshot it on the asset so users can see and download the
        # original name later, independent of internal storage paths.
        original_filename: Optional[str] = None
        if source_data.type == "upload":
            if upload_file and upload_file.filename:
                original_filename = Path(upload_file.filename).name
            elif source_data.file_path:
                # Legacy JSON path form — basename only.
                original_filename = Path(source_data.file_path).name

        if source_data.type == "upload" and not source_data.title:
            if original_filename:
                source_data.title = original_filename

        # Resolve the effective retention action once — the snapshot is
        # threaded through content_state and Asset so a later admin
        # policy change never rewrites this source's decision.
        original_file_action: Optional[str] = None
        if source_data.type == "upload":
            from api.source_file_service import resolve_action_for_source_create

            original_file_action = await resolve_action_for_source_create(source_data)

        # Prepare content_state for processing (type validation + SSRF/LFI guards)
        content_state = await _build_content_state(
            source_data,
            original_file_action=original_file_action,
            original_filename=original_filename,
            stored=stored,
        )

        # Validate transformations exist
        transformation_ids = source_data.transformations or []
        for trans_id in transformation_ids:
            transformation = await Transformation.get(trans_id)
            if not transformation:
                raise HTTPException(
                    status_code=404, detail=f"Transformation {trans_id} not found"
                )

        # Branch based on processing mode
        if source_data.async_processing:
            return await _create_source_async_path(
                source_data,
                content_state,
                transformation_ids,
                user,
            )
        return await _create_source_sync_path(
            source_data, content_state, transformation_ids, user
        )

    except HTTPException:
        # Clean up uploaded file on HTTP exceptions if we created it
        await _cleanup_uploaded_file(stored)
        raise
    except InvalidInputError as e:
        # Clean up uploaded file on validation errors if we created it
        await _cleanup_uploaded_file(stored)
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        # Clean up uploaded file before the global handlers map the error
        await _cleanup_uploaded_file(stored)
        raise
    except Exception as e:
        logger.error(f"Error creating source: {str(e)}")
        # Clean up uploaded file on unexpected errors if we created it
        await _cleanup_uploaded_file(stored)
        raise HTTPException(status_code=500, detail="Error creating source")


@router.post("/sources/json", response_model=SourceResponse)
async def create_source_json(source_data: SourceCreate, request: Request):
    """Create a new source using JSON payload (legacy endpoint for backward compatibility)."""
    # Convert to form data format and call main endpoint
    form_data = (source_data, None)
    return await create_source(request, form_data)


async def _resolve_source_file(
    source_id: str, request: Request
) -> tuple[str | OriginalFileRef, str]:
    source = await Source.get(source_id)
    await assert_can_view_source_or_404(
        source.user_id, source_id, request, "Source not found"
    )

    ref = reference_from_asset(source.asset)
    if ref is not None and ref.legacy_file_path is None:
        if not await get_original_file_store(ref.provider).exists(ref):
            raise HTTPException(status_code=404, detail="Original file not found")
        return ref, source.asset.original_filename or "original-file"

    file_path = source.asset.file_path if source.asset else None
    if not file_path:
        raise HTTPException(status_code=404, detail="Source has no file to download")

    safe_root = os.path.realpath(UPLOADS_FOLDER)
    resolved_path = os.path.realpath(file_path)

    if resolved_path != safe_root and not resolved_path.startswith(safe_root + os.sep):
        logger.warning(
            f"Blocked download outside uploads directory for source {source_id}: {resolved_path}"
        )
        raise HTTPException(status_code=403, detail="Access to file denied")

    if not os.path.exists(resolved_path):
        raise HTTPException(status_code=404, detail="File not found on server")

    # Prefer the client-visible original filename over the internal
    # basename so Content-Disposition reflects what the user uploaded,
    # not our storage layout. Legacy rows without the snapshot fall back
    # to the storage basename.
    filename = (
        (source.asset.original_filename if source.asset else None)
        or os.path.basename(resolved_path)
    )
    return resolved_path, filename


def _is_source_file_available(source: Source) -> Optional[bool]:
    if not source or not source.asset or not source.asset.file_path:
        return None

    file_path = source.asset.file_path
    safe_root = os.path.realpath(UPLOADS_FOLDER)
    resolved_path = os.path.realpath(file_path)

    if resolved_path != safe_root and not resolved_path.startswith(safe_root + os.sep):
        return False

    return os.path.exists(resolved_path)


@router.get("/sources/{source_id}", response_model=SourceResponse)
async def get_source(source_id: str, request: Request):
    """Get a specific source by ID."""
    try:
        source = await Source.get(source_id)
        # Single resolver call carries both the authorization decision (404
        # if None) and the origin metadata for the response - see
        # api/ownership.py's access_summary_for_source.
        summary = await access_summary_for_source(
            source.user_id, source_id, request
        )
        if summary is None:
            raise HTTPException(status_code=404, detail="Source not found")

        await _stamp_source_view(source.id or source_id)

        # Get status information if command exists
        status = None
        processing_info = None
        if source.command:
            try:
                status = await source.get_status()
                processing_info = await source.get_processing_progress()
            except Exception as e:
                logger.warning(f"Failed to get status for source {source_id}: {e}")
                status = "unknown"

        embedded_chunks = await source.get_embedded_chunks()

        # Get associated notebooks
        notebooks_query = await repo_query(
            "SELECT VALUE out FROM reference WHERE in = $source_id",
            {"source_id": ensure_record_id(source.id or source_id)},
        )
        notebook_ids = (
            [str(nb_id) for nb_id in notebooks_query] if notebooks_query else []
        )

        ref = reference_from_asset(source.asset)
        file_available = (
            await get_original_file_store(ref.provider).exists(ref)
            if ref is not None and ref.legacy_file_path is None
            else _is_source_file_available(source)
        )
        return _source_to_response(
            source,
            embedded_chunks=embedded_chunks,
            file_available=file_available,
            # Status fields
            command_id=str(source.command) if source.command else None,
            status=status,
            processing_info=processing_info,
            # Notebook associations
            notebooks=notebook_ids,
            access_role=summary.role,
            access_summary=summary,
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching source")


@router.head("/sources/{source_id}/download")
async def check_source_file(source_id: str, request: Request):
    """Check if a source has a downloadable file."""
    try:
        await _resolve_source_file(source_id, request)
        return Response(status_code=200)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error checking file for source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to verify file")


@router.get("/sources/{source_id}/download")
async def download_source_file(source_id: str, request: Request):
    """Download the original file associated with an uploaded source."""
    try:
        resolved_path, filename = await _resolve_source_file(source_id, request)
        if isinstance(resolved_path, OriginalFileRef):
            return StreamingResponse(
                get_original_file_store(resolved_path.provider).iter_bytes(resolved_path),
                media_type="application/octet-stream",
                headers={
                    "Content-Disposition": "attachment; filename*=utf-8''" + quote(filename, safe=""),
                },
            )
        return FileResponse(
            path=resolved_path,
            filename=filename,
            media_type="application/octet-stream",
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error downloading file for source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to download source file")


@router.get("/sources/{source_id}/status", response_model=SourceStatusResponse)
async def get_source_status(source_id: str, request: Request):
    """Get processing status for a source."""
    try:
        # First, verify source exists and is viewable
        source = await Source.get(source_id)
        await assert_can_view_source_or_404(
            source.user_id, source_id, request, "Source not found"
        )

        # Check if this is a legacy source (no command)
        if not source.command:
            return SourceStatusResponse(
                status=None,
                message="Legacy source (completed before async processing)",
                processing_info=None,
                command_id=None,
            )

        # Get command status and processing info
        try:
            status = await source.get_status()
            processing_info = build_public_processing_info(
                await source.get_processing_progress(), source.asset
            )

            # Generate descriptive message based on status
            if status == "completed":
                message = "Source processing completed successfully"
            elif status == "failed":
                # Surface the worker's actual error text when available so the
                # UI shows *why* the source failed, not just that it did. The
                # worker persists str(exc) as processing_info["error"] on the
                # command record; empty when a crash skipped the exception
                # path -- keep the generic message for that edge case.
                err = (
                    processing_info.get("error")
                    if isinstance(processing_info, dict)
                    else None
                )
                message = err or "Source processing failed"
            elif status == "running":
                message = "Source processing in progress"
            elif status == "queued":
                message = "Source processing queued"
            elif status == "unknown":
                message = "Source processing status unknown"
            else:
                message = f"Source processing status: {status}"

            return SourceStatusResponse(
                status=status,
                message=message,
                processing_info=processing_info,
                command_id=str(source.command) if source.command else None,
            )

        except Exception as e:
            logger.warning(f"Failed to get status for source {source_id}: {e}")
            return SourceStatusResponse(
                status="unknown",
                message="Failed to retrieve processing status",
                processing_info=None,
                command_id=str(source.command) if source.command else None,
            )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching status for source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching source status")


@router.put("/sources/{source_id}", response_model=SourceResponse)
async def update_source(source_id: str, source_update: SourceUpdate, request: Request):
    """Update a source."""
    try:
        source = await Source.get(source_id)
        # Single resolver call carries both the authorization decision
        # (404/403) and the origin metadata for the response - mirrors
        # assert_can_edit_source_or_403 exactly (see api/ownership.py).
        summary = await access_summary_for_source(
            source.user_id, source_id, request
        )
        if summary is None:
            raise HTTPException(status_code=404, detail="Source not found")
        if not role_at_least(summary.role, "editor"):
            raise HTTPException(
                status_code=403,
                detail="Editor access is required for this action",
            )

        # Update only provided fields
        if source_update.title is not None:
            source.title = source_update.title
        if source_update.topics is not None:
            source.topics = source_update.topics

        await source.save()

        embedded_chunks = await source.get_embedded_chunks()
        return _source_to_response(
            source,
            embedded_chunks=embedded_chunks,
            access_role=summary.role,
            access_summary=summary,
        )
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error updating source")


@router.post("/sources/{source_id}/retry", response_model=SourceResponse)
async def retry_source_processing(source_id: str, request: Request):
    """Retry processing for a failed or stuck source."""
    try:
        # First, verify source exists and is editable (retry reprocesses content)
        source = await Source.get(source_id)
        # Single resolver call - mirrors assert_can_edit_source_or_403
        # exactly (see api/ownership.py).
        summary = await access_summary_for_source(
            source.user_id, source_id, request
        )
        if summary is None:
            raise HTTPException(status_code=404, detail="Source not found")
        if not role_at_least(summary.role, "editor"):
            raise HTTPException(
                status_code=403,
                detail="Editor access is required for this action",
            )

        # Check if source already has a running command
        if source.command:
            try:
                status = await source.get_status()
                if status in ["running", "queued"]:
                    raise HTTPException(
                        status_code=400,
                        detail="Source is already processing. Cannot retry while processing is active.",
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to check current status for source {source_id}: {e}"
                )
                # Continue with retry if we can't check status

        # Get notebooks that this source belongs to. `reference` is a graph edge
        # (RELATE source->reference->notebook), so it only has `in`/`out` columns —
        # there is no `source`/`notebook` column. Mirror the working query at the
        # source-list path above. See issue #861.
        references = await repo_query(
            "SELECT VALUE out FROM reference WHERE in = $source_id",
            {"source_id": ensure_record_id(source.id or source_id)},
        )
        notebook_ids = [str(nb_id) for nb_id in references] if references else []
        # An empty notebook_ids list is legitimate: sources uploaded directly
        # from the Sources page (WP2b source-level ownership) live outside any
        # notebook. process_source_command accepts notebook_ids=[] just like
        # the create endpoint does, so no rejection needed here.

        # Prepare content_state based on source asset
        content_state = {}
        if source.asset:
            ref = reference_from_asset(source.asset)
            if ref is not None and ref.legacy_file_path is None:
                store = get_original_file_store(ref.provider)
                if not await store.exists(ref):
                    raise HTTPException(status_code=404, detail="Original file not found")
                async with materialize_original_file(store, ref, source.asset.original_filename) as path:
                    await _assert_file_supported(str(path))
                content_state = {
                    **source.asset.model_dump(exclude_none=True, exclude={"file_path"}),
                    "delete_source": False,
                }
            elif source.asset.file_path:
                # Don't re-queue a retry for a file content-core can't extract.
                await _assert_file_supported(source.asset.file_path)
                content_state = {
                    "file_path": source.asset.file_path,
                    "delete_source": False,  # Don't delete on retry
                }
            elif source.asset.url:
                content_state = {"url": source.asset.url}
            else:
                raise HTTPException(
                    status_code=400, detail="Source asset has no file_path or url"
                )
        else:
            # Check if it's a text source by trying to get full_text
            if source.full_text:
                content_state = {"content": source.full_text}
            else:
                raise HTTPException(
                    status_code=400, detail="Cannot determine source content for retry"
                )

        try:
            # Import command modules to ensure they're registered
            import commands.source_commands  # noqa: F401

            # Submit new command for background processing
            command_input = SourceProcessingInput(
                source_id=str(source.id),
                content_state=content_state,
                notebook_ids=notebook_ids,
                transformations=[],  # Use default transformations on retry
                embed=True,  # Always embed on retry
            )

            command_id = await CommandService.submit_command_job(
                "open_notebook",  # app name
                "process_source",  # command name
                command_input.model_dump(),
            )

            logger.info(
                f"Submitted retry processing command: {command_id} for source {source_id}"
            )

            # Update source with new command ID
            # command_id already includes 'command:' prefix
            source.command = ensure_record_id(command_id)
            await source.save()

            # Get current embedded chunks count
            embedded_chunks = await source.get_embedded_chunks()

            # Return updated source response
            return _source_to_response(
                source,
                embedded_chunks=embedded_chunks,
                command_id=command_id,
                status="queued",
                processing_info={"retry": True, "queued": True},
                access_role=summary.role,
                access_summary=summary,
            )

        except Exception as e:
            logger.error(
                f"Failed to submit retry processing command for source {source_id}: {e}"
            )
            raise HTTPException(
                status_code=500, detail="Failed to queue retry processing"
            )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error retrying source processing for {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error retrying source processing")


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, request: Request):
    """Delete a source."""
    try:
        source = await Source.get(source_id)
        await assert_can_view_source_or_404(
            source.user_id, source_id, request, "Source not found"
        )
        assert_can_delete_source_or_403(source.user_id, request)

        await source.delete()

        return {"message": "Source deleted successfully"}
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error deleting source")


@router.get("/sources/{source_id}/insights", response_model=List[SourceInsightResponse])
async def get_source_insights(source_id: str, request: Request):
    """Get all insights for a specific source."""
    try:
        source = await Source.get(source_id)
        await assert_can_view_source_or_404(
            source.user_id, source_id, request, "Source not found"
        )

        insights = await source.get_insights()
        return [
            SourceInsightResponse(
                id=insight.id or "",
                source_id=source_id,
                insight_type=insight.insight_type,
                content=insight.content,
                created=insight.created.isoformat() if insight.created else None,
                updated=insight.updated.isoformat() if insight.updated else None,
            )
            for insight in insights
        ]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching insights for source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching insights")


@router.post(
    "/sources/{source_id}/insights",
    response_model=InsightCreationResponse,
    status_code=202,
)
async def create_source_insight(
    source_id: str, request: CreateSourceInsightRequest, http_request: Request
):
    """
    Start insight generation for a source by running a transformation.

    This endpoint returns immediately with a 202 Accepted status.
    The transformation runs asynchronously in the background via the job queue.
    Poll GET /sources/{source_id}/insights to see when the insight is ready.
    """
    try:
        # Viewer+ may run transforms → insights
        source = await Source.get(source_id)
        await assert_can_view_source_or_404(
            source.user_id, source_id, http_request, "Source not found"
        )

        # Validate transformation exists
        transformation = await Transformation.get(request.transformation_id)
        if not transformation:
            raise HTTPException(status_code=404, detail="Transformation not found")

        # Submit transformation as background job (fire-and-forget)
        command_id = submit_command(
            "open_notebook",
            "run_transformation",
            {
                "source_id": source_id,
                "transformation_id": request.transformation_id,
            },
        )
        logger.info(
            f"Submitted run_transformation command {command_id} for source {source_id}"
        )

        # Return immediately with command_id for status tracking
        return InsightCreationResponse(
            status="pending",
            message="Insight generation started",
            source_id=source_id,
            transformation_id=request.transformation_id,
            command_id=str(command_id),
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error starting insight generation for source {source_id}: {e}")
        raise HTTPException(status_code=500, detail="Error starting insight generation")
