from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from loguru import logger

from api.auth.deps import current_user_optional
from api.models import (
    AccessSummary,
    NotebookCreate,
    NotebookDeletePreview,
    NotebookDeleteResponse,
    NotebookLibraryPageResponse,
    NotebookResponse,
    NotebookUpdate,
    RecentlyViewedResponse,
)
from api.ownership import (
    access_summary_for_notebook,
    access_where,
    assert_can_edit_notebook_or_403,
    assert_owner_or_404,
    source_access_where,
)
from api.pagination import (
    CURSOR_VERSION,
    CursorValidationError,
    decode_cursor,
    encode_cursor,
    fingerprint_filters,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import (
    InvalidInputError,
    NotFoundError,
    OpenNotebookError,
)

# Sort aliases used in the ORDER BY clause. `name` sorts case-insensitively
# via a computed alias, mirroring the sources library route's `title_sort`.
NOTEBOOK_SORT_FIELDS = {
    "name": "name_sort",
    "created": "created",
    "updated": "updated",
}

# Sort expressions inlined into the WHERE keyset predicate for each sort key.
# ORDER BY may reference the SELECT alias; WHERE cannot, so it inlines the
# same expression that produced the alias.
NOTEBOOK_LIBRARY_SORT_EXPR = {
    "name": "string::lowercase(name OR '')",
    "created": "created",
    "updated": "updated",
}

NOTEBOOK_LIBRARY_DEFAULT_LIMIT = 30
NOTEBOOK_LIBRARY_MAX_LIMIT = 200

router = APIRouter()


def _last_viewed_sort_key(item: RecentlyViewedResponse) -> str:
    return item.last_viewed_at


async def _stamp_notebook_view(notebook_id: str) -> None:
    # Best-effort write-on-read: recording the view timestamp must never turn a
    # successful read into a 500. Log and move on if the stamp update fails.
    try:
        await repo_query(
            "UPDATE $notebook_id SET last_viewed_at = time::now();",
            {"notebook_id": ensure_record_id(notebook_id)},
        )
    except Exception as e:
        logger.warning(
            f"Failed to stamp last_viewed_at for notebook {notebook_id}: {e}"
        )


def _recently_viewed_notebook(row: dict) -> RecentlyViewedResponse:
    return RecentlyViewedResponse(
        type="notebook",
        id=str(row.get("id", "")),
        title=row.get("title") or row.get("name") or "Untitled notebook",
        last_viewed_at=str(row.get("last_viewed_at", "")),
    )


def _recently_viewed_source(row: dict) -> RecentlyViewedResponse:
    return RecentlyViewedResponse(
        type="source",
        id=str(row.get("id", "")),
        title=row.get("title") or "Untitled source",
        last_viewed_at=str(row.get("last_viewed_at", "")),
    )


@router.get("/notebooks", response_model=List[NotebookResponse])
async def get_notebooks(
    request: Request,
    archived: Optional[bool] = Query(None, description="Filter by archived status"),
    order_by: str = Query("updated desc", description="Order by field and direction"),
):
    """Get all notebooks with optional filtering and ordering."""
    try:
        # Validate order_by against allowlist to prevent SurrealQL injection
        allowed_fields = {"name", "created", "updated"}
        allowed_directions = {"asc", "desc"}

        parts = order_by.strip().lower().split()
        if len(parts) == 1:
            if parts[0] not in allowed_fields:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid order_by field: '{order_by}'. Allowed fields: {', '.join(sorted(allowed_fields))}",
                )
            validated_order_by = parts[0]
        elif len(parts) == 2:
            if parts[0] not in allowed_fields or parts[1] not in allowed_directions:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid order_by: '{order_by}'. Allowed fields: {', '.join(sorted(allowed_fields))}. Allowed directions: asc, desc",
                )
            validated_order_by = f"{parts[0]} {parts[1]}"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid order_by format: '{order_by}'. Expected 'field' or 'field direction'",
            )

        # Build the query with counts
        where_clause, where_params = await access_where(request, "notebook")
        where_sql = f"WHERE {where_clause}" if where_clause else ""
        query = f"""
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM notebook
            {where_sql}
            ORDER BY {validated_order_by}
        """

        result = await repo_query(query, where_params)

        # Filter by archived status if specified
        if archived is not None:
            result = [nb for nb in result if nb.get("archived") == archived]

        responses = []
        for nb in result:
            nb_id = str(nb.get("id", ""))
            summary = await access_summary_for_notebook(
                nb.get("user_id"), nb_id, request
            )
            responses.append(
                NotebookResponse(
                    id=nb_id,
                    name=nb.get("name", ""),
                    description=nb.get("description", ""),
                    archived=nb.get("archived", False),
                    created=str(nb.get("created", "")),
                    updated=str(nb.get("updated", "")),
                    source_count=nb.get("source_count", 0),
                    note_count=nb.get("note_count", 0),
                    access_role=summary.role if summary else None,
                    access_summary=summary,
                )
            )
        return responses
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching notebooks: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebooks: {str(e)}"
        )


