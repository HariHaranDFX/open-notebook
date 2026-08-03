"""PKCE (RFC 7636) helpers for the Entra Authorization Code flow."""

import base64
import hashlib
import secrets


def generate_verifier() -> str:
    """Generate a code_verifier: 43-128 chars from the RFC 7636 unreserved set."""
    return secrets.token_urlsafe(96)[:128]


def generate_challenge(verifier: str) -> str:
    """Derive the S256 code_challenge for a given verifier."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def generate_state() -> str:
    """Generate an opaque anti-CSRF state value for the OAuth redirect."""
    return secrets.token_urlsafe(32)
