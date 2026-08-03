"""Owner-only access to notebooks and sources (WP2 §4).

Mocked at the domain/repository boundary (same style as
tests/characterization/test_notebook_crud_characterization.py) so the real
routers, ownership helpers and response models run without a live SurrealDB.
"""

from typing import Optional
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.auth.types import AuthenticatedUser
from api.routers import notebooks, sources
from open_notebook.domain.notebook import Notebook, Source

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

    app.include_router(notebooks.router, prefix="/api")
    app.include_router(sources.router, prefix="/api")
    return TestClient(app)


def _notebook_row(notebook_id="notebook:1", name="N", user_id=None):
    return {
        "id": notebook_id,
        "name": name,
        "description": "",
        "archived": False,
        "created": "2026-01-01T00:00:00Z",
        "updated": "2026-01-02T00:00:00Z",
        "source_count": 0,
        "note_count": 0,
        "user_id": user_id,
    }


class TestNotebookCreateStamping:
    def test_stamps_user_and_client_id_when_user_present(self, monkeypatch):
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)
        saved = []

        async def capture_save(self_nb):
            saved.append(self_nb)
            self_nb.id = "notebook:new"

        with patch.object(Notebook, "save", autospec=True, side_effect=capture_save):
            response = client.post(
                "/api/notebooks", json={"name": "Mine", "description": "d"}
            )

        assert response.status_code == 200
        assert saved[0].user_id == "user:a"
        assert saved[0].client_id == "client-1"

    def test_does_not_stamp_when_auth_disabled(self, monkeypatch):
        """Open/password-disabled mode: no user, no stamp - today's behaviour."""
        client = _client(monkeypatch, auth_enabled=False, user=None)
        saved = []

        async def capture_save(self_nb):
            saved.append(self_nb)
            self_nb.id = "notebook:new"

        with patch.object(Notebook, "save", autospec=True, side_effect=capture_save):
            response = client.post(
                "/api/notebooks", json={"name": "Global", "description": "d"}
            )

        assert response.status_code == 200
        assert saved[0].user_id is None
        assert saved[0].client_id is None


class TestNotebookList:
    @patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
    def test_filters_by_current_user_when_auth_enabled(self, mock_query, monkeypatch):
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        client.get("/api/notebooks")

        query_str, params = mock_query.call_args.args
        assert "user_id = $owner_id" in query_str
        assert str(params["owner_id"]) == "user:a"

    @patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
    def test_no_filter_when_auth_disabled(self, mock_query, monkeypatch):
        """Password-disabled (today's) mode keeps the global, unfiltered list."""
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=False, user=None)

        client.get("/api/notebooks")

        query_str, params = mock_query.call_args.args
        assert "user_id" not in query_str
        assert params == {}


class TestNotebookGetOwnership:
    @patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
    def test_owner_can_get_own_notebook(self, mock_query, monkeypatch):
        mock_query.side_effect = [[_notebook_row(user_id="user:a")], []]
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/notebooks/notebook:1")

        assert response.status_code == 200

    @patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
    def test_other_user_gets_404_not_403(self, mock_query, monkeypatch):
        """User B cannot see user A's notebook - and gets 404, not 403 (no
        existence leak, per WP2 §4)."""
        mock_query.return_value = [_notebook_row(user_id="user:a")]
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.get("/api/notebooks/notebook:1")

        assert response.status_code == 404
        assert response.json()["detail"] == "Notebook not found"

    @patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
    def test_null_owner_hidden_when_auth_enabled(self, mock_query, monkeypatch):
        """Pre-migration rows (user_id=NULL) are hidden, fail-closed."""
        mock_query.return_value = [_notebook_row(user_id=None)]
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/notebooks/notebook:1")

        assert response.status_code == 404

    @patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
    def test_visible_to_anyone_when_auth_disabled(self, mock_query, monkeypatch):
        mock_query.side_effect = [[_notebook_row(user_id="user:a")], []]
        client = _client(monkeypatch, auth_enabled=False, user=None)

        response = client.get("/api/notebooks/notebook:1")

        assert response.status_code == 200


