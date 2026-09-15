from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel

from api.auth.deps import auth_enforces_ownership, current_user_optional
from api.models import EpisodeSummaryResponse
from api.ownership import (
    AccessRole,
    assert_can_edit_notebook_or_403,
    canonical_id,
    effective_role_for_episode,
    episode_access_where,
    filter_episodes_by_access,
)
from api.pagination import (
    CURSOR_VERSION,
    CursorValidationError,
    decode_cursor,
    encode_cursor,
    fingerprint_filters,
)
from api.podcast_service import (
    EPISODE_LIBRARY_SORT_FIELDS,
    PodcastGenerationRequest,
    PodcastGenerationResponse,
    PodcastService,
)
from open_notebook.ai.models import Model
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import OpenNotebookError
from open_notebook.podcasts.audio_paths import resolve_contained_audio_path
from open_notebook.podcasts.models import PodcastEpisode

router = APIRouter()

# Model reference fields stored in the denormalized profile snapshots on an
# episode, mapped to the resolved display fields the frontend renders
# ("provider / name" rows in EpisodeCard). Mirrors the speaker_config ->
# speaker_config_name precedent in api/routers/episode_profiles.py.
_EPISODE_PROFILE_MODEL_FIELDS = {
    "outline_llm": ("outline_model_provider", "outline_model_name"),
    "transcript_llm": ("transcript_model_provider", "transcript_model_name"),
}
_SPEAKER_PROFILE_MODEL_FIELDS = {
    "voice_model": ("voice_model_provider", "voice_model_name"),
}


def _collect_snapshot_model_ids(episodes: List[PodcastEpisode]) -> List[str]:
    """Collect the distinct model record IDs referenced by episode snapshots."""
    ids = set()
    for episode in episodes:
        for field in _EPISODE_PROFILE_MODEL_FIELDS:
            ref = (episode.episode_profile or {}).get(field)
            if ref:
                ids.add(str(ref))
        for field in _SPEAKER_PROFILE_MODEL_FIELDS:
            ref = (episode.speaker_profile or {}).get(field)
            if ref:
                ids.add(str(ref))
    return sorted(ids)


def _with_resolved_model_fields(
    snapshot: dict,
    field_map: dict,
    models_by_id: dict,
) -> dict:
    """Return a copy of a profile snapshot with resolved model display fields.

    Only sets the display fields when the reference resolves; unresolvable
    references (deleted model) and legacy snapshots without references are
    left untouched so the frontend can fall back to the historical
    provider/model strings, then to a placeholder.
    """
    enriched = dict(snapshot or {})
    for ref_field, (provider_field, name_field) in field_map.items():
        ref = enriched.get(ref_field)
        info = models_by_id.get(str(ref)) if ref else None
        if info:
            enriched[provider_field] = info["provider"]
            enriched[name_field] = info["name"]
    return enriched


async def _resolve_snapshot_models(
    episodes: List[PodcastEpisode],
) -> dict:
    """Batch-resolve every model reference in the episodes' snapshots.

    One query for the whole list (see Model.get_display_info_for_ids) - a
    failure degrades to no resolved fields rather than failing the request.
    """
    try:
        return await Model.get_display_info_for_ids(
            _collect_snapshot_model_ids(episodes)
        )
    except Exception as e:
        logger.warning(f"Error batch-resolving snapshot model references: {str(e)}")
        return {}


async def _assert_episode_view_or_404(episode: PodcastEpisode, request: Request) -> None:
    """Play/get: episode owner OR notebook viewer+."""
    kept = await filter_episodes_by_access([episode], request)
    if not kept:
        raise HTTPException(status_code=404, detail="Episode not found")


