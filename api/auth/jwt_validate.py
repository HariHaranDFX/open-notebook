"""Validate Entra ID `id_token`s against the tenant's JWKS.

Only JWKS retrieval touches the network (async, via httpx); signature and
claim verification run entirely offline through PyJWT + cryptography.
"""

import json
import time
from typing import Any, Dict, Optional

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm

from open_notebook.exceptions import AuthenticationError

_JWKS_CACHE_TTL_SECONDS = 3600
# tenant_id -> (fetched_at_monotonic, jwks_document)
_jwks_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}


def jwks_url(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"


def issuer(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/v2.0"


async def _fetch_jwks(tenant_id: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(jwks_url(tenant_id))
        response.raise_for_status()
        return response.json()


async def _get_jwks(tenant_id: str, *, force_refresh: bool = False) -> Dict[str, Any]:
    cached = _jwks_cache.get(tenant_id)
    now = time.monotonic()
    if not force_refresh and cached and now - cached[0] < _JWKS_CACHE_TTL_SECONDS:
        return cached[1]

    jwks = await _fetch_jwks(tenant_id)
    _jwks_cache[tenant_id] = (now, jwks)
    return jwks


def _find_key(jwks: Dict[str, Any], kid: str) -> Optional[Dict[str, Any]]:
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


async def validate_id_token(
    id_token: str, *, tenant_id: str, client_id: str
) -> Dict[str, Any]:
    """Validate an Entra `id_token`'s signature, issuer, audience and expiry.

    Returns the decoded claims on success. Every failure mode (malformed
    token, unknown key, bad signature, wrong issuer/audience, expiry) is
    normalized to `AuthenticationError` so callers never need to catch
    PyJWT-specific exceptions.
    """
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError(f"Malformed id_token: {exc}") from exc

    kid = header.get("kid")
    if not kid:
        raise AuthenticationError("id_token is missing the 'kid' header")

    jwks = await _get_jwks(tenant_id)
    jwk = _find_key(jwks, kid)
    if jwk is None:
        # The key may have rotated since our cached (or first) fetch -
        # force one fresh lookup before giving up.
        jwks = await _get_jwks(tenant_id, force_refresh=True)
        jwk = _find_key(jwks, kid)
    if jwk is None:
        raise AuthenticationError(f"No matching JWKS key for kid={kid}")

    try:
        signing_key = RSAAlgorithm.from_jwk(json.dumps(jwk))
        if not isinstance(signing_key, RSAPublicKey):
            raise AuthenticationError("JWKS key is not a valid RSA public key")
        claims: Dict[str, Any] = jwt.decode(
            id_token,
            key=signing_key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=issuer(tenant_id),
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError(f"id_token validation failed: {exc}") from exc

    return claims
