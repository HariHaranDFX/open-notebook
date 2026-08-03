# Task 3 Report — Session Store and Auth Dependencies

## Status
Complete. Added opaque SHA-256 session creation, resolution, expiry rejection, deletion, and user/admin dependency guards.

## Verification
- `uv run pytest tests/test_auth_password_provider.py tests/test_auth_session.py -q` — 13 passed (one pre-existing Starlette/httpx deprecation warning).
- `ruff check api/auth tests/test_auth_session.py` — passed.
- `uv run python -m mypy api/auth` — passed.

## Concern
The configured local SurrealDB rejected authentication, so session persistence is covered with repository mocks rather than a live database integration test.

## Review fix (2026-08-03)
- Added `SESSION_COOKIE_NAME = "on_session"` to `api/auth/session.py` (design spec cookie name).
- Changed session lifetime from hardcoded 7 days to `AUTH_SESSION_HOURS` env (default 8 per design spec).
- Added `test_session_cookie_name` asserting the constant.
- `uv run pytest tests/test_auth_session.py -v` — 8 passed.
