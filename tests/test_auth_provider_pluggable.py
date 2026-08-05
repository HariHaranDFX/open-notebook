"""Auth providers remain replaceable without router-level coupling."""

from pathlib import Path

import pytest

from api.auth.generic_oidc import GenericOIDCProvider


@pytest.mark.asyncio
async def test_generic_oidc_stub_is_unauthenticated() -> None:
    assert GenericOIDCProvider().auth_enabled() is False
    assert await GenericOIDCProvider().authenticate_request(None) is None  # type: ignore[arg-type]


def test_routers_do_not_import_entra_or_msal() -> None:
    routers_dir = Path(__file__).parents[1] / "api" / "routers"

    for path in routers_dir.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert "api.auth.entra" not in source, path
        assert "msal" not in source, path
