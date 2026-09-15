from typing import Any, Dict, Optional

from fastapi import HTTPException
from loguru import logger
from pydantic import BaseModel
from surreal_commands import get_command_status, submit_command

from open_notebook.database.repository import repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.podcasts.models import EpisodeProfile, PodcastEpisode, SpeakerProfile


class PodcastGenerationRequest(BaseModel):
    """Request model for podcast generation"""

    episode_profile: str
    speaker_profile: str
    episode_name: str
    content: Optional[str] = None
    notebook_id: Optional[str] = None
    briefing_suffix: Optional[str] = None


class PodcastGenerationResponse(BaseModel):
    """Response model for podcast generation"""

    job_id: str
    status: str
    message: str
    episode_profile: str
    episode_name: str


# ORDER BY references the SELECT alias, which SurrealDB resolves; WHERE
# cannot reference an alias, so keyset predicates inline the same expression
# that produced the alias. Exported so the library route can validate the
# sort_by query param without duplicating the allowlist.
EPISODE_LIBRARY_SORT_FIELDS: Dict[str, str] = {
    "updated": "updated",
    "created": "created",
    "episode_name": "name_sort",
}

EPISODE_LIBRARY_SORT_EXPR: Dict[str, str] = {
    "updated": "updated",
    "created": "created",
    "episode_name": "string::lowercase(name OR '')",
}


