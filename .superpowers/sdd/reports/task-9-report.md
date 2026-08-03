# Task 9 Report — GenericOIDCProvider pluggability proof

## Status
Complete.

## What changed
- Added `GenericOIDCProvider`, a protocol-compatible, unregistered placeholder
  for a future non-Entra OIDC provider.
- Added a focused test that confirms the stub is unauthenticated and verifies
  every `api/routers/*.py` source file has no `api.auth.entra` or `msal` import.

## Verification
- `uv run pytest tests/test_auth_provider_pluggable.py -q` — 2 passed.
- `ruff check api/auth/generic_oidc.py tests/test_auth_provider_pluggable.py` — clean.
- `uv run python -m mypy api/auth/generic_oidc.py` — no issues.