class TestNotebookUpdateDeleteOwnership:
    @patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
    def test_update_by_non_owner_returns_404(self, mock_get, monkeypatch):
        notebook = Notebook(name="N", description="D", user_id="user:a")
        notebook.id = "notebook:1"
        mock_get.return_value = notebook
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.put("/api/notebooks/notebook:1", json={"name": "x"})

        assert response.status_code == 404

    @patch("api.routers.notebooks.Notebook.delete", new_callable=AsyncMock)
    @patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
    def test_delete_by_non_owner_returns_404(self, mock_get, mock_delete, monkeypatch):
        notebook = Notebook(name="N", description="D", user_id="user:a")
        notebook.id = "notebook:1"
        mock_get.return_value = notebook
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.delete("/api/notebooks/notebook:1")

        assert response.status_code == 404
        mock_delete.assert_not_awaited()

    @patch("api.routers.notebooks.Notebook.delete", new_callable=AsyncMock)
    @patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
    def test_owner_can_delete(self, mock_get, mock_delete, monkeypatch):
        notebook = Notebook(name="N", description="D", user_id="user:a")
        notebook.id = "notebook:1"
        mock_get.return_value = notebook
        mock_delete.return_value = {
            "deleted_notes": 0,
            "deleted_sources": 0,
            "unlinked_sources": 0,
            "deleted_chat_sessions": 0,
        }
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.delete("/api/notebooks/notebook:1")

        assert response.status_code == 200


class TestSourceCreateStamping:
    @patch("api.routers.sources.CommandService.submit_command_job", new_callable=AsyncMock)
    def test_stamps_user_and_client_id(self, mock_submit, monkeypatch):
        # async_processing=True routes through _create_source_async_path,
        # which only needs Source.save() and command submission mocked -
        # unlike the sync path it never touches execute_command_sync.
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)
        saved = []
        mock_submit.return_value = "command:1"

        async def capture_save(self_src):
            saved.append(Source(**self_src.model_dump()))
            self_src.id = "source:new"

        with patch.object(Source, "save", autospec=True, side_effect=capture_save):
            response = client.post(
                "/api/sources/json",
                json={
                    "type": "text",
                    "content": "hello",
                    "notebooks": [],
                    "async_processing": True,
                },
            )

        assert response.status_code == 200
        assert saved[0].user_id == "user:a"
        assert saved[0].client_id == "client-1"


class TestSourceGetOwnership:
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    def test_other_user_gets_404(self, mock_get, monkeypatch):
        source = Source(user_id="user:a")
        source.id = "source:1"
        mock_get.return_value = source
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.get("/api/sources/source:1")

        assert response.status_code == 404
        assert response.json()["detail"] == "Source not found"

    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    def test_owner_can_get(self, mock_get, mock_query, monkeypatch):
        source = Source(user_id="user:a")
        source.id = "source:1"
        mock_get.return_value = source
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        response = client.get("/api/sources/source:1")

        assert response.status_code == 200


class TestSourceUpdateDeleteOwnership:
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    def test_update_by_non_owner_returns_404(self, mock_get, monkeypatch):
        source = Source(user_id="user:a")
        source.id = "source:1"
        mock_get.return_value = source
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.put("/api/sources/source:1", json={"title": "x"})

        assert response.status_code == 404

    @patch("api.routers.sources.Source.delete", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    def test_delete_by_non_owner_returns_404(self, mock_get, mock_delete, monkeypatch):
        source = Source(user_id="user:a")
        source.id = "source:1"
        mock_get.return_value = source
        client = _client(monkeypatch, auth_enabled=True, user=USER_B)

        response = client.delete("/api/sources/source:1")

        assert response.status_code == 404
        mock_delete.assert_not_awaited()


class TestSourceList:
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    def test_filters_by_current_user_when_auth_enabled(self, mock_query, monkeypatch):
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=True, user=USER_A)

        client.get("/api/sources")

        query_str, params = mock_query.call_args.args
        assert "user_id = $owner_id" in query_str
        assert str(params["owner_id"]) == "user:a"

    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    def test_no_filter_when_auth_disabled(self, mock_query, monkeypatch):
        mock_query.return_value = []
        client = _client(monkeypatch, auth_enabled=False, user=None)

        client.get("/api/sources")

        query_str, _params = mock_query.call_args.args
        assert "user_id" not in query_str