async def _assert_episode_edit_or_403(episode: PodcastEpisode, request: Request) -> None:
    """Delete/retry: episode owner OR notebook editor+."""
    if not auth_enforces_ownership():
        return
    user = current_user_optional(request)
    if user is None:
        return
    if episode.user_id and canonical_id(str(episode.user_id)) == canonical_id(user.id):
        return
    nb_id = getattr(episode, "notebook_id", None)
    if not nb_id:
        raise HTTPException(status_code=404, detail="Episode not found")
    rows = await repo_query(
        "SELECT user_id FROM notebook WHERE id = $id",
        {"id": ensure_record_id(str(nb_id))},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Episode not found")
    await assert_can_edit_notebook_or_403(
        rows[0].get("user_id"), str(nb_id), request, "Episode not found"
    )


def _delete_episode_audio(episode: PodcastEpisode, episode_id: str) -> None:
    """Best-effort unlink of an episode's audio file, refusing invalid paths.

    Shared by the delete and retry endpoints. Legacy/escaping audio_file
    values (resolve_contained_audio_path -> None) are logged and skipped.
    """
    if not episode.audio_file:
        return
    audio_path = resolve_contained_audio_path(episode.audio_file)
    if audio_path is None:
        logger.warning(
            f"Refusing to delete audio file outside podcasts directory "
            f"for episode {episode_id}: {episode.audio_file}"
        )
    elif audio_path.exists():
        try:
            audio_path.unlink()
            logger.info(f"Deleted audio file: {audio_path}")
        except Exception as e:
            logger.warning(f"Failed to delete audio file {audio_path}: {e}")


class PodcastEpisodeResponse(BaseModel):
    id: str
    name: str
    episode_profile: dict
    speaker_profile: dict
    briefing: str
    audio_file: Optional[str] = None
    audio_url: Optional[str] = None
    transcript: Optional[dict] = None
    outline: Optional[dict] = None
    created: Optional[str] = None
    job_status: Optional[str] = None
    error_message: Optional[str] = None
    access_role: Optional[AccessRole] = None


class EpisodeLibraryPageResponse(BaseModel):
    """One page of the Podcast Episodes library — keyset paginated.

    ``next_cursor`` is an opaque, backend-issued token; callers echo it
    back unchanged to fetch the next page. It is ``None`` when no further
    page exists. See ``api/pagination.py``.
    """

    items: List[PodcastEpisodeResponse]
    next_cursor: Optional[str] = None


EPISODE_LIBRARY_DEFAULT_LIMIT = 30
EPISODE_LIBRARY_MAX_LIMIT = 200


def _episode_library_fingerprint(
    query: str, sort_by: str, sort_order: str
) -> str:
    """Bind a cursor to (normalized_query, sort_by, sort_order).

    Any change here invalidates every issued cursor — a HTTP 400, not a
    silently misordered next page. Mirrors the sources/notebooks pattern.
    """
    return fingerprint_filters(
        {"q": query, "sort_by": sort_by, "sort_order": sort_order}
    )


async def _episode_row_to_response(
    row: dict,
    *,
    details_by_command: dict,
    models_by_id: dict,
    request: Request,
) -> PodcastEpisodeResponse:
    """Build one episode response from a keyset library row.

    Applies the same status/model-resolution + audio_url derivation the
    complete-list route uses so the library payload matches shape-for-shape.
    """
    command = row.get("command")
    audio_file = row.get("audio_file")

    if command:
        detail = details_by_command.get(str(command))
        if detail is not None:
            job_status = detail["status"]
            error_message = detail["error_message"]
        else:
            job_status = "unknown"
            error_message = None
    else:
        job_status = "completed"
        error_message = None

    audio_url = None
    audio_path = resolve_contained_audio_path(audio_file)
    if audio_path is not None and audio_path.exists():
        audio_url = f"/api/podcasts/episodes/{row['id']}/audio"

    # We need a lightweight episode-shaped object for effective_role_for_episode;
    # constructing a full PodcastEpisode would fail validation on partial rows.
    class _EpisodeLike:
        pass

    ep_like = _EpisodeLike()
    ep_like.user_id = row.get("user_id")
    ep_like.notebook_id = row.get("notebook_id")

    return PodcastEpisodeResponse(
        id=str(row["id"]),
        name=row.get("name") or "",
        episode_profile=_with_resolved_model_fields(
            row.get("episode_profile") or {},
            _EPISODE_PROFILE_MODEL_FIELDS,
            models_by_id,
        ),
        speaker_profile=_with_resolved_model_fields(
            row.get("speaker_profile") or {},
            _SPEAKER_PROFILE_MODEL_FIELDS,
            models_by_id,
        ),
        briefing=row.get("briefing") or "",
        audio_file=audio_file,
        audio_url=audio_url,
        transcript=row.get("transcript"),
        outline=row.get("outline"),
        created=str(row.get("created")) if row.get("created") else None,
        job_status=job_status,
        error_message=error_message,
        access_role=await effective_role_for_episode(ep_like, request),
    )


@router.post("/podcasts/generate", response_model=PodcastGenerationResponse)
async def generate_podcast(request: PodcastGenerationRequest, http_request: Request):
    """
    Generate a podcast episode using Episode Profiles.
    Returns immediately with job ID for status tracking.
    """
    try:
        if request.notebook_id:
            notebook = await Notebook.get(request.notebook_id)
            await assert_can_edit_notebook_or_403(
                notebook.user_id,
                request.notebook_id,
                http_request,
                "Notebook not found",
            )

        user = current_user_optional(http_request)
        job_id = await PodcastService.submit_generation_job(
            episode_profile_name=request.episode_profile,
            speaker_profile_name=request.speaker_profile,
            episode_name=request.episode_name,
            notebook_id=request.notebook_id,
            content=request.content,
            briefing_suffix=request.briefing_suffix,
            user_id=user.id if user else None,
            client_id=user.client_id if user else None,
        )

        return PodcastGenerationResponse(
            job_id=job_id,
            status="submitted",
            message=f"Podcast generation started for episode '{request.episode_name}'",
            episode_profile=request.episode_profile,
            episode_name=request.episode_name,
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error generating podcast: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to generate podcast"
        )


@router.get("/podcasts/jobs/{job_id}")
async def get_podcast_job_status(job_id: str):
    """Get the status of a podcast generation job"""
    try:
        status_data = await PodcastService.get_job_status(job_id)
        return status_data

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching podcast job status: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to fetch job status"
        )


