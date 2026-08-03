# Task 10 Report — Authentication operator guide

## Status
Complete.

## What changed
- Added `docs/AUTH.md` with Entra app-registration, OIDC scopes, configuration,
  same-origin proxy, cookie, admin allowlist, password-fallback, and WP2b
  sharing guidance.
- Added the WP2 authentication variables to the environment reference.

## Verification
- Reviewed environment-variable names and defaults against the active auth
  implementation in `api/auth/entra.py`, `api/auth/cookies.py`, and
  `api/auth/session.py`.