def _notebook_library_fingerprint(
    archived: bool, query: str, sort_by: str, sort_order: str
) -> str:
    """Fingerprint the request's filters so a cursor from one query cannot be
    reused with a different filter set. Includes ``archived`` and the
    normalized name query — the two things a cursor is bound to."""
    return fingerprint_filters(
        {
            "archived": archived,
            "q": query,
            "sort_by": sort_by,
            "sort_order": sort_order,
        }
    )


def _notebook_library_row(row: dict[str, Any], summary) -> NotebookResponse:
    return NotebookResponse(
        id=str(row.get("id", "")),
        name=row.get("name", ""),
        description=row.get("description", ""),
        archived=row.get("archived", False),
        created=str(row.get("created", "")),
        updated=str(row.get("updated", "")),
        source_count=row.get("source_count", 0),
        note_count=row.get("note_count", 0),
        access_role=summary.role if summary else None,
        access_summary=summary,
    )


@router.get("/notebooks/library", response_model=NotebookLibraryPageResponse)
async def get_notebooks_library(
    request: Request,
    archived: bool = Query(..., description="Filter by archived status"),
    query: Optional[str] = Query(
        None, max_length=200, description="Filter by notebook name"
    ),
    sort_by: str = Query(
        "updated",
        description="Field to sort by (name, created, or updated)",
    ),
    sort_order: str = Query("desc", description="Sort order (asc or desc)"),
    limit: int = Query(
        NOTEBOOK_LIBRARY_DEFAULT_LIMIT,
        ge=1,
        le=NOTEBOOK_LIBRARY_MAX_LIMIT,
        description="Maximum notebooks to return (1-200)",
    ),
    cursor: Optional[str] = Query(
        None, description="Opaque cursor from a previous page"
    ),
) -> NotebookLibraryPageResponse:
    """Keyset-paginated Notebooks library.

    Returns at most ``limit`` items plus an opaque ``next_cursor`` when
    another page exists. The cursor is version-tagged and fingerprint-bound
    to this request's filters — reusing one with a different archived flag,
    query, sort field or sort order returns HTTP 400.

    Access predicate, archived filter and the name text filter are applied
    in SurrealQL *before* the keyset predicate, so cursors can never leak
    inaccessible records and page boundaries always stay within the
    requested (active or archived) set.
    """
    if sort_by not in NOTEBOOK_SORT_FIELDS:
        raise HTTPException(
            status_code=400,
            detail="sort_by must be one of: name, created, updated",
        )
    if sort_order.lower() not in ("asc", "desc"):
        raise HTTPException(
            status_code=400, detail="sort_order must be 'asc' or 'desc'"
        )
    sort_order_norm = sort_order.lower()

    normalized_query = query.strip().lower() if query else ""
    fp = _notebook_library_fingerprint(
        archived, normalized_query, sort_by, sort_order_norm
    )

    cursor_payload: Optional[dict[str, Any]] = None
    if cursor:
        try:
            cursor_payload = decode_cursor(
                cursor,
                allowed_sort_fields=NOTEBOOK_SORT_FIELDS.keys(),
                expected_sort_by=sort_by,
                expected_sort_order=sort_order_norm,
                expected_fp=fp,
            )
        except CursorValidationError:
            raise HTTPException(status_code=400, detail="Invalid cursor")

    # Access + archived + name filters go into WHERE before the keyset predicate.
    where_clause, where_params = await access_where(request, "notebook")
    where_parts: list[str] = []
    params: dict[str, Any] = {}
    if where_clause:
        where_parts.append(f"({where_clause})")
    where_parts.append("archived = $archived")
    params["archived"] = archived
    if normalized_query:
        where_parts.append("string::lowercase(name OR '') CONTAINS $name_query")
        params["name_query"] = normalized_query
    params.update(where_params)

    if cursor_payload is not None:
        sort_expr = NOTEBOOK_LIBRARY_SORT_EXPR[sort_by]
        cmp = ">" if sort_order_norm == "asc" else "<"
        where_parts.append(
            f"({sort_expr} {cmp} $cursor_value "
            f"OR ({sort_expr} = $cursor_value AND id {cmp} $cursor_id))"
        )
        params["cursor_value"] = cursor_payload["value"]
        params["cursor_id"] = ensure_record_id(str(cursor_payload["id"]))

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    order_alias = NOTEBOOK_SORT_FIELDS[sort_by]
    direction = sort_order_norm.upper()
    order_clause = f"ORDER BY {order_alias} {direction}, id {direction}"

    internal_limit = limit + 1
    params["limit"] = internal_limit

    query_sql = f"""
        SELECT id, name, description, archived, created, updated, user_id,
        string::lowercase(name OR '') AS name_sort,
        count(<-reference.in) as source_count,
        count(<-artifact.in) as note_count
        FROM notebook
        {where_sql}
        {order_clause}
        LIMIT $limit
    """

    try:
        rows = await repo_query(query_sql, params)
    except OpenNotebookError:
        raise
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Error fetching notebooks library: {e}")
        raise HTTPException(status_code=500, detail="Error fetching notebooks")

    has_next = len(rows) > limit
    visible_rows = rows[:limit]

    items: list[NotebookResponse] = []
    for row in visible_rows:
        nb_id = str(row.get("id", ""))
        summary = await access_summary_for_notebook(
            row.get("user_id"), nb_id, request
        )
        items.append(_notebook_library_row(row, summary))

    next_cursor: Optional[str] = None
    if has_next and visible_rows:
        last = visible_rows[-1]
        cursor_value: Any
        if sort_by == "name":
            cursor_value = last.get("name_sort", "")
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

    return NotebookLibraryPageResponse(items=items, next_cursor=next_cursor)