@router.get("/podcasts/episodes", response_model=List[PodcastEpisodeResponse])
async def list_podcast_episodes(request: Request):
    """List all podcast episodes"""
    try:
        episodes = await PodcastService.list_episodes()
        episodes = await filter_episodes_by_access(episodes, request)

        # Batch-fetch job status for every episode with a command in one
        # query instead of one round trip per episode (see
        # PodcastEpisode.get_job_details_for_commands docstring).
        try:
            details_by_command = await PodcastEpisode.get_job_details_for_commands(
                [episode.command for episode in episodes if episode.command]
            )
        except Exception as e:
            logger.warning(f"Error batch-fetching podcast job statuses: {str(e)}")
            details_by_command = {}

        # Batch-resolve the snapshots' model references (outline_llm,
        # transcript_llm, voice_model) to display fields in one query
        # instead of one lookup per episode.
        models_by_id = await _resolve_snapshot_models(episodes)

        response_episodes = []
        for episode in episodes:
            # Skip incomplete episodes without command or audio
            if not episode.command and not episode.audio_file:
                continue

            # Get job status and error message if available
            job_status = None
            error_message = None
            if episode.command:
                detail = details_by_command.get(str(episode.command))
                if detail is not None:
                    job_status = detail["status"]
                    error_message = detail["error_message"]
                else:
                    job_status = "unknown"
            else:
                # No command but has audio file = completed import
                job_status = "completed"

            audio_url = None
            audio_path = resolve_contained_audio_path(episode.audio_file)
            if audio_path is not None and audio_path.exists():
                audio_url = f"/api/podcasts/episodes/{episode.id}/audio"

            response_episodes.append(
                PodcastEpisodeResponse(
                    id=str(episode.id),
                    name=episode.name,
                    episode_profile=_with_resolved_model_fields(
                        episode.episode_profile,
                        _EPISODE_PROFILE_MODEL_FIELDS,
                        models_by_id,
                    ),
                    speaker_profile=_with_resolved_model_fields(
                        episode.speaker_profile,
                        _SPEAKER_PROFILE_MODEL_FIELDS,
                        models_by_id,
                    ),
                    briefing=episode.briefing,
                    audio_file=episode.audio_file,
                    audio_url=audio_url,
                    transcript=episode.transcript,
                    outline=episode.outline,
                    created=str(episode.created) if episode.created else None,
                    job_status=job_status,
                    error_message=error_message,
                    access_role=await effective_role_for_episode(episode, request),
                )
            )

        return response_episodes

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error listing podcast episodes: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to list podcast episodes"
        )


