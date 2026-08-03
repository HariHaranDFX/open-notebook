from fastapi import HTTPException, Request

from api.auth.types import AuthenticatedUser


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
