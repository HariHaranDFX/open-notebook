from typing import Optional

from fastapi import HTTPException, Request

from api.auth.types import AuthenticatedUser


def current_user_optional(request: Request) -> Optional[AuthenticatedUser]:
    """The current user if authenticated, else None (never raises).

    Unlike require_user(), a missing user is a normal, expected case here:
    open/password-disabled mode has no user at all, and ownership checks
    need to distinguish "no enforcement" from "not authenticated".
    """
    return getattr(request.state, "user", None)


def auth_enforces_ownership() -> bool:
    """Whether owner-only filtering should apply to notebooks/sources.

    Mirrors the provider's own auth_enabled() check (same signal the
    middleware uses to decide whether a user is required at all) so
    ownership enforcement and authentication requirements never disagree.
    """
    from api.auth.factory import build_auth_provider

    return build_auth_provider().auth_enabled()


def require_user(request: Request) -> AuthenticatedUser:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(401, detail="Not authenticated")
    return user


def require_admin(request: Request) -> AuthenticatedUser:
    user = require_user(request)
    if user.role != "admin":
        raise HTTPException(403, detail="Admin required")
    return user


def require_admin_if_auth(request: Request) -> AuthenticatedUser | None:
    from api.auth.factory import build_auth_provider

    if not build_auth_provider().auth_enabled():
        return None
    return require_admin(request)
