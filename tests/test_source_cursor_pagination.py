"""Backend tests for the Source library keyset pagination route.

Task 1 of the library keyset pagination plan:
docs/superpowers/plans/2026-08-17-library-keyset-pagination.md

The library route must:

- Never emit ``START`` / ``OFFSET`` — cursor pagination only.
- Use the selected sort field plus ``id`` as a deterministic tie-break.
- Apply access/text filters *before* the keyset predicate.
- Return at most ``limit`` items and only issue ``next_cursor`` when a page 31
  exists (query fetches ``limit + 1`` internally).
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

from api.routers import sources


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(sources.router, prefix="/api")
    return TestClient(app)


def _row(idx: int, **overrides: Any) -> dict[str, Any]:
    """Row shape SurrealQL returns for the library query.

    We mock repo_query, so this needs to look like what the router expects to
    unpack — the same keys the existing ``/sources`` route reads plus a
    computed cursor value column the library route selects.
    """
    row: dict[str, Any] = {
        "id": f"source:s{idx:04d}",
        "title": f"Source {idx}",
        "topics": [],
        "asset": None,
        "created": "2026-01-01T00:00:00Z",
        "updated": f"2026-02-{(idx % 28) + 1:02d}T00:00:00Z",
        "title_sort": f"source {idx}",
        "type": "text",
        "insights_count": idx,
        "embedded": False,
        "command": None,
        "user_id": None,
    }
    row.update(overrides)
    return row


def _decode_cursor(token: str) -> dict[str, Any]:
    padded = token + "=" * (-len(token) % 4)
    return json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))


@patch("api.routers.sources.access_summary_for_source", new_callable=AsyncMock)
@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_first_page_returns_thirty_items_and_next_cursor(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """A 31st row exists — expose 30 items and issue ``next_cursor``."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    response = _client().get("/api/sources/library?limit=30&sort_by=updated&sort_order=desc")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 30
    assert payload["next_cursor"] is not None

    # Only one repo_query call and it must not use OFFSET/START.
    assert mock_query.await_count == 1
    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "OFFSET" not in query_sql.upper()
    assert "START" not in query_sql.upper()
    # Fetches limit + 1 internally.
    assert params["limit"] == 31