@router.get(
    "/podcasts/episodes/library", response_model=EpisodeLibraryPageResponse
)
async def get_episodes_library(
    request: Request,
    query: Optional[str] = Query(
        None, max_length=200, description="Filter by episode name"
    ),
    sort_by: str = Query(
        "updated",
        description="Field to sort by (updated, created, or episode_name)",
    ),
    sort_order: str = Query("desc", description="Sort order (asc or desc)"),
    limit: int = Query(
        EPISODE_LIBRARY_DEFAULT_LIMIT,
        ge=1,
        le=EPISODE_LIBRARY_MAX_LIMIT,
        description="Maximum episodes to return (1-200)",
    ),
    cursor: Optional[str] = Query(
        None, description="Opaque cursor from a previous page"
    ),
) -> EpisodeLibraryPageResponse:
    """Keyset-paginated Podcast Episodes library.

    Access predicate and the name text filter are applied in SurrealQL
    *before* the keyset predicate, so cursors can never leak inaccessible
    records. The cursor is version-tagged and fingerprint-bound to this
    request's filters — reusing one with a different query, sort field or
    sort order returns HTTP 400.
    """
    if sort_by not in EPISODE_LIBRARY_SORT_FIELDS:
        raise HTTPException(
            status_code=400,
            detail="sort_by must be one of: updated, created, episode_name",
        )
    if sort_order.lower() not in ("asc", "desc"):
        raise HTTPException(
            status_code=400, detail="sort_order must be 'asc' or 'desc'"
        )
    sort_order_norm = sort_order.lower()

    normalized_query = query.strip().lower() if query else ""
    fp = _episode_library_fingerprint(normalized_query, sort_by, sort_order_norm)

    cursor_payload: Optional[dict[str, Any]] = None
    if cursor:
        try:
            cursor_payload = decode_cursor(
                cursor,
                allowed_sort_fields=EPISODE_LIBRARY_SORT_FIELDS.keys(),
                expected_sort_by=sort_by,
                expected_sort_order=sort_order_norm,
                expected_fp=fp,
            )
        except CursorValidationError:
            raise HTTPException(status_code=400, detail="Invalid cursor")

    access_clause, access_binds = await episode_access_where(request)

    cursor_value = cursor_payload["value"] if cursor_payload else None
    cursor_id = None
    if cursor_payload is not None:
        cursor_id = ensure_record_id(str(cursor_payload["id"]))

    try:
        rows = await PodcastService.list_episodes_page(
            access_clause=access_clause,
            access_binds=access_binds,
            normalized_query=normalized_query,
            sort_by=sort_by,
            sort_order=sort_order_norm,
            limit=limit + 1,  # limit + 1 internally; extra row = next-page signal
            cursor_value=cursor_value,
            cursor_id=cursor_id,
        )
    except OpenNotebookError:
        raise
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Error fetching episodes library: {e}")
        raise HTTPException(status_code=500, detail="Error fetching episodes")

    has_next = len(rows) > limit
    visible_rows = rows[:limit]

    # Batch-fetch job statuses + model refs for the visible rows only —
    # matches the complete-list route's shape without loading everything.
    try:
        details_by_command = await PodcastEpisode.get_job_details_for_commands(
            [row["command"] for row in visible_rows if row.get("command")]
        )
    except Exception as e:
        logger.warning(f"Error batch-fetching podcast job statuses: {e}")
        details_by_command = {}

    model_ids: set = set()
    for row in visible_rows:
        for field in _EPISODE_PROFILE_MODEL_FIELDS:
            ref = (row.get("episode_profile") or {}).get(field)
            if ref:
                model_ids.add(str(ref))
        for field in _SPEAKER_PROFILE_MODEL_FIELDS:
            ref = (row.get("speaker_profile") or {}).get(field)
            if ref:
                model_ids.add(str(ref))
    try:
        models_by_id = await Model.get_display_info_for_ids(sorted(model_ids))
    except Exception as e:
        logger.warning(f"Error batch-resolving snapshot model references: {e}")
        models_by_id = {}

    items = [
        await _episode_row_to_response(
            row,
            details_by_command=details_by_command,
            models_by_id=models_by_id,
            request=request,
        )
        for row in visible_rows
    ]

    next_cursor: Optional[str] = None
    if has_next and visible_rows:
        last = visible_rows[-1]
        if sort_by == "episode_name":
            cursor_value_out: Any = last.get("name_sort", "")
        else:
            cursor_value_out = last.get(sort_by)
        next_cursor = encode_cursor(
            {
                "v": CURSOR_VERSION,
                "sort_by": sort_by,
                "sort_order": sort_order_norm,
                "value": cursor_value_out,
                "id": str(last["id"]),
                "fp": fp,
            }
        )

    return EpisodeLibraryPageResponse(items=items, next_cursor=next_cursor)


