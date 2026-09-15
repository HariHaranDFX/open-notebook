"""Backend tests for the Podcast episode library keyset pagination route.

Mirrors the sources/notebooks pattern:

- No ``START`` or ``OFFSET`` in the generated SurrealQL.
- ``LIMIT $limit + 1`` internally; only issue ``next_cursor`` when the extra
  row exists.
- Access + text filters applied *before* the keyset predicate.
- Cursors are opaque, versioned, fingerprint-bound to (query, sort_by,
  sort_order). Any tamper → HTTP 400 (never silent misordering).
"""

from __future__ import annotations

import base64
import json
from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import podcasts


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(podcasts.router, prefix="/api")
    return TestClient(app)


def _row(idx: int, **overrides: Any) -> dict[str, Any]:
    """Row shape SurrealQL returns for the library query."""
    row: dict[str, Any] = {
        "id": f"episode:e{idx:04d}",
        "name": f"Episode {idx}",
        "episode_profile": {},
        "speaker_profile": {},
        "briefing": "b",
        "audio_file": None,
        "transcript": None,
        "outline": None,
        "command": f"command:c{idx:04d}",
        "user_id": None,
        "notebook_id": None,
        "created": "2026-01-01T00:00:00Z",
        "updated": f"2026-02-{(idx % 28) + 1:02d}T00:00:00Z",
        "name_sort": f"episode {idx}",
    }
    row.update(overrides)
    return row


def _decode_cursor(token: str) -> dict[str, Any]:
    padded = token + "=" * (-len(token) % 4)
    return json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))


