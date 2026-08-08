"""Owner-only access to notes, chat sessions, and podcast episodes (WP2 §4
follow-up).

Mirrors tests/test_ownership_notebooks.py: mocked at the domain/repository
boundary so the real routers, ownership helpers, and response models run
without a live SurrealDB.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.auth.types import AuthenticatedUser
from api.routers import chat, notes, podcasts
from open_notebook.domain.notebook import ChatSession, Note, Notebook
from open_notebook.podcasts.models import PodcastEpisode

USER_A = AuthenticatedUser(
    id="user:a",
    email="a@example.com",
    display_name="User A",
    role="user",
    entra_oid=None,
    client_id="client-1",
)
USER_B = AuthenticatedUser(
    id="user:b",
    email="b@example.com",
    display_name="User B",
    role="user",
    entra_oid=None,
    client_id="client-1",
)


class _StubAuthProvider:
    def __init__(self, enabled: bool) -> None:
        self._enabled = enabled

    def auth_enabled(self) -> bool:
        return self._enabled


def _client(monkeypatch, *, auth_enabled: bool, user: Optional[AuthenticatedUser]) -> TestClient:
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory, "build_auth_provider", lambda: _StubAuthProvider(auth_enabled)
    )

    app = FastAPI()

    @app.middleware("http")
    async def inject_user(request: Request, call_next):
        request.state.user = user
        return await call_next(request)

    app.include_router(notes.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(podcasts.router, prefix="/api")
    return TestClient(app)


def _note(note_id="note:1", title="N", content="c"):
    note = Note(title=title, content=content, note_type="human")
    note.id = note_id
    return note


def _episode(episode_id="episode:1", user_id=None, client_id=None):
    ep = PodcastEpisode(
        name="Episode",
        episode_profile={},
        speaker_profile={},
        briefing="b",
        content="c",
        audio_file="episode.mp3",
        user_id=user_id,
        client_id=client_id,
    )
    ep.id = episode_id
    return ep


def _note_access_query_side_effect(
    *,
    owned_note_ids: Optional[set[str]] = None,
    notebook_owner: str = "user:a",
):
    """Mock api.ownership.repo_query for grant-aware note asserts.

    assert_note_owner_or_404 / assert_note_editable_or_403 query artifact →
    notebook. Owned notes link to a notebook owned by ``notebook_owner``.
    """
    owned = owned_note_ids if owned_note_ids is not None else {"note:1"}

    async def _side_effect(query, params=None):
        params = params or {}
        if "FROM artifact" in query:
            note_id = str(params.get("note_id", ""))
            for oid in owned:
                short = oid.split(":", 1)[-1]
                if oid in note_id or short in note_id:
                    return [{"notebook_id": "notebook:1"}]
            return []
        if "FROM notebook" in query:
            return [{"user_id": notebook_owner}]
        return []

    return _side_effect


class TestNoteGetOwnership:
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_owner_can_get_own_note(self, mock_get, mock_query, monkeypatch):
        mock_get.return_value = _note()
        mock_query.side_effect = _note_access_query_side_effect()
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/notes/note:1")

        assert response.status_code == 200

    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_other_user_gets_404_not_403(self, mock_get, mock_query, monkeypatch):
        mock_get.return_value = _note()
        mock_query.return_value = []  # note's notebook isn't owned by USER_B
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.get("/api/notes/note:1")

        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_note_with_no_notebook_link_hidden_when_enforced(
        self, mock_get, mock_query, monkeypatch
    ):
        """A note not attached to any notebook has nothing to check ownership
        against - fail closed, same as a null-owner notebook row."""
        mock_get.return_value = _note()
        mock_query.return_value = []  # no artifact relation at all
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/notes/note:1")

        assert response.status_code == 404

    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_visible_to_anyone_when_auth_disabled(self, mock_get, monkeypatch):
        mock_get.return_value = _note()
        client = _client(monkeypatch, auth_enabled=False, user=None)

        response = client.get("/api/notes/note:1")

        assert response.status_code == 200


class TestNoteUpdateDeleteOwnership:
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_update_by_non_owner_returns_404(self, mock_get, mock_query, monkeypatch):
        mock_get.return_value = _note()
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.put("/api/notes/note:1", json={"title": "x"})

        assert response.status_code == 404
        assert response.json()["detail"] == "Note not found"

    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.delete", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_delete_by_non_owner_returns_404(
        self, mock_get, mock_delete, mock_query, monkeypatch
    ):
        mock_get.return_value = _note()
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.delete("/api/notes/note:1")

        assert response.status_code == 404
        mock_delete.assert_not_awaited()

    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.delete", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get", new_callable=AsyncMock)
    def test_owner_can_delete(self, mock_get, mock_delete, mock_query, monkeypatch):
        mock_get.return_value = _note()
        mock_query.side_effect = _note_access_query_side_effect()
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.delete("/api/notes/note:1")

        assert response.status_code == 200
        mock_delete.assert_awaited_once()


class TestNoteListOwnership:
    @patch("api.ownership.repo_query", new_callable=AsyncMock)
    @patch("api.routers.notes.Note.get_all", new_callable=AsyncMock)
    def test_list_without_notebook_id_hides_unowned_notes(
        self, mock_get_all, mock_query, monkeypatch
    ):
        mock_get_all.return_value = [
            _note("note:mine", title="Mine"),
            _note("note:theirs", title="Theirs"),
        ]
        # Only note:mine resolves to a notebook USER_A owns.
        mock_query.side_effect = _note_access_query_side_effect(
            owned_note_ids={"note:mine"}
        )
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/notes")

        assert response.status_code == 200
        assert [n["id"] for n in response.json()] == ["note:mine"]

    @patch("api.routers.notes.Note.get_all", new_callable=AsyncMock)
    def test_list_without_notebook_id_unfiltered_when_auth_disabled(
        self, mock_get_all, monkeypatch
    ):
        mock_get_all.return_value = [_note("note:a"), _note("note:b")]
        client = _client(monkeypatch, auth_enabled=False, user=None)

        response = client.get("/api/notes")

        assert response.status_code == 200
        assert len(response.json()) == 2


class TestChatExecuteOwnership:
    @patch("api.routers._chat_shared.Notebook.get", new_callable=AsyncMock)
    @patch("api.routers._chat_shared.repo_query", new_callable=AsyncMock)
    @patch("api.routers._chat_shared.ChatSession.get", new_callable=AsyncMock)
    def test_execute_denied_when_notebook_not_owned(
        self, mock_session_get, mock_repo, mock_nb_get, monkeypatch
    ):
        session = ChatSession(title="S")
        session.id = "chat_session:1"
        mock_session_get.return_value = session
        mock_repo.return_value = [{"out": "notebook:1"}]
        mock_nb_get.return_value = Notebook(
            id="notebook:1", name="N", description="D", user_id="user:a"
        )
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.post(
            "/api/chat/execute",
            json={"session_id": "1", "message": "hi", "context": {}},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Session not found"

    @patch("api.routers._chat_shared.Notebook.get", new_callable=AsyncMock)
    @patch("api.routers._chat_shared.repo_query", new_callable=AsyncMock)
    @patch("api.routers._chat_shared.ChatSession.get", new_callable=AsyncMock)
    def test_execute_allowed_for_owner(
        self, mock_session_get, mock_repo, mock_nb_get, monkeypatch
    ):
        session = ChatSession(title="S")
        session.id = "chat_session:1"
        mock_session_get.return_value = session
        mock_repo.return_value = [{"out": "notebook:1"}]
        mock_nb_get.return_value = Notebook(
            id="notebook:1", name="N", description="D", user_id="user:a"
        )
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        with (
            patch("api.routers.chat.chat_graph") as mock_graph,
            patch.object(ChatSession, "save", new_callable=AsyncMock),
        ):
            mock_graph.get_state.return_value = None
            mock_graph.invoke.return_value = {"messages": []}
            response = client.post(
                "/api/chat/execute",
                json={"session_id": "1", "message": "hi", "context": {}},
            )

        assert response.status_code == 200


class TestChatContextOwnership:
    @patch("api.routers.chat.Notebook.get", new_callable=AsyncMock)
    def test_build_context_denied_when_notebook_not_owned(self, mock_get, monkeypatch):
        mock_get.return_value = Notebook(
            id="notebook:1", name="N", description="D", user_id="user:a"
        )
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.post(
            "/api/chat/context",
            json={"notebook_id": "notebook:1", "context_config": {}},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Notebook not found"


class TestPodcastGenerateOwnership:
    @patch("api.routers.podcasts.PodcastService.submit_generation_job", new_callable=AsyncMock)
    @patch("api.routers.podcasts.Notebook.get", new_callable=AsyncMock)
    def test_generate_denied_when_notebook_not_owned(
        self, mock_nb_get, mock_submit, monkeypatch
    ):
        mock_nb_get.return_value = Notebook(
            id="notebook:1", name="N", description="D", user_id="user:a"
        )
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.post(
            "/api/podcasts/generate",
            json={
                "episode_profile": "default",
                "speaker_profile": "default",
                "episode_name": "Ep",
                "notebook_id": "notebook:1",
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Notebook not found"
        mock_submit.assert_not_awaited()

    @patch("api.routers.podcasts.PodcastService.submit_generation_job", new_callable=AsyncMock)
    @patch("api.routers.podcasts.Notebook.get", new_callable=AsyncMock)
    def test_generate_stamps_owner_for_owned_notebook(
        self, mock_nb_get, mock_submit, monkeypatch
    ):
        mock_nb_get.return_value = Notebook(
            id="notebook:1", name="N", description="D", user_id="user:a"
        )
        mock_submit.return_value = "command:1"
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.post(
            "/api/podcasts/generate",
            json={
                "episode_profile": "default",
                "speaker_profile": "default",
                "episode_name": "Ep",
                "notebook_id": "notebook:1",
            },
        )

        assert response.status_code == 200
        _, kwargs = mock_submit.call_args
        assert kwargs["user_id"] == "user:a"
        assert kwargs["client_id"] == "client-1"


class TestPodcastListOwnership:
    @patch("api.routers.podcasts.PodcastService.list_episodes", new_callable=AsyncMock)
    def test_list_hides_episodes_not_owned_by_current_user(
        self, mock_list, monkeypatch
    ):
        mock_list.return_value = [
            _episode("episode:mine", user_id="user:a"),
            _episode("episode:theirs", user_id="user:b"),
        ]
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/podcasts/episodes")

        assert response.status_code == 200
        assert [ep["id"] for ep in response.json()] == ["episode:mine"]

    @patch("api.routers.podcasts.PodcastService.list_episodes", new_callable=AsyncMock)
    def test_list_unfiltered_when_auth_disabled(self, mock_list, monkeypatch):
        mock_list.return_value = [
            _episode("episode:a", user_id="user:a"),
            _episode("episode:b", user_id="user:b"),
        ]
        client = _client(monkeypatch, auth_enabled=False, user=None)

        response = client.get("/api/podcasts/episodes")

        assert response.status_code == 200
        assert len(response.json()) == 2
