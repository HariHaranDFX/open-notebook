import os
from urllib.parse import urlsplit

from fastapi import Request

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_from_referer(referer: str) -> str | None:
    parsed = urlsplit(referer)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _allowed_origins() -> set[str]:
    return {
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip() and origin.strip() != "*"
    }


def has_valid_origin(request: Request) -> bool:
    """Allow same-host or explicitly configured browser origins for writes."""
    if request.method not in _MUTATING_METHODS:
        return True

    origin = request.headers.get("origin")
    if origin is None:
        referer = request.headers.get("referer")
        if referer is None:
            return False
        origin = _origin_from_referer(referer)
        if origin is None:
            return False

    same_host = str(request.base_url).rstrip("/")
    return origin == same_host or origin in _allowed_origins()