@router.post("/notebooks", response_model=NotebookResponse)
async def create_notebook(notebook: NotebookCreate, request: Request):
    """Create a new notebook."""
    try:
        user = current_user_optional(request)
        new_notebook = Notebook(
            name=notebook.name,
            description=notebook.description,
            user_id=user.id if user else None,
            client_id=user.client_id if user else None,
        )
        await new_notebook.save()

        return NotebookResponse(
            id=new_notebook.id or "",
            name=new_notebook.name,
            description=new_notebook.description,
            archived=new_notebook.archived or False,
            created=str(new_notebook.created),
            updated=str(new_notebook.updated),
            source_count=0,  # New notebook has no sources
            note_count=0,  # New notebook has no notes
            access_role="owner" if user else None,
            access_summary=AccessSummary(role="owner", origin="owner")
            if user
            else None,
        )
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating notebook: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating notebook: {str(e)}"
        )


@router.get("/recently-viewed", response_model=List[RecentlyViewedResponse])
async def get_recently_viewed(
    request: Request,
    limit: int = Query(12, ge=1, le=50, description="Number of items to return"),
):
    """Get recently viewed notebooks and sources, newest first."""
    try:
        nb_clause, nb_params = await access_where(request, "notebook")
        src_clause, src_params = await source_access_where(request)
        nb_sql = f" AND {nb_clause}" if nb_clause else ""
        src_sql = f" AND {src_clause}" if src_clause else ""
        notebooks = await repo_query(
            f"""
            SELECT id, name AS title, last_viewed_at
            FROM notebook
            WHERE last_viewed_at != NONE AND last_viewed_at != NULL{nb_sql}
            ORDER BY last_viewed_at DESC
            LIMIT $limit
            """,
            {"limit": limit, **nb_params},
        )
        sources = await repo_query(
            f"""
            SELECT id, title, last_viewed_at
            FROM source
            WHERE last_viewed_at != NONE AND last_viewed_at != NULL{src_sql}
            ORDER BY last_viewed_at DESC
            LIMIT $limit
            """,
            {"limit": limit, **src_params},
        )

        items = [
            *[_recently_viewed_notebook(nb) for nb in notebooks],
            *[_recently_viewed_source(src) for src in sources],
        ]
        items.sort(key=_last_viewed_sort_key, reverse=True)
        return items[:limit]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        # Log full context server-side; return a generic message so internal
        # details are not leaked to clients.
        logger.exception(f"Error fetching recently viewed items: {e}")
        raise HTTPException(
            status_code=500, detail="Error fetching recently viewed items"
        )


