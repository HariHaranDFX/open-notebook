"""Podcast episodes carry their notebook-inherited effective role (WP3-06)
without weakening the existing edit/delete enforcement."""

from unittest.mock import AsyncMock, patch

from tests.test_ownership_notes_chat_podcasts import (
    USER_A,
    _client,
    _episode,
)


def _episode_in_notebook(episode_id, user_id, notebook_id="notebook:1"):
    ep = _episode(episode_id, user_id=user_id, client_id="client-1")
    ep.notebook_id = notebook_id
    return ep


def _role_query_side_effect(*, notebook_owner="user:c", grant_role=None):
    """Mock api.ownership.repo_query for the episode -> notebook -> grant path."""
    async def _side_effect(query, params=None):
        if "FROM user_group_member" in query:
            return []
        if "FROM resource_grant" in query:
            return [{"role": grant_role}] if grant_role else []
        if "FROM notebook" in query:
            return [{"user_id": notebook_owner}]
        return []

    return _side_effect


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_owner_episode_reports_owner_role(mock_get, mock_query, monkeypatch):
    mock_get.return_value = _episode("episode:1", user_id="user:a", client_id="client-1")
    mock_query.side_effect = _role_query_side_effect()
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "owner"


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_notebook_viewer_reports_viewer_role(mock_get, mock_query, monkeypatch):
    mock_get.return_value = _episode_in_notebook("episode:1", user_id="user:b")
    mock_query.side_effect = _role_query_side_effect(grant_role="viewer")
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "viewer"


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_notebook_editor_reports_editor_role(mock_get, mock_query, monkeypatch):
    mock_get.return_value = _episode_in_notebook("episode:1", user_id="user:b")
    mock_query.side_effect = _role_query_side_effect(grant_role="editor")
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "editor"


@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_open_mode_reports_owner_role(mock_get, monkeypatch):
    mock_get.return_value = _episode("episode:1", user_id="user:b")
    client = _client(monkeypatch, auth_enabled=False, user=None)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "owner"


@patch("api.routers.podcasts.repo_query", new_callable=AsyncMock)
@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_notebook_viewer_delete_still_403(
    mock_get, mock_query, mock_podcasts_query, monkeypatch
):
    """Enforcement is unchanged: the response says 'viewer' AND the API still
    forbids the delete. Hiding the button is never the security boundary.

    `_assert_episode_edit_or_403` (api/routers/podcasts.py) resolves the
    episode's notebook via its own directly-imported `repo_query`, not
    `api.ownership.repo_query` - mocking only the latter would leave this
    call hitting a real database. Both are mocked here so the test exercises
    enforcement deterministically regardless of what's running locally.
    """
    mock_get.return_value = _episode_in_notebook("episode:1", user_id="user:b")
    side_effect = _role_query_side_effect(grant_role="viewer")
    mock_query.side_effect = side_effect
    mock_podcasts_query.side_effect = side_effect
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.delete("/api/podcasts/episodes/episode:1")

    assert response.status_code == 403
