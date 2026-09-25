"""Authorization and eligibility tests for the source-files routes.

Task 5 Step 1 of the retention governance plan
(docs/superpowers/plans/2026-09-01-original-file-retention-governance.md).

Covers:

- ``GET /source-files/policy`` returns safe policy summary + is_admin.
- ``GET /source-files/cleanup-preview`` requires admin for scope=all and
  owner-cleanup permission for scope=mine.
- ``POST /source-files/cleanup`` enforces the same gates and returns
  ``eligible_count`` alongside a job id.
- ``DELETE /sources/{id}/original-file`` allows admin OR owner+policy;
  concealment (404 instead of 403) for non-owners.
- Generic ``POST /commands/jobs`` refuses ``cleanup_original_files``
  (403) so an authenticated non-admin can't bypass the specialized
  route.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.auth.types import AuthenticatedUser
from api.routers import commands as commands_router
from api.routers import source_files, sources


class EnabledAuthProvider:
    def auth_enabled(self) -> bool:
        return True


def _make_settings(
    *,
    policy: str = "user_choice",
    default_action: str = "keep",
    allow_owner_cleanup: bool = False,
):
    return SimpleNamespace(
        original_file_policy=policy,
        original_file_user_default=default_action,
        allow_source_owner_cleanup=allow_owner_cleanup,
    )


def _client(monkeypatch, *, user_role: str = "user"):
    """Build a FastAPI TestClient with a controlled authenticated user."""
    import api.auth.factory

    monkeypatch.setattr(
        api.auth.factory, "build_auth_provider", lambda: EnabledAuthProvider()
    )
    app = FastAPI()

    @app.middleware("http")
    async def stamp_user(request: Request, call_next):
        request.state.user = AuthenticatedUser(
            id="user:me",
            email="me@example.com",
            display_name="Me",
            role=user_role,  # type: ignore[arg-type]
            entra_oid=None,
            client_id="client-1",
        )
        return await call_next(request)

    app.include_router(source_files.router, prefix="/api")
    app.include_router(sources.router, prefix="/api")
    app.include_router(commands_router.router, prefix="/api")
    return TestClient(app)


# ---- /source-files/policy ---------------------------------------------------


@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_policy_endpoint_admin_reports_admin_flag(mock_settings, monkeypatch):
    mock_settings.return_value = _make_settings(
        policy="user_choice", default_action="delete_after_processing", allow_owner_cleanup=True
    )
    r = _client(monkeypatch, user_role="admin").get("/api/source-files/policy")
    assert r.status_code == 200
    body = r.json()
    assert body["original_file_policy"] == "user_choice"
    assert body["original_file_user_default"] == "delete_after_processing"
    assert body["allow_source_owner_cleanup"] is True
    assert body["owner_can_cleanup_own"] is True
    assert body["is_admin"] is True


@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_policy_endpoint_regular_user_is_not_admin(mock_settings, monkeypatch):
    mock_settings.return_value = _make_settings()
    r = _client(monkeypatch, user_role="user").get("/api/source-files/policy")
    assert r.status_code == 200
    assert r.json()["is_admin"] is False


# ---- /source-files/cleanup-preview -----------------------------------------


@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_preview_scope_all_requires_admin(mock_settings, mock_query, monkeypatch):
    mock_settings.return_value = _make_settings()
    r = _client(monkeypatch, user_role="user").get(
        "/api/source-files/cleanup-preview?scope=all"
    )
    assert r.status_code == 403
    # Query must not have run — auth is checked before candidate selection.
    mock_query.assert_not_awaited()


@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_preview_scope_mine_needs_owner_cleanup_enabled(
    mock_settings, mock_query, monkeypatch
):
    mock_settings.return_value = _make_settings(allow_owner_cleanup=False)
    mock_query.return_value = []
    r = _client(monkeypatch, user_role="user").get(
        "/api/source-files/cleanup-preview?scope=mine"
    )
    # Policy disabled → return zeros (no leak of whether anything exists).
    assert r.status_code == 200
    body = r.json()
    assert body["eligible_count"] == 0
    assert body["eligible_bytes"] == 0


@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_preview_returns_counts_and_bytes_only(
    mock_settings, mock_query, monkeypatch
):
    mock_settings.return_value = _make_settings(allow_owner_cleanup=True)
    mock_query.return_value = [
        {"id": "source:1", "user_id": "user:me", "size": 100},
        {"id": "source:2", "user_id": "user:me", "size": 200},
    ]
    r = _client(monkeypatch, user_role="user").get(
        "/api/source-files/cleanup-preview?scope=mine"
    )
    assert r.status_code == 200
    body = r.json()
    assert body == {"scope": "mine", "eligible_count": 2, "eligible_bytes": 300}
    # No titles, filenames, owners, or paths in the response.
    assert "title" not in body
    assert "filename" not in body
    assert "path" not in body


@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_preview_includes_provider_backed_originals_without_file_path(
    mock_settings, mock_query, monkeypatch
):
    mock_settings.return_value = _make_settings(allow_owner_cleanup=True)
    mock_query.return_value = [
        {"id": "source:remote", "user_id": "user:me", "size": 100}
    ]

    r = _client(monkeypatch, user_role="user").get(
        "/api/source-files/cleanup-preview?scope=mine"
    )

    assert r.status_code == 200
    assert r.json()["eligible_count"] == 1
    query = mock_query.await_args.args[0]
    assert "asset.original_file_store != NONE" in query
    assert "asset.original_file_key != NONE" in query


# ---- POST /source-files/cleanup --------------------------------------------


@patch("api.routers.source_files.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_submit_cleanup_all_is_admin_only(
    mock_settings, mock_query, mock_submit, monkeypatch
):
    mock_settings.return_value = _make_settings()
    r = _client(monkeypatch, user_role="user").post(
        "/api/source-files/cleanup", json={"scope": "all"}
    )
    assert r.status_code == 403
    mock_submit.assert_not_awaited()


@patch("api.routers.source_files.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_submit_cleanup_admin_returns_job_id_and_count(
    mock_settings, mock_query, mock_submit, monkeypatch
):
    mock_settings.return_value = _make_settings()
    mock_query.return_value = [
        {"id": "source:a", "user_id": "user:x", "size": 10},
        {"id": "source:b", "user_id": "user:y", "size": 20},
    ]
    mock_submit.return_value = "command:job-123"
    r = _client(monkeypatch, user_role="admin").post(
        "/api/source-files/cleanup", json={"scope": "all"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["job_id"] == "command:job-123"
    assert body["scope"] == "all"
    assert body["eligible_count"] == 2
    # The command must be submitted through the specialized route only.
    mock_submit.assert_awaited_once()
    args, kwargs = mock_submit.await_args
    assert kwargs.get("command_name") == "cleanup_original_files" or (
        len(args) >= 2 and args[1] == "cleanup_original_files"
    )


@patch("api.routers.source_files.repo_query", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_submit_cleanup_mine_forbidden_when_owner_cleanup_disabled(
    mock_settings, mock_query, monkeypatch
):
    mock_settings.return_value = _make_settings(allow_owner_cleanup=False)
    r = _client(monkeypatch, user_role="user").post(
        "/api/source-files/cleanup", json={"scope": "mine"}
    )
    assert r.status_code == 403


# ---- DELETE /sources/{id}/original-file ------------------------------------


@patch("api.routers.source_files.delete_original_file", new_callable=AsyncMock)
@patch("api.routers.source_files.Source.get", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_single_delete_admin_can_delete_any_source(
    mock_settings, mock_source, mock_delete, monkeypatch
):
    mock_settings.return_value = _make_settings()
    mock_source.return_value = SimpleNamespace(
        id="source:1",
        user_id="user:other",
        asset=SimpleNamespace(
            file_path=None,
            url=None,
            original_filename="doc.pdf",
            original_size_bytes=10,
            original_file_action="delete_after_processing",
            original_deletion_started_at=None,
            original_deleted_at=None,
            original_deleted_reason=None,
        ),
    )
    mock_delete.return_value = "deleted"
    r = _client(monkeypatch, user_role="admin").delete(
        "/api/sources/source:1/original-file"
    )
    assert r.status_code == 200
    assert r.json()["outcome"] == "deleted"
    args, kwargs = mock_delete.await_args
    assert kwargs.get("reason") == "admin_cleanup"


@patch("api.routers.source_files.delete_original_file", new_callable=AsyncMock)
@patch("api.routers.source_files.Source.get", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_single_delete_non_owner_conceals_as_404(
    mock_settings, mock_source, mock_delete, monkeypatch
):
    """A non-admin who does not own the source gets 404 (not 403) — the
    plan explicitly says to match the concealing-inaccessible-resources
    convention rather than disclose existence."""
    mock_settings.return_value = _make_settings(allow_owner_cleanup=True)
    mock_source.return_value = SimpleNamespace(
        id="source:1",
        user_id="user:someone_else",
        asset=SimpleNamespace(
            file_path=None,
            url=None,
            original_filename="doc.pdf",
            original_size_bytes=10,
            original_file_action=None,
            original_deletion_started_at=None,
            original_deleted_at=None,
            original_deleted_reason=None,
        ),
    )
    r = _client(monkeypatch, user_role="user").delete(
        "/api/sources/source:1/original-file"
    )
    assert r.status_code == 404
    mock_delete.assert_not_awaited()


@patch("api.routers.source_files.delete_original_file", new_callable=AsyncMock)
@patch("api.routers.source_files.Source.get", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_single_delete_owner_forbidden_when_owner_cleanup_disabled(
    mock_settings, mock_source, mock_delete, monkeypatch
):
    mock_settings.return_value = _make_settings(allow_owner_cleanup=False)
    mock_source.return_value = SimpleNamespace(
        id="source:1",
        user_id="user:me",
        asset=SimpleNamespace(
            file_path=None,
            url=None,
            original_filename="doc.pdf",
            original_size_bytes=10,
            original_file_action=None,
            original_deletion_started_at=None,
            original_deleted_at=None,
            original_deleted_reason=None,
        ),
    )
    r = _client(monkeypatch, user_role="user").delete(
        "/api/sources/source:1/original-file"
    )
    assert r.status_code == 403
    mock_delete.assert_not_awaited()


@patch("api.routers.source_files.delete_original_file", new_callable=AsyncMock)
@patch("api.routers.source_files.Source.get", new_callable=AsyncMock)
@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_single_delete_owner_records_source_owner_reason(
    mock_settings, mock_source, mock_delete, monkeypatch
):
    mock_settings.return_value = _make_settings(allow_owner_cleanup=True)
    mock_source.return_value = SimpleNamespace(
        id="source:1",
        user_id="user:me",
        asset=SimpleNamespace(
            file_path=None,
            url=None,
            original_filename="doc.pdf",
            original_size_bytes=10,
            original_file_action="delete_after_processing",
            original_deletion_started_at=None,
            original_deleted_at=None,
            original_deleted_reason=None,
        ),
    )
    mock_delete.return_value = "deleted"
    r = _client(monkeypatch, user_role="user").delete(
        "/api/sources/source:1/original-file"
    )
    assert r.status_code == 200
    args, kwargs = mock_delete.await_args
    assert kwargs.get("reason") == "source_owner"


# ---- Internal-command block ------------------------------------------------


def test_generic_commands_route_refuses_internal_cleanup(monkeypatch):
    """The internal command name is off-limits to the generic submitter.
    Only /source-files/cleanup may enqueue it, so it can enforce policy."""
    r = _client(monkeypatch, user_role="admin").post(
        "/api/commands/jobs",
        json={
            "command": "cleanup_original_files",
            "app": "open_notebook",
            "input": {"scope": "all"},
        },
    )
    assert r.status_code == 403


# ---- Missing settings row (fresh install) ----------------------------------


@patch("api.routers.source_files.ContentSettings.get_instance", new_callable=AsyncMock)
def test_policy_endpoint_survives_missing_settings(mock_settings, monkeypatch):
    """The policy endpoint must not 500 when ContentSettings hasn't been
    initialized yet — a fresh install must render the settings form."""
    from open_notebook.exceptions import DatabaseOperationError

    mock_settings.side_effect = DatabaseOperationError("no settings row")
    r = _client(monkeypatch, user_role="admin").get("/api/source-files/policy")
    # Fresh installs (or a DB blip) must not 500 the Settings screen —
    # the admin needs this endpoint to render the policy form itself.
    assert r.status_code == 200
    body = r.json()
    assert body["original_file_policy"] == "always_keep"
    assert body["original_file_user_default"] == "keep"
    assert body["allow_source_owner_cleanup"] is False


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-q"])