class PodcastService:
    """Service layer for podcast operations"""

    @staticmethod
    async def submit_generation_job(
        episode_profile_name: str,
        speaker_profile_name: str,
        episode_name: str,
        notebook_id: Optional[str] = None,
        content: Optional[str] = None,
        briefing_suffix: Optional[str] = None,
        user_id: Optional[str] = None,
        client_id: Optional[str] = None,
    ) -> str:
        """Submit a podcast generation job for background processing"""
        try:
            # Validate episode profile exists
            episode_profile = await EpisodeProfile.get_by_name(episode_profile_name)
            if not episode_profile:
                raise ValueError(f"Episode profile '{episode_profile_name}' not found")

            # Resolve the user-facing speaker profile name to a record ID at
            # the API boundary (#630) - everything downstream works with IDs.
            speaker_profile = await SpeakerProfile.resolve(speaker_profile_name)
            if not speaker_profile:
                raise ValueError(f"Speaker profile '{speaker_profile_name}' not found")

            # Get content from notebook if not provided directly
            if not content and notebook_id:
                try:
                    notebook = await Notebook.get(notebook_id)
                    # Get notebook context (this may need to be adjusted based on actual Notebook implementation)
                    content = (
                        await notebook.get_context()
                        if hasattr(notebook, "get_context")
                        else str(notebook)
                    )
                except Exception as e:
                    logger.warning(
                        f"Failed to get notebook content, using notebook_id as content: {e}"
                    )
                    content = f"Notebook ID: {notebook_id}"

            if not content:
                raise ValueError(
                    "Content is required - provide either content or notebook_id"
                )

            # Prepare command arguments (speaker profile as record ID)
            command_args = {
                "episode_profile": episode_profile_name,
                "speaker_profile": str(speaker_profile.id),
                "episode_name": episode_name,
                "content": str(content),
                "briefing_suffix": briefing_suffix,
                "user_id": user_id,
                "client_id": client_id,
                "notebook_id": notebook_id,
            }

            # Ensure command modules are imported before submitting
            # This is needed because submit_command validates against local registry
            try:
                import commands.podcast_commands  # noqa: F401
            except ImportError as import_err:
                logger.error(f"Failed to import podcast commands: {import_err}")
                raise ValueError("Podcast commands not available")

            # Submit command to surreal-commands
            job_id = submit_command("open_notebook", "generate_podcast", command_args)

            # Convert RecordID to string if needed
            if not job_id:
                raise ValueError("Failed to get job_id from submit_command")
            job_id_str = str(job_id)
            logger.info(
                f"Submitted podcast generation job: {job_id_str} for episode '{episode_name}'"
            )
            return job_id_str

        except Exception as e:
            logger.error(f"Failed to submit podcast generation job: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to submit podcast generation job",
            )

    @staticmethod
    async def get_job_status(job_id: str) -> Dict[str, Any]:
        """Get status of a podcast generation job"""
        try:
            status = await get_command_status(job_id)
            return {
                "job_id": job_id,
                "status": status.status if status else "unknown",
                "result": status.result if status else None,
                "error_message": getattr(status, "error_message", None)
                if status
                else None,
                "created": str(status.created)
                if status and hasattr(status, "created") and status.created
                else None,
                "updated": str(status.updated)
                if status and hasattr(status, "updated") and status.updated
                else None,
                "progress": getattr(status, "progress", None) if status else None,
            }
        except Exception as e:
            logger.error(f"Failed to get podcast job status: {e}")
            raise HTTPException(status_code=500, detail="Failed to get job status")

    @staticmethod
    async def list_episodes() -> list:
        """List all podcast episodes"""
        try:
            episodes = await PodcastEpisode.get_all(order_by="created desc")
            return episodes
        except Exception as e:
            logger.error(f"Failed to list podcast episodes: {e}")
            raise HTTPException(status_code=500, detail="Failed to list episodes")

    @staticmethod
    async def list_episodes_page(
        *,
        access_clause: str,
        access_binds: Dict[str, Any],
        normalized_query: str,
        sort_by: str,
        sort_order: str,
        limit: int,
        cursor_value: Any = None,
        cursor_id: Any = None,
    ) -> list:
        """Fetch one keyset page of episodes, access-filtered in SurrealQL.

        Callers own the cursor codec (see ``api/pagination.py``) and the sort
        allowlist. This helper only builds the SurrealQL. Returns raw rows —
        the router converts them to ``PodcastEpisodeResponse`` and computes
        display fields (job_status, model refs, access_role).

        ``sort_by`` must already be validated by the router against
        :data:`EPISODE_LIBRARY_SORT_FIELDS`. ``sort_order`` is ``"asc"`` or
        ``"desc"``.
        """
        where_parts: list = []
        params: Dict[str, Any] = {}
        if access_clause:
            where_parts.append(f"({access_clause})")
            params.update(access_binds)

        if normalized_query:
            where_parts.append("string::lowercase(name OR '') CONTAINS $name_query")
            params["name_query"] = normalized_query

        if cursor_value is not None or cursor_id is not None:
            sort_expr = EPISODE_LIBRARY_SORT_EXPR[sort_by]
            cmp = ">" if sort_order == "asc" else "<"
            where_parts.append(
                f"({sort_expr} {cmp} $cursor_value "
                f"OR ({sort_expr} = $cursor_value AND id {cmp} $cursor_id))"
            )
            params["cursor_value"] = cursor_value
            params["cursor_id"] = cursor_id

        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        direction = sort_order.upper()
        order_alias = EPISODE_LIBRARY_SORT_FIELDS[sort_by]
        order_clause = f"ORDER BY {order_alias} {direction}, id {direction}"

        params["limit"] = limit

        query_sql = f"""
            SELECT id, name, episode_profile, speaker_profile, briefing,
              audio_file, transcript, outline, command, user_id, notebook_id,
              created, updated,
              string::lowercase(name OR '') AS name_sort
            FROM episode
            {where_sql}
            {order_clause}
            LIMIT $limit
        """
        rows = await repo_query(query_sql, params)
        return rows

    @staticmethod
    async def episode_status_counts(
        *,
        access_clause: str,
        access_binds: Dict[str, Any],
    ) -> Dict[str, int]:
        """Aggregate status counts for the current user's episodes.

        Runs one owner-scoped query to fetch each episode's ``command``
        reference, then one batch query to resolve command statuses (reuses
        :meth:`PodcastEpisode.get_job_details_for_commands`). Returns keys
        ``total``, ``running``, ``completed``, ``failed``, ``pending``.

        The status classification mirrors the frontend's
        ``ACTIVE_EPISODE_STATUSES`` / ``groupEpisodesByStatus`` so tile
        counts match what the library page actually renders.
        """
        where_sql = f"WHERE ({access_clause})" if access_clause else ""
        rows = await repo_query(
            f"SELECT id, command, audio_file FROM episode {where_sql}",
            access_binds,
        )

        command_ids: list = [str(r["command"]) for r in rows if r.get("command")]
        try:
            details_by_command = await PodcastEpisode.get_job_details_for_commands(
                command_ids
            )
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"Error batch-fetching podcast job statuses: {e}")
            details_by_command = {}

        # Status classification matches frontend/src/lib/types/podcasts.ts
        # groupEpisodesByStatus exactly — the tiles the /podcasts page renders
        # would otherwise disagree with the aggregate.
        counts = {
            "total": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "pending": 0,
            "active": 0,
        }
        for row in rows:
            command = row.get("command")
            audio_file = row.get("audio_file")
            if not command and not audio_file:
                continue  # Incomplete row, matches list route's skip rule.
            counts["total"] += 1
            if command:
                detail = details_by_command.get(str(command))
                job_status: str = (
                    detail["status"] if detail is not None else "unknown"
                )
            else:
                job_status = "completed"
            if job_status in ("running", "processing"):
                counts["running"] += 1
            elif job_status == "completed":
                counts["completed"] += 1
            elif job_status in ("failed", "error"):
                counts["failed"] += 1
            else:
                # Everything else (new/queued/pending/submitted/unknown) →
                # the frontend's "pending" group.
                counts["pending"] += 1
            # has_active mirrors ACTIVE_EPISODE_STATUSES on the frontend.
            if job_status in ("running", "processing", "pending", "submitted"):
                counts["active"] += 1
        return counts

    @staticmethod
    async def get_episode(episode_id: str) -> PodcastEpisode:
        """Get a specific podcast episode"""
        try:
            episode = await PodcastEpisode.get(episode_id)
            return episode
        except Exception as e:
            logger.error(f"Failed to get podcast episode {episode_id}: {e}")
            raise HTTPException(status_code=404, detail="Episode not found")


class DefaultProfiles:
    """Utility class for creating default profiles (if needed beyond migration data)"""

    @staticmethod
    async def create_default_episode_profiles():
        """Create default episode profiles if they don't exist"""
        try:
            # Check if profiles already exist
            existing = await EpisodeProfile.get_all()
            if existing:
                logger.info(f"Episode profiles already exist: {len(existing)} found")
                return existing

            # This would create profiles, but since we have migration data,
            # this is mainly for future extensibility
            logger.info(
                "Default episode profiles should be created via database migration"
            )
            return []

        except Exception as e:
            logger.error(f"Failed to create default episode profiles: {e}")
            raise

    @staticmethod
    async def create_default_speaker_profiles():
        """Create default speaker profiles if they don't exist"""
        try:
            # Check if profiles already exist
            existing = await SpeakerProfile.get_all()
            if existing:
                logger.info(f"Speaker profiles already exist: {len(existing)} found")
                return existing

            # This would create profiles, but since we have migration data,
            # this is mainly for future extensibility
            logger.info(
                "Default speaker profiles should be created via database migration"
            )
            return []

        except Exception as e:
            logger.error(f"Failed to create default speaker profiles: {e}")
            raise