@patch("api.routers.sources.access_summary_for_source", new_callable=AsyncMock)
@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_no_next_cursor_when_page_is_not_full(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """Fewer than ``limit + 1`` rows → no cursor."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(5)]

    response = _client().get("/api/sources/library?limit=30")

    assert response.status_code == 200
    assert response.json()["next_cursor"] is None
    assert len(response.json()["items"]) == 5


@patch("api.routers.sources.access_summary_for_source", new_callable=AsyncMock)
@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_second_page_excludes_first_page_rows(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """The cursor from page 1 → page 2 uses the (value, id) keyset predicate."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    first = [_row(i) for i in range(31)]
    mock_query.return_value = first

    first_resp = _client().get("/api/sources/library?limit=30&sort_by=updated&sort_order=desc")
    cursor = first_resp.json()["next_cursor"]
    assert cursor

    mock_query.reset_mock()
    mock_query.return_value = [_row(100 + i) for i in range(2)]

    second_resp = _client().get(
        f"/api/sources/library?limit=30&sort_by=updated&sort_order=desc&cursor={cursor}"
    )
    assert second_resp.status_code == 200

    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    assert "$cursor_value" in query_sql
    assert "$cursor_id" in query_sql
    # Descending: strictly less than the boundary, with id tiebreak.
    assert "<" in query_sql
    # The 30th row (index 29 in the internal list) is the boundary — page 2
    # must start strictly after it.
    boundary = first[29]
    assert params["cursor_value"] == boundary["updated"]
    assert str(params["cursor_id"]) == boundary["id"]


@patch("api.routers.sources.access_summary_for_source", new_callable=AsyncMock)
@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_ascending_order_uses_greater_than_predicate(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    resp = _client().get("/api/sources/library?limit=30&sort_by=title&sort_order=asc")
    cursor = resp.json()["next_cursor"]

    mock_query.reset_mock()
    mock_query.return_value = []
    _client().get(f"/api/sources/library?limit=30&sort_by=title&sort_order=asc&cursor={cursor}")

    assert mock_query.await_args is not None
    query_sql, _ = mock_query.await_args.args
    assert ">" in query_sql
    # Not descending.
    assert "> $cursor_value OR" in query_sql or "> $cursor_id" in query_sql


@patch("api.routers.sources.access_summary_for_source", new_callable=AsyncMock)
@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_id_tiebreak_when_primary_values_are_equal(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """The generated ORDER BY must include ``id`` as a second sort key."""
    mock_access.return_value = ("", {})
    mock_summary.return_value = None
    mock_query.return_value = []

    _client().get("/api/sources/library?sort_by=updated&sort_order=desc&limit=10")

    assert mock_query.await_args is not None
    query_sql, _ = mock_query.await_args.args
    assert "ORDER BY" in query_sql.upper()
    # Composite key: sort expression, then id, in the same direction.
    assert "id" in query_sql
    upper = query_sql.upper()
    assert "ORDER BY UPDATED DESC, ID DESC" in upper


@patch("api.routers.sources.access_summary_for_source", new_callable=AsyncMock)
@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_access_and_query_filters_run_before_keyset(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
    mock_summary: AsyncMock,
) -> None:
    """Access WHERE and text query must appear before the cursor predicate.

    A cursor from user A must never leak into user B's page.
    """
    mock_access.return_value = ("user_id = $access_uid", {"access_uid": "user:a"})
    mock_summary.return_value = None
    mock_query.return_value = [_row(i) for i in range(31)]

    first = _client().get(
        "/api/sources/library?query=Evidence&sort_by=updated&sort_order=desc"
    )
    cursor = first.json()["next_cursor"]

    mock_query.reset_mock()
    mock_query.return_value = []
    _client().get(
        f"/api/sources/library?query=Evidence&sort_by=updated&sort_order=desc&cursor={cursor}"
    )

    assert mock_query.await_args is not None
    query_sql, params = mock_query.await_args.args
    # The access predicate and title filter live in the WHERE clause, and
    # the cursor predicate is combined with AND — so the access filter is
    # always applied.
    assert "user_id = $access_uid" in query_sql
    assert "$title_query" in query_sql
    assert params["access_uid"] == "user:a"
    assert params["title_query"] == "evidence"
    assert "$cursor_value" in query_sql


def test_insert_before_cursor_does_not_shift_next_page() -> None:
    """A row inserted *before* the cursor boundary (i.e. that would have been
    on page 1) does not shift or duplicate page 2 — the (value, id) keyset
    predicate remains anchored to the boundary row we already returned.
    """
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ) as mock_summary,
        patch(
            "api.routers.sources.source_access_where", new_callable=AsyncMock
        ) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None

        first_rows = [_row(i) for i in range(31)]
        mock_query.return_value = first_rows
        first = _client().get(
            "/api/sources/library?limit=30&sort_by=updated&sort_order=desc"
        )
        cursor = first.json()["next_cursor"]
        boundary = first_rows[29]

        # Simulate: a brand-new row lands between page 1 and page 2. It has
        # a HIGHER updated value than the boundary, so it belongs on page 1
        # — but page 2 must not include it and must not skip anything that
        # came after the boundary.
        mock_query.reset_mock()
        mock_query.return_value = [_row(50), _row(51)]

        _client().get(
            f"/api/sources/library?limit=30&sort_by=updated&sort_order=desc&cursor={cursor}"
        )
        assert mock_query.await_args is not None
        _, params = mock_query.await_args.args
        # Bound predicate is anchored to the boundary from page 1, not the
        # newly-inserted row.
        assert params["cursor_value"] == boundary["updated"]
        assert str(params["cursor_id"]) == boundary["id"]


@pytest.mark.parametrize(
    "sort_by,direction",
    [
        (field, direction)
        for field in ("type", "title", "created", "updated", "insights_count", "embedded")
        for direction in ("asc", "desc")
    ],
)
def test_all_six_sort_fields_both_directions(sort_by: str, direction: str) -> None:
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ) as mock_summary,
        patch(
            "api.routers.sources.source_access_where", new_callable=AsyncMock
        ) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = []

        resp = _client().get(
            f"/api/sources/library?sort_by={sort_by}&sort_order={direction}&limit=5"
        )
        assert resp.status_code == 200
        assert mock_query.await_args is not None
        query_sql, _ = mock_query.await_args.args
        # `title` uses the case-insensitive title_sort alias — mirror the
        # existing /sources route's mapping.
        expected_field = "title_sort" if sort_by == "title" else sort_by
        assert f"ORDER BY {expected_field} {direction.upper()}, id {direction.upper()}" in query_sql


def _forge_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def test_malformed_cursor_returns_400() -> None:
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ),
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock),
    ):
        mock_access.return_value = ("", {})
        resp = _client().get("/api/sources/library?cursor=!!!not-base64!!!")
        assert resp.status_code == 400


