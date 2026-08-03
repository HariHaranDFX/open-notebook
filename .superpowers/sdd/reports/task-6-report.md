# Task 6 — Admin gates

- Added an auth-aware admin dependency that preserves password-open mode.
- Credentials, settings, and embedding rebuild routers now require admin access.
- Model writes and default mutations now require admin access; model reads remain available.
- Added non-admin 403 and open-mode tests.
- Verified: `uv run pytest tests/test_auth_admin_gates.py tests/test_credentials_api.py -q` (27 passed); targeted Ruff check passes.