@router.get(
    "/notebooks/{notebook_id}/delete-preview", response_model=NotebookDeletePreview
)
async def get_notebook_delete_preview(notebook_id: str, request: Request):
    """Get a preview of what will be deleted when this notebook is deleted."""
    try:
        notebook = await Notebook.get(notebook_id)
        # Delete preview / delete are owner-only
        assert_owner_or_404(notebook.user_id, request, "Notebook not found")

        preview = await notebook.get_delete_preview()

        return NotebookDeletePreview(
            notebook_id=str(notebook.id),
            notebook_name=notebook.name,
            note_count=preview["note_count"],
            exclusive_source_count=preview["exclusive_source_count"],
            shared_source_count=preview["shared_source_count"],
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error getting delete preview for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching notebook deletion preview: {str(e)}",
        )


@router.get("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def get_notebook(notebook_id: str, request: Request):
    """Get a specific notebook by ID."""
    try:
        # Query with counts for single notebook
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if not result:
            raise HTTPException(status_code=404, detail="Notebook not found")

        nb = result[0]
        # Single resolver call carries both the authorization decision (404
        # if None) and the origin metadata for the response - see
        # api/ownership.py's access_summary_for_notebook.
        summary = await access_summary_for_notebook(
            nb.get("user_id"), notebook_id, request
        )
        if summary is None:
            raise HTTPException(status_code=404, detail="Notebook not found")

        await _stamp_notebook_view(notebook_id)
        return NotebookResponse(
            id=str(nb.get("id", "")),
            name=nb.get("name", ""),
            description=nb.get("description", ""),
            archived=nb.get("archived", False),
            created=str(nb.get("created", "")),
            updated=str(nb.get("updated", "")),
            source_count=nb.get("source_count", 0),
            note_count=nb.get("note_count", 0),
            access_role=summary.role,
            access_summary=summary,
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebook: {str(e)}"
        )


@router.put("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(
    notebook_id: str, notebook_update: NotebookUpdate, request: Request
):
    """Update a notebook."""
    try:
        notebook = await Notebook.get(notebook_id)
        await assert_can_edit_notebook_or_403(
            notebook.user_id, notebook_id, request, "Notebook not found"
        )

        # Update only provided fields
        if notebook_update.name is not None:
            notebook.name = notebook_update.name
        if notebook_update.description is not None:
            notebook.description = notebook_update.description
        if notebook_update.archived is not None:
            notebook.archived = notebook_update.archived

        await notebook.save()

        # Query with counts after update
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if result:
            nb = result[0]
            return NotebookResponse(
                id=str(nb.get("id", "")),
                name=nb.get("name", ""),
                description=nb.get("description", ""),
                archived=nb.get("archived", False),
                created=str(nb.get("created", "")),
                updated=str(nb.get("updated", "")),
                source_count=nb.get("source_count", 0),
                note_count=nb.get("note_count", 0),
            )

        # Fallback if query fails
        return NotebookResponse(
            id=notebook.id or "",
            name=notebook.name,
            description=notebook.description,
            archived=notebook.archived or False,
            created=str(notebook.created),
            updated=str(notebook.updated),
            source_count=0,
            note_count=0,
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating notebook: {str(e)}"
        )


@router.post("/notebooks/{notebook_id}/sources/{source_id}")
async def add_source_to_notebook(notebook_id: str, source_id: str, request: Request):
    """Add an existing source to a notebook (create the reference)."""
    try:
        # Editors may link sources into a notebook they can edit.
        notebook = await Notebook.get(notebook_id)
        await assert_can_edit_notebook_or_403(
            notebook.user_id, notebook_id, request, "Notebook not found"
        )
        source = await Source.get(source_id)
        from api.ownership import assert_can_view_source_or_404

        await assert_can_view_source_or_404(
            source.user_id, source_id, request, "Source not found"
        )

        # Check if reference already exists (idempotency)
        existing_ref = await repo_query(
            "SELECT * FROM reference WHERE out = $source_id AND in = $notebook_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        # If reference doesn't exist, create it
        if not existing_ref:
            await repo_query(
                "RELATE $source_id->reference->$notebook_id",
                {
                    "notebook_id": ensure_record_id(notebook_id),
                    "source_id": ensure_record_id(source_id),
                },
            )

        return {"message": "Source linked to notebook successfully"}
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook or source not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(
            f"Error linking source {source_id} to notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error linking source to notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}/sources/{source_id}")
async def remove_source_from_notebook(
    notebook_id: str, source_id: str, request: Request
):
    """Remove a source from a notebook (delete the reference)."""
    try:
        notebook = await Notebook.get(notebook_id)
        await assert_can_edit_notebook_or_403(
            notebook.user_id, notebook_id, request, "Notebook not found"
        )

        # Delete the reference record linking source to notebook
        await repo_query(
            "DELETE FROM reference WHERE out = $notebook_id AND in = $source_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        return {"message": "Source removed from notebook successfully"}
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(
            f"Error removing source {source_id} from notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error removing source from notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}", response_model=NotebookDeleteResponse)
async def delete_notebook(
    notebook_id: str,
    request: Request,
    delete_exclusive_sources: bool = Query(
        False,
        description="Whether to delete sources that belong only to this notebook",
    ),
):
    """
    Delete a notebook with cascade deletion.

    Always deletes all notes associated with the notebook.
    If delete_exclusive_sources is True, also deletes sources that belong only
    to this notebook (not linked to any other notebooks).
    """
    try:
        notebook = await Notebook.get(notebook_id)
        assert_owner_or_404(notebook.user_id, request, "Notebook not found")

        result = await notebook.delete(
            delete_exclusive_sources=delete_exclusive_sources
        )

        return NotebookDeleteResponse(
            message="Notebook deleted successfully",
            deleted_notes=result["deleted_notes"],
            deleted_sources=result["deleted_sources"],
            unlinked_sources=result["unlinked_sources"],
            deleted_chat_sessions=result["deleted_chat_sessions"],
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting notebook: {str(e)}"
        )
