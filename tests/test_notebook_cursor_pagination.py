"""Backend tests for the Notebook library keyset pagination route.

Task 2 of the library keyset pagination plan:
docs/superpowers/plans/2026-08-17-library-keyset-pagination.md

The library route must:

- Never emit ``START`` / ``OFFSET`` - cursor pagination only.
- Use the selected sort field plus ``id`` as a deterministic tie-break.
- Apply access + ``archived`` + case-insensitive ``query`` filters *in
  SurrealQL* before the keyset predicate, so a page from ``archived=false``
  cannot contain archived notebooks (and vice versa).
- Fetch ``limit + 1`` and issue ``next_cursor`` only when the extra row exists.
- Reject malformed / oversized / wrong-version / mismatched-filter cursors
  with HTTP 400.
"""

from __future__ import annotations

import base64
import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import notebooks


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(notebooks.router, prefix="/api")
    return TestClient(app)


def _row(idx: int, **overrides: Any) -> dict[str, Any]:
    """Row shape SurrealQL returns for the library query."""
    row: dict[str, Any] = {
        "id": f"notebook:n{idx:04d}",
        "name": f"Notebook {idx}",
        "description": "",
        "archived": False,
        "created": "2026-01-01T00:00:00Z",
        "updated": f"2026-02-{(idx % 28) + 1:02d}T00:00:00Z",
        "name_sort": f"notebook {idx}",
        "source_count": 0,
        "note_count": 0,
        "user_id": None,
    }
    row.update(overrides)
    return row


def _decode_cursor(token: str) -> dict[str, Any]:
    padded = token + "=" * (-len(token) % 4)
    return json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))


