"""Owner-only access helpers for notebooks/sources (WP2 §4).

No-op whenever auth is disabled or no user is present, so open/password-mode
deployments keep today's global-visibility behaviour unchanged.
"""

from typing import Optional, Tuple

from fastapi import HTTPException, Request

from api.auth.deps import auth_enforces_ownership, current_user_optional
from open_notebook.database.repository import ensure_record_id


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
