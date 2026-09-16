"""Single-episode API surfaces the originating notebook, when linked.

The detail response gets two optional fields — `notebook_id` (already the
source of truth on the episode) and a freshly resolved `notebook_name` —
so the podcast header can render a compact origin pill. Standalone
episodes (no notebook_id) report both as null. Authorization is
unchanged and inherited from the notebook grant path.
"""

from unittest.mock import AsyncMock, patch

from tests.test_ownership_notes_chat_podcasts import (
    USER_A,
    _client,
    _episode,
)


def _episode_in_notebook(episode_id="episode:1", user_id="user:a", notebook_id="notebook:1"):
    ep = _episode(episode_id, user_id=user_id, client_id="client-1")
    ep.notebook_id = notebook_id
    return ep


def _notebook_origin_side_effect(*, notebook_owner="user:a", notebook_name="Research notebook"):
    """Mock repo_query for two-way access: ownership (user_id) + origin (name).

    Both `api.ownership.repo_query` and `api.routers.podcasts.repo_query`
    reach into the notebook table for different rows. The router's new
    origin lookup expects a `name` column; the ownership path expects
    `user_id`. This side_effect returns whichever the query asks for.
    """

    async def _side_effect(query, params=None):
        if "FROM user_group_member" in query:
            return []
        if "FROM resource_grant" in query:
            return []
        if "FROM notebook" in query:
            if "name" in query.lower().split("select", 1)[-1].split("from", 1)[0]:
                return [{"name": notebook_name}]
            return [{"user_id": notebook_owner}]
        return []

    return _side_effect


@patch("api.routers.podcasts.repo_query", new_callable=AsyncMock)
@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_linked_episode_reports_notebook_origin(
    mock_get, mock_ownership_query, mock_router_query, monkeypatch
):
    mock_get.return_value = _episode_in_notebook()
    side_effect = _notebook_origin_side_effect()
    mock_ownership_query.side_effect = side_effect
    mock_router_query.side_effect = side_effect
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    body = response.json()
    assert body["notebook_id"] == "notebook:1"
    assert body["notebook_name"] == "Research notebook"


@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_standalone_episode_reports_no_notebook_origin(mock_get, monkeypatch):
    mock_get.return_value = _episode("episode:1", user_id="user:a", client_id="client-1")
    client = _client(monkeypatch, auth_enabled=False, user=None)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    body = response.json()
    assert body["notebook_id"] is None
    assert body["notebook_name"] is None