def _forge_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_first_page_returns_thirty_items_and_next_cursor(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """A 31st row exists -- expose 30 items and issue ``next_cursor``."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    response = _client().get(
        "/api/notebooks/library?archived=false&limit=30&sort_by=updated&sort_order=desc"
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 30
    assert payload["next_cursor"] is not None

    assert mock_query.await_count == 1
    query_sql, params = mock_query.await_args.args
    assert "OFFSET" not in query_sql.upper()
    assert "START" not in query_sql.upper()
    # Fetches limit + 1 internally.
    assert params["limit"] == 31


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_no_next_cursor_when_page_is_not_full(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(5)]

    response = _client().get("/api/notebooks/library?archived=false&limit=30")

    assert response.status_code == 200
    assert response.json()["next_cursor"] is None
    assert len(response.json()["items"]) == 5


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_second_page_excludes_first_page_rows(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """Cursor from page 1 -> page 2 uses (value, id) keyset predicate."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    first = [_row(i) for i in range(31)]
    mock_query.return_value = first

    first_resp = _client().get(
        "/api/notebooks/library?archived=false&limit=30&sort_by=updated&sort_order=desc"
    )
    cursor = first_resp.json()["next_cursor"]
    assert cursor

    mock_query.reset_mock()
    mock_query.return_value = [_row(100 + i) for i in range(2)]

    second_resp = _client().get(
        f"/api/notebooks/library?archived=false&limit=30&sort_by=updated&sort_order=desc&cursor={cursor}"
    )
    assert second_resp.status_code == 200

    query_sql, params = mock_query.await_args.args
    assert "$cursor_value" in query_sql
    assert "$cursor_id" in query_sql
    # Descending: strictly less than the boundary, with id tiebreak.
    assert "<" in query_sql
    boundary = first[29]
    assert params["cursor_value"] == boundary["updated"]
    assert str(params["cursor_id"]) == boundary["id"]


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_ascending_order_uses_greater_than_predicate(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    resp = _client().get(
        "/api/notebooks/library?archived=false&limit=30&sort_by=name&sort_order=asc"
    )
    cursor = resp.json()["next_cursor"]

    mock_query.reset_mock()
    mock_query.return_value = []
    _client().get(
        f"/api/notebooks/library?archived=false&limit=30&sort_by=name&sort_order=asc&cursor={cursor}"
    )

    query_sql, _ = mock_query.await_args.args
    assert ">" in query_sql
    assert "> $cursor_value OR" in query_sql or "> $cursor_id" in query_sql


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_id_tiebreak_when_primary_values_are_equal(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """The generated ORDER BY must include ``id`` as a second sort key."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = []

    _client().get(
        "/api/notebooks/library?archived=false&sort_by=updated&sort_order=desc&limit=10"
    )

    query_sql, _ = mock_query.await_args.args
    upper = query_sql.upper()
    assert "ORDER BY UPDATED DESC, ID DESC" in upper


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_access_and_query_filters_run_before_keyset(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """Access WHERE and name query must live in WHERE before the cursor
    predicate. A cursor from user A must never leak into user B's page."""
    mock_access.return_value = ("user_id = $access_uid", {"access_uid": "user:a"})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    first = _client().get(
        "/api/notebooks/library?archived=false&query=Research&sort_by=updated&sort_order=desc"
    )
    cursor = first.json()["next_cursor"]

    mock_query.reset_mock()
    mock_query.return_value = []
    _client().get(
        f"/api/notebooks/library?archived=false&query=Research&sort_by=updated&sort_order=desc&cursor={cursor}"
    )

    query_sql, params = mock_query.await_args.args
    assert "user_id = $access_uid" in query_sql
    assert "$name_query" in query_sql
    assert params["access_uid"] == "user:a"
    assert params["name_query"] == "research"
    assert "$cursor_value" in query_sql


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_archived_filter_is_in_surrealql(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """The ``archived`` filter must be pushed into SurrealQL, not applied in
    Python. Filtering in Python after a limit fetches inaccessible rows and
    breaks pagination boundaries."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = []

    _client().get("/api/notebooks/library?archived=true&limit=5")
    query_sql, params = mock_query.await_args.args
    assert "archived" in query_sql
    assert params.get("archived") is True

    mock_query.reset_mock()
    _client().get("/api/notebooks/library?archived=false&limit=5")
    query_sql, params = mock_query.await_args.args
    assert "archived" in query_sql
    assert params.get("archived") is False


@patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock)
@patch("api.routers.notebooks.access_where", new_callable=AsyncMock)
@patch("api.routers.notebooks.repo_query", new_callable=AsyncMock)
def test_active_and_archived_are_isolated(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """A cursor issued against archived=false cannot fetch archived=true.

    The filter fingerprint includes ``archived``, so the cursor's fp will
    not match a request with a different archived state - HTTP 400.
    """
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    active = _client().get(
        "/api/notebooks/library?archived=false&sort_by=updated&sort_order=desc&limit=30"
    )
    cursor = active.json()["next_cursor"]
    assert cursor

    resp = _client().get(
        f"/api/notebooks/library?archived=true&sort_by=updated&sort_order=desc&limit=30&cursor={cursor}"
    )
    assert resp.status_code == 400


@pytest.mark.parametrize(
    "sort_by,direction",
    [
        (field, direction)
        for field in ("name", "created", "updated")
        for direction in ("asc", "desc")
    ],
)
def test_all_three_sort_fields_both_directions(sort_by: str, direction: str) -> None:
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch(
            "api.routers.notebooks.access_where", new_callable=AsyncMock
        ) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = []

        resp = _client().get(
            f"/api/notebooks/library?archived=false&sort_by={sort_by}&sort_order={direction}&limit=5"
        )
        assert resp.status_code == 200
        query_sql, _ = mock_query.await_args.args
        # ``name`` uses a case-insensitive alias, other fields sort directly.
        expected_field = "name_sort" if sort_by == "name" else sort_by
        assert (
            f"ORDER BY {expected_field} {direction.upper()}, id {direction.upper()}"
            in query_sql
        )


def test_insert_before_cursor_does_not_shift_next_page() -> None:
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch(
            "api.routers.notebooks.access_where", new_callable=AsyncMock
        ) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None

        first_rows = [_row(i) for i in range(31)]
        mock_query.return_value = first_rows
        first = _client().get(
            "/api/notebooks/library?archived=false&limit=30&sort_by=updated&sort_order=desc"
        )
        cursor = first.json()["next_cursor"]
        boundary = first_rows[29]

        mock_query.reset_mock()
        mock_query.return_value = [_row(50), _row(51)]

        _client().get(
            f"/api/notebooks/library?archived=false&limit=30&sort_by=updated&sort_order=desc&cursor={cursor}"
        )
        _, params = mock_query.await_args.args
        assert params["cursor_value"] == boundary["updated"]
        assert str(params["cursor_id"]) == boundary["id"]


def test_malformed_cursor_returns_400() -> None:
    with (
        patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock),
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock),
    ):
        mock_access.return_value = ("", {})
        resp = _client().get(
            "/api/notebooks/library?archived=false&cursor=!!!not-base64!!!"
        )
        assert resp.status_code == 400


def test_oversized_cursor_returns_400() -> None:
    with (
        patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock),
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock),
    ):
        mock_access.return_value = ("", {})
        oversized = "A" * 5000
        resp = _client().get(
            f"/api/notebooks/library?archived=false&cursor={oversized}"
        )
        assert resp.status_code == 400


def test_wrong_version_cursor_returns_400() -> None:
    with (
        patch("api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock),
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock),
    ):
        mock_access.return_value = ("", {})
        bad = _forge_cursor(
            {
                "v": 999,
                "sort_by": "updated",
                "sort_order": "desc",
                "value": "2026-01-01T00:00:00Z",
                "id": "notebook:n0000",
                "fp": "0" * 64,
            }
        )
        resp = _client().get(
            f"/api/notebooks/library?archived=false&cursor={bad}"
        )
        assert resp.status_code == 400


def test_mismatched_sort_cursor_returns_400() -> None:
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(i) for i in range(31)]

        first = _client().get(
            "/api/notebooks/library?archived=false&sort_by=updated&sort_order=desc&limit=30"
        )
        cursor = first.json()["next_cursor"]
        assert cursor

        resp = _client().get(
            f"/api/notebooks/library?archived=false&sort_by=name&sort_order=desc&limit=30&cursor={cursor}"
        )
        assert resp.status_code == 400


def test_mismatched_filter_fingerprint_returns_400() -> None:
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(i) for i in range(31)]

        first = _client().get(
            "/api/notebooks/library?archived=false&query=alpha&sort_by=updated&sort_order=desc&limit=30"
        )
        cursor = first.json()["next_cursor"]
        assert cursor

        resp = _client().get(
            f"/api/notebooks/library?archived=false&query=beta&sort_by=updated&sort_order=desc&limit=30&cursor={cursor}"
        )
        assert resp.status_code == 400


def test_no_start_or_offset_in_generated_sql() -> None:
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = []

        _client().get(
            "/api/notebooks/library?archived=false&limit=30&sort_by=updated&sort_order=desc"
        )
        query_sql, _ = mock_query.await_args.args
        assert "OFFSET" not in query_sql.upper()
        assert "START" not in query_sql.upper()


def test_next_cursor_payload_is_versioned_and_typed() -> None:
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(i) for i in range(31)]

        resp = _client().get(
            "/api/notebooks/library?archived=false&sort_by=updated&sort_order=desc&limit=30"
        )
        cursor = resp.json()["next_cursor"]
        decoded = _decode_cursor(cursor)
        assert decoded["v"] == 1
        assert decoded["sort_by"] == "updated"
        assert decoded["sort_order"] == "desc"
        assert "value" in decoded
        assert "id" in decoded
        assert "fp" in decoded


def test_source_and_note_counts_are_preserved() -> None:
    """The route must keep the source_count/note_count computation from the
    existing complete-list ``/notebooks`` endpoint - callers rely on them."""
    with (
        patch(
            "api.routers.notebooks.access_summary_for_notebook", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.notebooks.access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.notebooks.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(0, source_count=4, note_count=2)]

        resp = _client().get("/api/notebooks/library?archived=false")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["source_count"] == 4
        assert item["note_count"] == 2

        query_sql, _ = mock_query.await_args.args
        # The projection must compute these in SurrealQL, mirroring the
        # existing complete-list route.
        assert "source_count" in query_sql
        assert "note_count" in query_sql
