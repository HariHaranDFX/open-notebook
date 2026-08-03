"""Shared Secure-flag policy for the auth BFF's oauth/session cookies.

Behind a TLS-terminating proxy, `request.url.scheme` is `http` even though
the browser connection is HTTPS, so relying on it alone (as the initial
Entra BFF implementation did) silently drops the Secure flag in the most
common production topology. Fixes that P1 finding.
"""

import os

from fastapi import Request


def cookie_secure(request: Request) -> bool:
    """Whether Set-Cookie should carry the Secure flag for this request.

    Priority: explicit `AUTH_COOKIE_SECURE` override, then
    `X-Forwarded-Proto` / the request scheme, then a same-host localhost
    allowance for plain local development.
    """
    explicit = os.getenv("AUTH_COOKIE_SECURE", "").strip().lower()
    if explicit in ("1", "true", "yes"):
        return True
    if explicit in ("0", "false", "no"):
        return False

    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if forwarded == "https" or request.url.scheme == "https":
        return True

    host = (request.url.hostname or "").lower()
    return host not in ("localhost", "127.0.0.1")
