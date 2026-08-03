# Task 4 Report — Auth Routes and CSRF Origin Check

## Status
Implemented auth status, current-user, login/callback delegation, logout, and origin validation for mutating requests.

## Verification
- `uv run pytest tests/test_auth_routes_status.py tests/test_auth_password_provider.py tests/test_auth_session.py` — 22 passed (one Starlette/httpx deprecation warning).
- `uv run ruff check api/auth/csrf.py api/auth/middleware.py api/auth/password.py api/routers/auth.py tests/test_auth_routes_status.py` — passed.
- `uv run python -m mypy api/auth/csrf.py api/auth/middleware.py api/auth/password.py api/routers/auth.py` — passed.
- `uv run pytest tests/` — 775 passed, 4 skipped (two pre-existing deprecation warnings).

## Security behavior
- Mutating requests accept same-host or explicitly listed `CORS_ORIGINS` origins; an untrusted Origin/Referer returns 403.
- Wildcard `CORS_ORIGINS=*` is intentionally not trusted for cookie-authenticated writes.
