"""Idempotent link/unlink of source ↔ notebook (plan
2026-08-13-source-notebook-relationship-integrity).

The `reference` edge is defined in migration 1 as
    DEFINE TABLE reference TYPE RELATION FROM source TO notebook;
so in SurrealDB the row stores `in = source, out = notebook`. The link
endpoint's existing-edge lookup and the unlink endpoint's DELETE must match
that direction, and re-issuing the same link must not create a second edge.

Repository is mocked at `repo_query`; a real SurrealDB isn't in scope here.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.database.repository import ensure_record_id


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _mock_notebook(notebook_id: str = "notebook:1") -> MagicMock:
    nb = MagicMock()
    nb.id = notebook_id
    nb.user_id = None
    return nb


def _mock_source(source_id: str = "source:1") -> MagicMock:
    src = MagicMock()
    src.id = source_id
    src.user_id = None
    return src


def _select_calls(mock_query: AsyncMock) -> list:
    return [c for c in mock_query.call_args_list if "SELECT" in c.args[0].upper()]


def _relate_calls(mock_query: AsyncMock) -> list:
    return [c for c in mock_query.call_args_list if "RELATE" in c.args[0].upper()]


def _delete_calls(mock_query: AsyncMock) -> list:
    return [c for c in mock_query.call_args_list if "DELETE" in c.args[0].upper()]


@pytest.mark.asyncio
@patch("api.ownership.assert_can_view_source_or_404", new_callable=AsyncMock)
@patch("api.routers.notebooks.assert_can_edit_notebook_or_403", new_callable=AsyncMock)
@patch("api.routers.notebooks.Source.get", new_callable=AsyncMock)
@patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
async def test_add_source_looks_up_edge_with_in_source_out_notebook(
    mock_query, mock_nb_get, mock_src_get, mock_edit, mock_view, client
):
    """The existing-edge lookup must key on `in = source, out = notebook`."""
    mock_nb_get.return_value = _mock_notebook()
    mock_src_get.return_value = _mock_source()
    mock_query.return_value = []  # no existing edge

    resp = client.post("/api/notebooks/notebook:1/sources/source:1")
    assert resp.status_code == 200

    selects = _select_calls(mock_query)
    assert selects, "expected an existing-edge SELECT"
    sql, params = selects[0].args
    # Predicate must be in=source AND out=notebook (schema direction).
    assert "in = $source_id" in sql
    assert "out = $notebook_id" in sql
    # No reversed variant.
    assert "out = $source_id" not in sql
    assert "in = $notebook_id" not in sql
    assert params["source_id"] == ensure_record_id("source:1")
    assert params["notebook_id"] == ensure_record_id("notebook:1")


@pytest.mark.asyncio
@patch("api.ownership.assert_can_view_source_or_404", new_callable=AsyncMock)
@patch("api.routers.notebooks.assert_can_edit_notebook_or_403", new_callable=AsyncMock)
@patch("api.routers.notebooks.Source.get", new_callable=AsyncMock)
@patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
async def test_repeated_link_is_idempotent(
    mock_query, mock_nb_get, mock_src_get, mock_edit, mock_view, client
):
    """Second POST for the same (source, notebook) must not issue RELATE."""
    mock_nb_get.return_value = _mock_notebook()
    mock_src_get.return_value = _mock_source()

    # First call: lookup empty → RELATE fires. Second call: lookup hits → skip.
    stored: list = []

    async def fake_query(sql: str, params: dict | None = None):
        up = sql.upper()
        if up.startswith("SELECT"):
            return list(stored)
        if up.startswith("RELATE"):
            stored.append({"id": "reference:xyz"})
            return [{"id": "reference:xyz"}]
        return []

    mock_query.side_effect = fake_query

    r1 = client.post("/api/notebooks/notebook:1/sources/source:1")
    r2 = client.post("/api/notebooks/notebook:1/sources/source:1")
    assert r1.status_code == 200 and r2.status_code == 200

    relates = _relate_calls(mock_query)
    assert len(relates) == 1, (
        f"RELATE should fire exactly once across two identical link calls, "
        f"got {len(relates)}"
    )


@pytest.mark.asyncio
@patch("api.routers.notebooks.assert_can_edit_notebook_or_403", new_callable=AsyncMock)
@patch("api.routers.notebooks.Notebook.get", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
async def test_remove_source_uses_in_source_out_notebook(
    mock_query, mock_nb_get, mock_edit, client
):
    """The unlink DELETE must key on `in = source, out = notebook`."""
    mock_nb_get.return_value = _mock_notebook()

    resp = client.delete("/api/notebooks/notebook:1/sources/source:1")
    assert resp.status_code == 200

    deletes = _delete_calls(mock_query)
    assert deletes, "expected a DELETE reference query"
    sql, params = deletes[0].args
    assert "in = $source_id" in sql
    assert "out = $notebook_id" in sql
    assert params["source_id"] == ensure_record_id("source:1")
    assert params["notebook_id"] == ensure_record_id("notebook:1")


@pytest.mark.asyncio
@patch("open_notebook.domain.base.repo_relate", new_callable=AsyncMock)
@patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
@patch("open_notebook.domain.notebook.Notebook.get", new_callable=AsyncMock)
async def test_source_add_to_notebook_is_idempotent(
    mock_nb_get, mock_domain_query, mock_relate
):
    """`Source.add_to_notebook` must not duplicate the edge on second call.

    Same guarantee as the endpoint, but at the domain layer — the ingest
    routers (`api/routers/sources.py`) call it directly and would otherwise
    create a second edge (or hit migration 29's unique index and error) if
    the same source is re-added to the same notebook.
    """
    from open_notebook.domain.notebook import Source

    mock_nb_get.return_value = MagicMock(id="notebook:1")

    stored: list = []

    async def fake_query(sql: str, params: dict | None = None):
        return list(stored) if sql.strip().upper().startswith("SELECT") else []

    async def fake_relate(*args, **kwargs):
        stored.append({"id": "reference:xyz"})
        return [{"id": "reference:xyz"}]

    mock_domain_query.side_effect = fake_query
    mock_relate.side_effect = fake_relate

    src = Source(id="source:1", title="s")
    await src.add_to_notebook("notebook:1")
    await src.add_to_notebook("notebook:1")

    assert mock_relate.call_count == 1, (
        f"repo_relate should be called exactly once, got {mock_relate.call_count}"
    )
