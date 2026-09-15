"""Backend tests for the podcast episode summary endpoint.

The summary powers the /podcasts stat tiles and the poll-when-active
decision. Because the library route is cursor-paginated, per-status totals
have to come from the server rather than a loaded-only client count.

Status classification must match ``frontend/src/lib/types/podcasts.ts``
``groupEpisodesByStatus`` exactly: a mismatch would leave the tiles saying
something different from the section headers.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import podcasts


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(podcasts.router, prefix="/api")
    return TestClient(app)


@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_summary_maps_statuses_to_the_four_frontend_buckets(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
) -> None:
    """running/processing → running; new/queued/pending/submitted/unknown →
    pending; failed/error → failed; completed → completed. Matches
    frontend groupEpisodesByStatus."""
    mock_access.return_value = ("", {})
    mock_query.return_value = [
        {"id": "episode:e1", "command": "command:c1", "audio_file": None},
        {"id": "episode:e2", "command": "command:c2", "audio_file": None},
        {"id": "episode:e3", "command": "command:c3", "audio_file": None},
        {"id": "episode:e4", "command": "command:c4", "audio_file": None},
        {"id": "episode:e5", "command": "command:c5", "audio_file": None},
        {"id": "episode:e6", "command": "command:c6", "audio_file": None},
    ]
    mock_batch.return_value = {
        "command:c1": {"status": "running", "error_message": None},
        "command:c2": {"status": "processing", "error_message": None},
        "command:c3": {"status": "queued", "error_message": None},
        "command:c4": {"status": "completed", "error_message": None},
        "command:c5": {"status": "failed", "error_message": None},
        "command:c6": {"status": "error", "error_message": None},
    }

    resp = _client().get("/api/podcasts/episodes/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 6
    assert body["running"] == 2  # running + processing
    assert body["pending"] == 1  # queued
    assert body["completed"] == 1
    assert body["failed"] == 2  # failed + error
    assert body["has_active"] is True  # running/processing count as active


@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_summary_has_active_false_when_only_terminal_statuses(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
) -> None:
    mock_access.return_value = ("", {})
    mock_query.return_value = [
        {"id": "episode:e1", "command": "command:c1", "audio_file": None},
        {"id": "episode:e2", "command": "command:c2", "audio_file": None},
    ]
    mock_batch.return_value = {
        "command:c1": {"status": "completed", "error_message": None},
        "command:c2": {"status": "failed", "error_message": None},
    }

    resp = _client().get("/api/podcasts/episodes/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_active"] is False


@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_summary_skips_incomplete_rows(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
) -> None:
    """A row without both ``command`` and ``audio_file`` is legacy junk;
    the list route skips it, the tiles must ignore it too."""
    mock_access.return_value = ("", {})
    mock_query.return_value = [
        {"id": "episode:e1", "command": None, "audio_file": None},  # skipped
        {"id": "episode:e2", "command": "command:c2", "audio_file": None},
    ]
    mock_batch.return_value = {
        "command:c2": {"status": "completed", "error_message": None},
    }

    resp = _client().get("/api/podcasts/episodes/summary")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_summary_passes_access_predicate_into_query(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
) -> None:
    mock_access.return_value = (
        "(user_id = $access_uid)",
        {"access_uid": "user:u1"},
    )
    mock_query.return_value = []
    mock_batch.return_value = {}

    resp = _client().get("/api/podcasts/episodes/summary")
    assert resp.status_code == 200
    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "user_id = $access_uid" in query_sql
    assert params["access_uid"] == "user:u1"


@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_summary_row_without_command_but_with_audio_counts_completed(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
) -> None:
    """Legacy imported episodes (audio_file set, no command) count as
    completed — same rule the list route applies when building responses."""
    mock_access.return_value = ("", {})
    mock_query.return_value = [
        {"id": "episode:e1", "command": None, "audio_file": "some/path.mp3"},
    ]
    mock_batch.return_value = {}

    resp = _client().get("/api/podcasts/episodes/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["completed"] == 1
    assert body["has_active"] is False