@router.get(
    "/podcasts/episodes/summary", response_model=EpisodeSummaryResponse
)
async def get_episodes_summary(request: Request) -> EpisodeSummaryResponse:
    """Aggregate status counts for the user's podcast episodes.

    Drives the /podcasts stat tiles and the poll-when-active decision.
    Counts are global across the owner's accessible library (owner + notebook
    shares), so they stay accurate when the library is keyset-paginated.
    """
    access_clause, access_binds = await episode_access_where(request)
    try:
        counts = await PodcastService.episode_status_counts(
            access_clause=access_clause,
            access_binds=access_binds,
        )
    except OpenNotebookError:
        raise
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Error computing episode summary: {e}")
        raise HTTPException(status_code=500, detail="Error computing summary")

    return EpisodeSummaryResponse(
        total=counts.get("total", 0),
        running=counts.get("running", 0),
        completed=counts.get("completed", 0),
        failed=counts.get("failed", 0),
        pending=counts.get("pending", 0),
        # has_active mirrors ACTIVE_EPISODE_STATUSES on the frontend — see
        # PodcastService.episode_status_counts, which counts it separately.
        has_active=counts.get("active", 0) > 0,
    )


@router.get("/podcasts/episodes/{episode_id}", response_model=PodcastEpisodeResponse)
async def get_podcast_episode(episode_id: str, request: Request):
    """Get a specific podcast episode"""
    try:
        episode = await PodcastService.get_episode(episode_id)
        await _assert_episode_view_or_404(episode, request)

        # Get job status and error message if available
        job_status = None
        error_message = None
        if episode.command:
            try:
                detail = await episode.get_job_detail()
                job_status = detail["status"]
                error_message = detail["error_message"]
            except Exception:
                job_status = "unknown"
        else:
            # No command but has audio file = completed import
            job_status = "completed" if episode.audio_file else "unknown"

        audio_url = None
        audio_path = resolve_contained_audio_path(episode.audio_file)
        if audio_path is not None and audio_path.exists():
            audio_url = f"/api/podcasts/episodes/{episode.id}/audio"

        models_by_id = await _resolve_snapshot_models([episode])

        return PodcastEpisodeResponse(
            id=str(episode.id),
            name=episode.name,
            episode_profile=_with_resolved_model_fields(
                episode.episode_profile,
                _EPISODE_PROFILE_MODEL_FIELDS,
                models_by_id,
            ),
            speaker_profile=_with_resolved_model_fields(
                episode.speaker_profile,
                _SPEAKER_PROFILE_MODEL_FIELDS,
                models_by_id,
            ),
            briefing=episode.briefing,
            audio_file=episode.audio_file,
            audio_url=audio_url,
            transcript=episode.transcript,
            outline=episode.outline,
            created=str(episode.created) if episode.created else None,
            job_status=job_status,
            error_message=error_message,
            access_role=await effective_role_for_episode(episode, request),
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching podcast episode: {str(e)}")
        raise HTTPException(status_code=404, detail="Episode not found")


@router.get("/podcasts/episodes/{episode_id}/audio")
async def stream_podcast_episode_audio(episode_id: str, request: Request):
    """Stream the audio file associated with a podcast episode"""
    try:
        episode = await PodcastService.get_episode(episode_id)
        await _assert_episode_view_or_404(episode, request)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching podcast episode for audio: {str(e)}")
        raise HTTPException(status_code=404, detail="Episode not found")

    if not episode.audio_file:
        raise HTTPException(status_code=404, detail="Episode has no audio file")

    audio_path = resolve_contained_audio_path(episode.audio_file)
    if audio_path is None:
        logger.warning(
            f"Blocked audio access outside podcasts directory for episode "
            f"{episode_id}: {episode.audio_file}"
        )
        raise HTTPException(status_code=403, detail="Access to file denied")

    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    return FileResponse(
        audio_path,
        media_type="audio/mpeg",
        filename=audio_path.name,
    )


@router.post("/podcasts/episodes/{episode_id}/retry")
async def retry_podcast_episode(episode_id: str, request: Request):
    """Retry a failed podcast episode by deleting it and submitting a new job"""
    try:
        episode = await PodcastService.get_episode(episode_id)
        await _assert_episode_edit_or_403(episode, request)

        # Validate episode is in a failed state
        detail = await episode.get_job_detail()
        if detail["status"] not in ("failed", "error"):
            raise HTTPException(
                status_code=400,
                detail=f"Episode is not in a failed state (current: {detail['status']})",
            )

        # Extract params for re-submission
        ep_profile_name = episode.episode_profile.get("name")
        sp_profile_name = episode.speaker_profile.get("name")
        episode_name = episode.name
        content = episode.content
        notebook_id = episode.notebook_id

        if not ep_profile_name or not sp_profile_name:
            raise HTTPException(
                status_code=400,
                detail="Cannot retry: episode or speaker profile name missing from stored data",
            )

        # Delete audio file if any
        _delete_episode_audio(episode, episode_id)

        # Delete the failed episode
        await episode.delete()

        # Submit a new job, preserving the original episode's owner + notebook
        job_id = await PodcastService.submit_generation_job(
            episode_profile_name=ep_profile_name,
            speaker_profile_name=sp_profile_name,
            episode_name=episode_name,
            content=content,
            notebook_id=notebook_id,
            user_id=episode.user_id,
            client_id=episode.client_id,
        )

        return {"job_id": job_id, "message": "Retry submitted successfully"}

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error retrying podcast episode: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to retry episode"
        )


@router.delete("/podcasts/episodes/{episode_id}")
async def delete_podcast_episode(episode_id: str, request: Request):
    """Delete a podcast episode and its associated audio file"""
    try:
        # Get the episode first to check if it exists and get the audio file path
        episode = await PodcastService.get_episode(episode_id)
        await _assert_episode_edit_or_403(episode, request)

        # Delete the physical audio file if it exists
        _delete_episode_audio(episode, episode_id)

        # Delete the episode from the database
        await episode.delete()

        logger.info(f"Deleted podcast episode: {episode_id}")
        return {"message": "Episode deleted successfully", "episode_id": episode_id}

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting podcast episode: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to delete episode"
        )
