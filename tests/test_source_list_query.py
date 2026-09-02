from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import sources


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(sources.router, prefix="/api")
    return TestClient(app)


@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_source_title_query_is_bound_and_combined_with_access(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
) -> None:
    mock_query.return_value = []
    mock_access.return_value = (
        "user_id = $access_uid",
        {"access_uid": "user:a"},
    )

    response = _client().get("/api/sources?query=%20Lithium%20")

    assert response.status_code == 200
    assert mock_query.await_args is not None
    query, params = mock_query.await_args.args
    assert "user_id = $access_uid" in query
    assert "string::lowercase(title OR '') CONTAINS $title_query" in query
    assert params["access_uid"] == "user:a"
    assert params["title_query"] == "lithium"


@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_blank_source_title_query_behaves_like_omission(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
) -> None:
    mock_query.return_value = []
    mock_access.return_value = ("", {})

    response = _client().get("/api/sources?query=%20%20%20")

    assert response.status_code == 200
    assert mock_query.await_args is not None
    query, params = mock_query.await_args.args
    assert "$title_query" not in query
    assert "title_query" not in params


@patch("api.routers.sources.source_access_where", new_callable=AsyncMock)
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
def test_source_title_query_preserves_pagination_and_sorting(
    mock_query: AsyncMock,
    mock_access: AsyncMock,
) -> None:
    mock_query.return_value = []
    mock_access.return_value = ("", {})

    response = _client().get(
        "/api/sources?query=Evidence&limit=30&offset=30&sort_by=title&sort_order=asc"
    )

    assert response.status_code == 200
    assert mock_query.await_args is not None
    query, params = mock_query.await_args.args
    assert "ORDER BY title_sort ASC, id ASC" in query
    assert params == {
        "limit": 30,
        "offset": 30,
        "title_query": "evidence",
    }
