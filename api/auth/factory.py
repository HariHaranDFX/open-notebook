import os

from api.auth.password import PasswordAuthProvider
from api.auth.protocol import AuthProvider


def build_auth_provider() -> AuthProvider:
    if os.getenv("AUTH_PROVIDER", "password").lower() == "entra":
        raise NotImplementedError("Entra authentication is not available yet")
    return PasswordAuthProvider()
