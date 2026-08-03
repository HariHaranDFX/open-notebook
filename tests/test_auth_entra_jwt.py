"""JWT validation tests using a locally-generated RSA key (no live Entra call).

Only network access (`_fetch_jwks`) is mocked; signature/claims verification
runs through the real PyJWT + cryptography code path.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from api.auth import jwt_validate
from open_notebook.exceptions import AuthenticationError

TENANT_ID = "11111111-1111-1111-1111-111111111111"
CLIENT_ID = "22222222-2222-2222-2222-222222222222"
KID = "test-kid-1"


def _make_key_pair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


PRIVATE_KEY, PUBLIC_KEY = _make_key_pair()
JWK = RSAAlgorithm.to_jwk(PUBLIC_KEY, as_dict=True)
JWK["kid"] = KID
JWK["use"] = "sig"
JWKS = {"keys": [JWK]}


def _make_token(*, kid=KID, key=PRIVATE_KEY, **claim_overrides) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "iss": jwt_validate.issuer(TENANT_ID),
        "aud": CLIENT_ID,
        "sub": "subject-1",
        "oid": "entra-oid-1",
        "email": "user@example.com",
        "name": "Test User",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    claims.update(claim_overrides)
    headers = {"kid": kid} if kid is not None else {}
    return jwt.encode(claims, key, algorithm="RS256", headers=headers)


@pytest.fixture(autouse=True)
def mock_jwks(monkeypatch):
    jwt_validate._jwks_cache.clear()
    fetch = AsyncMock(return_value=JWKS)
    monkeypatch.setattr(jwt_validate, "_fetch_jwks", fetch)
    return fetch


@pytest.mark.asyncio
async def test_validate_id_token_accepts_well_formed_token():
    token = _make_token()

    claims = await jwt_validate.validate_id_token(
        token, tenant_id=TENANT_ID, client_id=CLIENT_ID
    )

    assert claims["oid"] == "entra-oid-1"
    assert claims["email"] == "user@example.com"


@pytest.mark.asyncio
async def test_validate_id_token_rejects_wrong_issuer():
    token = _make_token(iss="https://login.microsoftonline.com/other-tenant/v2.0")

    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            token, tenant_id=TENANT_ID, client_id=CLIENT_ID
        )


@pytest.mark.asyncio
async def test_validate_id_token_rejects_wrong_audience():
    token = _make_token(aud="some-other-client")

    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            token, tenant_id=TENANT_ID, client_id=CLIENT_ID
        )


@pytest.mark.asyncio
async def test_validate_id_token_rejects_expired_token():
    now = datetime.now(timezone.utc)
    token = _make_token(iat=now - timedelta(minutes=10), exp=now - timedelta(minutes=5))

    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            token, tenant_id=TENANT_ID, client_id=CLIENT_ID
        )


@pytest.mark.asyncio
async def test_validate_id_token_rejects_bad_signature():
    forged_key, _ = _make_key_pair()
    token = _make_token(key=forged_key)

    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            token, tenant_id=TENANT_ID, client_id=CLIENT_ID
        )


@pytest.mark.asyncio
async def test_validate_id_token_rejects_missing_kid_header():
    token = _make_token(kid=None)

    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            token, tenant_id=TENANT_ID, client_id=CLIENT_ID
        )


@pytest.mark.asyncio
async def test_validate_id_token_rejects_unknown_kid(mock_jwks):
    token = _make_token(kid="unknown-kid")

    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            token, tenant_id=TENANT_ID, client_id=CLIENT_ID
        )
    # Retries once (in case of key rotation) before giving up.
    assert mock_jwks.await_count == 2


@pytest.mark.asyncio
async def test_validate_id_token_rejects_malformed_token():
    with pytest.raises(AuthenticationError):
        await jwt_validate.validate_id_token(
            "not-a-jwt", tenant_id=TENANT_ID, client_id=CLIENT_ID
        )


def test_jwks_url_uses_tenant_discovery_endpoint():
    assert jwt_validate.jwks_url(TENANT_ID) == (
        f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
    )


def test_issuer_uses_tenant_v2_endpoint():
    assert jwt_validate.issuer(TENANT_ID) == (
        f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"
    )