def test_oversized_cursor_returns_400() -> None:
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ),
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock),
    ):
        mock_access.return_value = ("", {})
        oversized = "A" * 5000  # far larger than any legitimate cursor
        resp = _client().get(f"/api/sources/library?cursor={oversized}")
        assert resp.status_code == 400


def test_wrong_version_cursor_returns_400() -> None:
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ),
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock),
    ):
        mock_access.return_value = ("", {})
        bad = _forge_cursor(
            {
                "v": 999,
                "sort_by": "updated",
                "sort_order": "desc",
                "value": "2026-01-01T00:00:00Z",
                "id": "source:s0000",
                "fp": "0" * 64,
            }
        )
        resp = _client().get(f"/api/sources/library?cursor={bad}")
        assert resp.status_code == 400


def test_mismatched_sort_cursor_returns_400() -> None:
    """A cursor issued for sort=updated must not be reused with sort=title."""
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(i) for i in range(31)]

        first = _client().get(
            "/api/sources/library?sort_by=updated&sort_order=desc&limit=30"
        )
        cursor = first.json()["next_cursor"]
        assert cursor

        resp = _client().get(
            f"/api/sources/library?sort_by=title&sort_order=desc&limit=30&cursor={cursor}"
        )
        assert resp.status_code == 400


def test_mismatched_filter_fingerprint_returns_400() -> None:
    """A cursor whose fingerprint doesn't match the current filters is rejected."""
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(i) for i in range(31)]

        first = _client().get(
            "/api/sources/library?query=alpha&sort_by=updated&sort_order=desc&limit=30"
        )
        cursor = first.json()["next_cursor"]
        assert cursor

        # Same sort but a different query — the fingerprint must not match.
        resp = _client().get(
            f"/api/sources/library?query=beta&sort_by=updated&sort_order=desc&limit=30&cursor={cursor}"
        )
        assert resp.status_code == 400


def test_no_start_or_offset_in_generated_sql() -> None:
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = []

        _client().get("/api/sources/library?limit=30&sort_by=updated&sort_order=desc")
        assert mock_query.await_args is not None
        query_sql, _ = mock_query.await_args.args
        # Guard against BOTH keywords appearing anywhere in the SurrealQL —
        # library queries must be pure keyset.
        assert "OFFSET" not in query_sql.upper()
        assert "START" not in query_sql.upper()


def test_next_cursor_payload_is_versioned_and_typed() -> None:
    """The encoded cursor must carry version, sort keys, typed value, id,
    and a filter fingerprint — those are what decode validates against.
    """
    with (
        patch(
            "api.routers.sources.access_summary_for_source", new_callable=AsyncMock
        ) as mock_summary,
        patch("api.routers.sources.source_access_where", new_callable=AsyncMock) as mock_access,
        patch("api.routers.sources.repo_query", new_callable=AsyncMock) as mock_query,
    ):
        mock_access.return_value = ("", {})
        mock_summary.return_value = None
        mock_query.return_value = [_row(i) for i in range(31)]

        resp = _client().get(
            "/api/sources/library?sort_by=updated&sort_order=desc&limit=30"
        )
        cursor = resp.json()["next_cursor"]
        decoded = _decode_cursor(cursor)
        assert decoded["v"] == 1
        assert decoded["sort_by"] == "updated"
        assert decoded["sort_order"] == "desc"
        assert "value" in decoded
        assert "id" in decoded
        assert "fp" in decoded
