"""Owner-only access helpers for notebooks/sources (WP2 §4).

No-op whenever auth is disabled or no user is present, so open/password-mode
deployments keep today's global-visibility behaviour unchanged.
"""

from typing import Optional, Tuple

from fastapi import HTTPException, Request

from api.auth.deps import auth_enforces_ownership, current_user_optional
from open_notebook.database.repository import ensure_record_id, repo_query


def ownership_where(request: Request) -> Tuple[str, dict]:
    """SurrealQL WHERE fragment (no leading "WHERE") plus its bind vars,
    restricting a notebook/source query to rows owned by the current user.

    Returns ("", {}) when ownership isn't enforced. The equality comparison
    against a bound record id already excludes NULL user_id rows (pre-auth
    orphans) under normal SurrealQL semantics, so "hide unowned rows" falls
    out for free.
    """
    if not auth_enforces_ownership():
        return "", {}
    user = current_user_optional(request)
    if user is None:
        return "", {}
    return "user_id = $owner_id", {"owner_id": ensure_record_id(user.id)}


def assert_owner_or_404(
    owner_user_id: Optional[str], request: Request, detail: str
) -> None:
    """Raise 404 if an already-fetched notebook/source isn't owned by the
    current user. Never 403 - an id that exists but belongs to someone else
    must look identical to one that doesn't exist (WP2 §4).
    """
    if not auth_enforces_ownership():
        return
    user = current_user_optional(request)
    if user is None:
        return
    if owner_user_id != user.id:
        raise HTTPException(status_code=404, detail=detail)


async def filter_search_results_by_owner(results: list[dict], request: Request) -> list[dict]:
    """Keep only search results owned through a source or notebook."""
    if not auth_enforces_ownership():
        return results
    user = current_user_optional(request)
    if user is None:
        return results

    source_ids = [
        ensure_record_id(str(result["parent_id"]))
        for result in results
        if str(result.get("parent_id", "")).startswith("source:")
    ]
    note_ids = [
        ensure_record_id(str(result["parent_id"]))
        for result in results
        if str(result.get("parent_id", "")).startswith("note:")
    ]
    owned_ids: set[str] = set()
    if source_ids:
        owned_ids.update(
            str(row["id"])
            for row in await repo_query(
                "SELECT id FROM source WHERE id IN $ids AND user_id = $owner_id",
                {"ids": source_ids, "owner_id": ensure_record_id(user.id)},
            )
        )
    if note_ids:
        owned_ids.update(
            str(row["id"])
            for row in await repo_query(
                "SELECT in AS id FROM artifact WHERE in IN $ids AND out.user_id = $owner_id",
                {"ids": note_ids, "owner_id": ensure_record_id(user.id)},
            )
        )
    return [result for result in results if str(result.get("parent_id")) in owned_ids]