def _patch_router_seams(returned_rows: list[dict[str, Any]]):
    """Common seam patches — the library route composes several helpers.

    Returns a context-manager tuple to be used as ``with patch(...) as ...:``
    stacks; call sites use ``@patch`` decorators for readability.
    """
    raise NotImplementedError("Use per-test @patch decorators instead")


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_first_page_returns_thirty_items_and_next_cursor(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """A 31st row exists — expose 30 items and issue ``next_cursor``."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(31)]

    response = _client().get(
        "/api/podcasts/episodes/library?limit=30&sort_by=updated&sort_order=desc"
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 30
    assert payload["next_cursor"] is not None

    assert mock_query.await_count == 1
    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "OFFSET" not in query_sql.upper()
    assert "START" not in query_sql.upper()
    assert params["limit"] == 31


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_no_next_cursor_when_page_is_not_full(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """Fewer than ``limit + 1`` rows → no cursor."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(5)]

    response = _client().get("/api/podcasts/episodes/library?limit=30")

    assert response.status_code == 200
    assert response.json()["next_cursor"] is None
    assert len(response.json()["items"]) == 5


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_next_page_uses_cursor_and_avoids_first_page_rows(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """Round-trip: first-page cursor must produce a WHERE clause using it."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(31)]

    first = _client().get(
        "/api/podcasts/episodes/library?limit=30&sort_by=updated&sort_order=desc"
    )
    cursor = first.json()["next_cursor"]
    assert cursor is not None

    payload = _decode_cursor(cursor)
    assert payload["sort_by"] == "updated"
    assert payload["sort_order"] == "desc"
    assert payload["v"] == 1
    assert isinstance(payload["fp"], str) and len(payload["fp"]) == 64

    # Second call — the WHERE must carry cursor predicates.
    mock_query.reset_mock()
    mock_query.return_value = [_row(31 + i) for i in range(5)]
    resp2 = _client().get(
        f"/api/podcasts/episodes/library?limit=30&sort_by=updated&sort_order=desc&cursor={cursor}"
    )
    assert resp2.status_code == 200
    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "$cursor_value" in query_sql
    assert "$cursor_id" in query_sql
    assert params["cursor_value"] == payload["value"]


def test_malformed_cursor_returns_400() -> None:
    resp = _client().get("/api/podcasts/episodes/library?cursor=not-a-valid-cursor")
    assert resp.status_code == 400


def test_oversized_cursor_returns_400() -> None:
    oversized = "A" * 3000
    resp = _client().get(f"/api/podcasts/episodes/library?cursor={oversized}")
    assert resp.status_code == 400


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_cursor_from_a_different_query_returns_400(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """Fingerprint binds the cursor to the request's filter set."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(31)]

    first = _client().get(
        "/api/podcasts/episodes/library?limit=30&sort_by=updated&sort_order=desc"
    )
    cursor = first.json()["next_cursor"]
    assert cursor is not None

    # Re-use the same cursor with a different query text — fingerprint mismatch.
    resp = _client().get(
        f"/api/podcasts/episodes/library?limit=30&sort_by=updated&sort_order=desc&query=different&cursor={cursor}"
    )
    assert resp.status_code == 400


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_cursor_from_a_different_sort_returns_400(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(31)]

    first = _client().get(
        "/api/podcasts/episodes/library?sort_by=updated&sort_order=desc"
    )
    cursor = first.json()["next_cursor"]
    assert cursor is not None

    resp = _client().get(
        f"/api/podcasts/episodes/library?sort_by=created&sort_order=desc&cursor={cursor}"
    )
    assert resp.status_code == 400


def test_invalid_sort_by_returns_400() -> None:
    resp = _client().get("/api/podcasts/episodes/library?sort_by=bogus")
    assert resp.status_code == 400


def test_invalid_sort_order_returns_400() -> None:
    resp = _client().get("/api/podcasts/episodes/library?sort_order=random")
    assert resp.status_code == 400


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_name_query_filter_applied_before_keyset(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """A ``query`` param must land in the WHERE clause, not client-side."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(3)]

    resp = _client().get("/api/podcasts/episodes/library?query=Alpha")

    assert resp.status_code == 200
    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "name_query" in params
    assert params["name_query"] == "alpha"
    assert "CONTAINS $name_query" in query_sql


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_access_predicate_applied_before_keyset(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """Access predicate must land in WHERE; its binds must reach the query."""
    mock_access.return_value = (
        "(user_id = $access_uid OR notebook_id IN $access_episode_notebook_ids)",
        {
            "access_uid": "user:u1",
            "access_episode_notebook_ids": ["notebook:n1"],
        },
    )
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(3)]

    resp = _client().get("/api/podcasts/episodes/library")
    assert resp.status_code == 200
    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "user_id = $access_uid" in query_sql
    assert params["access_uid"] == "user:u1"
    assert params["access_episode_notebook_ids"] == ["notebook:n1"]


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_sort_by_episode_name_uses_name_sort_alias(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """The router must use the case-insensitive alias, not raw ``name``."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(3)]

    resp = _client().get(
        "/api/podcasts/episodes/library?sort_by=episode_name&sort_order=asc"
    )
    assert resp.status_code == 200
    assert mock_query.await_args is not None
    query_sql, _params = mock_query.await_args.args
    assert "ORDER BY name_sort ASC" in query_sql


@patch("api.routers.podcasts.effective_role_for_episode", new_callable=AsyncMock)
@patch("api.routers.podcasts.resolve_contained_audio_path")
@patch("api.routers.podcasts.Model.get_display_info_for_ids", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastEpisode.get_job_details_for_commands", new_callable=AsyncMock)
@patch("api.podcast_service.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.episode_access_where", new_callable=AsyncMock)
def test_id_ties_break_by_id_direction(
    mock_access: AsyncMock,
    mock_query: AsyncMock,
    mock_batch: AsyncMock,
    mock_models: AsyncMock,
    mock_audio_path,
    mock_role: AsyncMock,
) -> None:
    """Every sort must add ``id`` as the secondary key so equal primary
    values page deterministically."""
    mock_access.return_value = ("", {})
    mock_batch.return_value = {}
    mock_models.return_value = {}
    mock_audio_path.return_value = None
    mock_role.return_value = "owner"
    mock_query.return_value = [_row(i) for i in range(3)]

    resp = _client().get(
        "/api/podcasts/episodes/library?sort_by=updated&sort_order=desc"
    )
    assert resp.status_code == 200
    assert mock_query.await_args is not None
    query_sql, _params = mock_query.await_args.args
    assert "ORDER BY updated DESC, id DESC" in query_sql
