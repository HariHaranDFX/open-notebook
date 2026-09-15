"""Retention-governance HTTP surface.

Four endpoints:

- ``GET /source-files/policy`` — the safe policy summary the upload
  dialog and Source Details need to render controls correctly.
- ``GET /source-files/cleanup-preview`` — count-and-bytes only, per
  scope (mine|all). No filenames, owners, or paths.
- ``POST /source-files/cleanup`` — submit the internal cleanup command.
  Returns a command id for the existing polling infrastructure.
- ``DELETE /sources/{source_id}/original-file`` — single confirmed
  deletion. Admin or an owner permitted by policy.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from loguru import logger
from pydantic import BaseModel

from api.auth.deps import (
    auth_enforces_ownership,
    current_user_optional,
    require_admin,
    require_user,
)
from api.command_service import CommandService
from api.models import AssetModel
from api.source_file_service import build_public_asset_model, delete_original_file
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.notebook import Source
from open_notebook.domain.original_file_policy import OriginalFileDeletionReason

router = APIRouter()


CleanupScope = Literal["mine", "all"]


class SourceFilePolicyResponse(BaseModel):
    original_file_policy: Literal["always_keep", "user_choice", "always_delete"]
    original_file_user_default: Literal["keep", "delete_after_processing"]
    allow_source_owner_cleanup: bool
    # Convenience flags the UI needs without re-deriving them.
    owner_can_cleanup_own: bool
    is_admin: bool


class CleanupPreviewResponse(BaseModel):
    scope: CleanupScope
    eligible_count: int
    eligible_bytes: int


class CleanupSubmitRequest(BaseModel):
    scope: CleanupScope


class CleanupSubmitResponse(BaseModel):
    job_id: str
    scope: CleanupScope
    eligible_count: int


async def _load_settings() -> ContentSettings:
    # ContentSettings.get_instance is typed as returning the RecordModel
    # base — narrow via cast so the retention fields are visible.
    from typing import cast

    return cast(ContentSettings, await ContentSettings.get_instance())


async def _query_eligible_sources(
    scope: CleanupScope,
    user_id: Optional[str],
) -> list[dict]:
    """Return the id/user_id/asset rows eligible for cleanup, in one query.

    Eligibility:
    - source's asset has ``original_file_action = 'delete_after_processing'``
    - ``file_path`` is still present (not already deleted)
    - ``full_text`` is not None (processing completed)
    - scope filter: ``mine`` narrows to the requester's own sources.
    """
    where_parts = [
        "asset.original_file_action = 'delete_after_processing'",
        "asset.file_path != NONE",
        "full_text != NONE",
    ]
    binds: dict = {}
    if scope == "mine" and user_id is not None:
        where_parts.append("user_id = $uid")
        binds["uid"] = ensure_record_id(user_id)
    where_sql = " AND ".join(where_parts)
    rows = await repo_query(
        f"SELECT id, user_id, asset.original_size_bytes AS size FROM source WHERE {where_sql}",
        binds,
    )
    return rows or []


@router.get("/source-files/policy", response_model=SourceFilePolicyResponse)
async def get_source_file_policy(request: Request) -> SourceFilePolicyResponse:
    """Safe policy summary for the current user.

    Signed-out callers with ownership enforcement off are treated as
    unrestricted (owner of everything) — matches the rest of the API's
    dev-mode posture.
    """
    settings = await _load_settings()
    user = current_user_optional(request)
    is_admin = False
    if user is not None:
        try:
            require_admin(request)
            is_admin = True
        except HTTPException:
            is_admin = False
    elif not auth_enforces_ownership():
        # Ownership off — treat as admin locally.
        is_admin = True

    return SourceFilePolicyResponse(
        original_file_policy=settings.original_file_policy,
        original_file_user_default=settings.original_file_user_default,
        allow_source_owner_cleanup=settings.allow_source_owner_cleanup,
        owner_can_cleanup_own=settings.allow_source_owner_cleanup,
        is_admin=is_admin,
    )


@router.get("/source-files/cleanup-preview", response_model=CleanupPreviewResponse)
async def get_cleanup_preview(
    request: Request,
    scope: CleanupScope = Query("mine"),
) -> CleanupPreviewResponse:
    """Count-only preview. No titles / filenames / owners / paths."""
    settings = await _load_settings()
    user = current_user_optional(request)

    if scope == "all":
        # scope=all is admin-only, always.
        require_admin(request)
    else:
        # scope=mine requires an authenticated user AND owner cleanup enabled.
        if user is None and auth_enforces_ownership():
            require_user(request)  # raises
        if not settings.allow_source_owner_cleanup and (
            user is None or not _user_is_admin_silent(request)
        ):
            # Not allowed to preview own cleanup when the policy disables it.
            return CleanupPreviewResponse(
                scope=scope, eligible_count=0, eligible_bytes=0
            )

    rows = await _query_eligible_sources(scope, user.id if user else None)
    total_bytes = sum(int(r.get("size") or 0) for r in rows)
    return CleanupPreviewResponse(
        scope=scope, eligible_count=len(rows), eligible_bytes=total_bytes
    )


def _user_is_admin_silent(request: Request) -> bool:
    try:
        require_admin(request)
        return True
    except HTTPException:
        return False


@router.post("/source-files/cleanup", response_model=CleanupSubmitResponse)
async def submit_cleanup(
    request: Request, body: CleanupSubmitRequest
) -> CleanupSubmitResponse:
    """Submit the internal cleanup command. Returns a job id for polling."""
    settings = await _load_settings()
    user = current_user_optional(request)

    is_admin = False
    if body.scope == "all":
        require_admin(request)
        is_admin = True
    else:
        if user is None and auth_enforces_ownership():
            require_user(request)
        if not settings.allow_source_owner_cleanup:
            raise HTTPException(
                status_code=403,
                detail="Source owner cleanup is disabled by the administrator.",
            )
        is_admin = _user_is_admin_silent(request)

    rows = await _query_eligible_sources(body.scope, user.id if user else None)
    candidate_ids = [str(r["id"]) for r in rows]

    from commands import source_file_commands  # noqa: F401 - register the command

    input_data = {
        "scope": body.scope,
        "requesting_user_id": user.id if user else None,
        "is_admin": is_admin,
        "candidate_source_ids": candidate_ids,
    }
    try:
        job_id = await CommandService.submit_command_job(
            module_name="open_notebook",
            command_name="cleanup_original_files",
            command_args=input_data,
        )
    except Exception as e:
        logger.error(f"Failed to submit cleanup command: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit cleanup")

    return CleanupSubmitResponse(
        job_id=job_id, scope=body.scope, eligible_count=len(candidate_ids)
    )


class SingleDeleteResponse(BaseModel):
    outcome: str
    asset: Optional[AssetModel] = None


@router.delete(
    "/sources/{source_id}/original-file", response_model=SingleDeleteResponse
)
async def delete_source_original_file(
    source_id: str, request: Request
) -> SingleDeleteResponse:
    """Delete the retained original file for one source.

    Authorized when the caller is an administrator OR the source's
    owner AND admin has enabled owner-cleanup. Extracted content /
    insights / notebook links are preserved.
    """
    try:
        source = await Source.get(source_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Source not found")
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    settings = await _load_settings()
    is_admin = _user_is_admin_silent(request)
    user = current_user_optional(request)
    reason: OriginalFileDeletionReason
    if not is_admin:
        # Not admin — must be owner AND owner cleanup enabled.
        if user is None or source.user_id != user.id:
            # Match the ownership convention of concealing inaccessible
            # resources: 404 rather than 403 discloses less about existence.
            raise HTTPException(status_code=404, detail="Source not found")
        if not settings.allow_source_owner_cleanup:
            raise HTTPException(
                status_code=403,
                detail="Source owner cleanup is disabled by the administrator.",
            )
        reason = "source_owner"
    else:
        reason = "admin_cleanup"

    outcome = await delete_original_file(source, reason=reason)
    # Reload for the fresh asset snapshot.
    updated = await Source.get(source_id)
    return SingleDeleteResponse(
        outcome=outcome,
        asset=build_public_asset_model(updated.asset) if updated else None,
    )
