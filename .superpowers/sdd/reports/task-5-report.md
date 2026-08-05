# Task 5 Report — EntraOIDCProvider: config, JWKS, login, callback (BFF)

## Status
Implemented full Entra Authorization Code + PKCE BFF flow: PKCE helpers, async JWKS-backed
`id_token` validation, `EntraOIDCProvider` (login/callback/logout/authenticate_request),
allowlist-based role resolution, JIT user upsert, and fail-fast startup config check.
`api/auth/factory.py` and `api/main.py` now wire it in for `AUTH_PROVIDER=entra`.

## Dependency
- `uv add "PyJWT[crypto]"` → `pyjwt[crypto]>=2.13.0` (MIT). Was previously only a transitive
  dep of `mcp`; now declared directly since `api/auth/jwt_validate.py` imports it. `httpx` was
  already a direct dependency — no new network-client library added (no `msal`).
- License scan (`uv run python scripts/check_licenses.py`) passes: 0 violations.
- `THIRD-PARTY-NOTICES.md` regen is Linux-only per `LICENSE_COMPLIANCE.md` — not run here; flag
  for the next Linux CI/regen pass.

## Design choices (surgical, explicit)
- JWKS fetch is the only network hop in validation; it's done via `httpx.AsyncClient` (not
  PyJWT's built-in `PyJWKClient`, which is sync/blocking) and cached 1h in-process, with a
  forced one-time refresh on unknown `kid` (key-rotation tolerance).
- PKCE `state`+`verifier` are held in a short-lived (10 min) httpOnly `on_oauth` cookie as
  `"{state}.{verifier}"` (`.` isn't in the `token_urlsafe` alphabet, so it's a safe delimiter) —
  no DB round-trip needed for the pre-auth step, consistent with the BFF-only design.
  `secrets.compare_digest` guards the state comparison.
- Role is derived only from `AUTH_ADMIN_EMAILS` (`resolve_role`), never from token claims — no
  privilege escalation via a crafted/compromised `name`/`email` claim.
- Refresh-token encryption is best-effort: `_encrypt_refresh_token` swallows `ValueError` (no
  `OPEN_NOTEBOOK_ENCRYPTION_KEY`) and stores `None` rather than failing login, per brief's
  "optional field may be None" instruction.
- JIT upsert matches by `entra_oid OR email`, then goes through the existing `User` domain model
  (`ObjectModel.save()`) rather than raw `repo_create`/`repo_update`, so pydantic validation
  (role literal, etc.) is enforced identically to the rest of the codebase.
- `require_entra_config()` runs both eagerly in `EntraOIDCProvider.__init__` (defense in depth,
  since a bare `AuthProvider` instantiation must never partially succeed) and explicitly in
  `api/main.py`'s `lifespan`, because Starlette builds the middleware stack lazily on first
  request — relying on `AuthMiddleware.__init__` alone would not fail at true process startup.

## Tests (TDD: written before/alongside implementation, all crafted — no live Entra)
- `tests/test_auth_pkce.py` (4): verifier length/charset/uniqueness, S256 challenge derivation.
- `tests/test_auth_entra_jwt.py` (10): valid token accepted; wrong issuer/audience, expired,
  bad signature, missing `kid`, unknown `kid` (asserts one forced refetch), malformed token all
  raise `AuthenticationError`; JWKS/issuer URL builders. Tokens are signed with a locally
  generated RSA key via `cryptography`; only `_fetch_jwks` is mocked — real PyJWT/crypto path.
- `tests/test_auth_admin_allowlist.py` (12): `resolve_role` case-insensitive match + blank-entry
  handling; `require_entra_config` passes on full config, fails (naming the missing key) for
  each of the 5 required vars, fails on blank-only `AUTH_ADMIN_EMAILS`.
- `tests/test_auth_entra_provider.py` (9): `begin_login` redirect URL/PKCE params/cookie flags;
  `handle_callback` state-mismatch / missing-cookie / Entra `error=` rejection; full JIT-create
  path (role from allowlist, `on_session` cookie set, `on_oauth` cleared); JIT-update path
  (matches existing user by `entra_oid`, no duplicate); `authenticate_request` and `logout`.
  DB and network calls (`repo_query`/`repo_create`/`repo_update`, `_exchange_code`,
  `validate_id_token`, `create_session`) are mocked; cookie/redirect/flow logic is real.

## Verification
- `uv run pytest tests/test_auth_pkce.py tests/test_auth_entra_jwt.py tests/test_auth_admin_allowlist.py tests/test_auth_entra_provider.py tests/test_auth_password_provider.py tests/test_auth_session.py tests/test_auth_routes_status.py -q` — 60 passed.
- `uv run pytest tests/ -q` — 804 passed, 4 skipped, 9 pre-existing failures in
  `tests/test_models_api.py::TestModelsProviderAvailability` (confirmed via `git stash` to fail
  identically on `wp-2-entra-auth` HEAD before this task's changes — an `os.getenv` mock in that
  file takes only 1 positional arg and breaks on any 2-arg `os.getenv(key, default)` call
  anywhere in the process, including the pre-existing `AuthMiddleware` CSRF check; unrelated to
  this task, not touched).
- `ruff check` — clean (1 auto-fixed import-sort).
- `uv run python -m mypy api/auth/entra.py api/auth/jwt_validate.py api/auth/pkce.py api/auth/factory.py api/main.py` — no issues.
- `uv run python -c "import api.main"` — imports cleanly in default password mode.

## Concerns / follow-ups
- The 9 pre-existing `test_models_api.py` failures should be fixed (widen that test's
  `env_side_effect` signature to `*args`) in a separate, focused commit — out of scope here.
- `docs/AUTH.md` (Entra app registration, proxy, env reference) is not part of this task; still
  needed before rollout per the design spec's acceptance criteria.
- Manual E2E against a real Entra tenant is unverified (by design — no live Entra required for
  this task); recommend a manual smoke test pass before WP2 sign-off.

---

## Addendum: P1 security hardening (post-review fixes)

Two P1 findings from the security review of the above implementation are fixed here.

### P1-1: OAuth state/PKCE integrity

**Before:** `on_oauth` cookie stored an unsigned `"{state}.{verifier}"` payload. A tampered
cookie could inject a different `code_verifier` without detection at the cookie layer.

**Fix (server-side pending state — the preferred option from the brief):** the PKCE
`code_verifier` now lives in a new `oauth_state` table (migration 25, `SCHEMAFULL`: `state`
string unique index, `code_verifier` string, `expires_at` datetime, 10-minute lifetime matching
the existing cookie `max_age`), added via `api/auth/oauth_state.py`
(`store_oauth_state`/`consume_oauth_state`) and registered in `AsyncMigrationManager`. The
`on_oauth` cookie now carries **only** the opaque `state`.

`begin_login` calls `store_oauth_state(state, verifier)` before redirecting.
`handle_callback` still does the `secrets.compare_digest(cookie_state, query_state)` check
first (unchanged anti-CSRF behavior), then calls `consume_oauth_state(returned_state)` — a
one-time lookup-and-delete — to fetch the real `code_verifier`. Any cookie tampering changes
the state value and fails the `compare_digest` check before the DB is ever touched; an
unknown/expired/replayed state fails the DB lookup instead. Either way the verifier used in the
token exchange is always the one this server generated for that state — a cookie can no longer
supply an attacker-chosen verifier.

### P1-2: Secure cookie flag behind a TLS-terminating proxy

**Before:** `secure=request.url.scheme == "https"` — silently drops `Secure` in the standard
production topology where TLS terminates at a proxy/load balancer and the app sees plain HTTP.

**Fix:** new `api/auth/cookies.cookie_secure(request)` helper, applied to both the `on_oauth`
and `on_session` `Set-Cookie` calls in `api/auth/entra.py`. Priority order: explicit
**`AUTH_COOKIE_SECURE`** env override (`1`/`true`/`yes` → force True, `0`/`false`/`no` → force
False) → `X-Forwarded-Proto` (first value if comma-separated) or `request.url.scheme` → default
Secure=True unless the host is `localhost`/`127.0.0.1` (plain local dev only).

**New env var — `AUTH_COOKIE_SECURE`** (optional, unset by default): forces the cookie `Secure`
flag on or off regardless of scheme/proxy-header detection. Use `1`/`true`/`yes` to force Secure
in setups where `X-Forwarded-Proto` isn't forwarded correctly; `0`/`false`/`no` only for local
HTTP debugging against a non-localhost hostname. Belongs in the same env reference as
`ENTRA_*`/`AUTH_ADMIN_EMAILS` once `docs/AUTH.md` is written.

### Tests (TDD)
- `tests/test_auth_oauth_state.py` (5): store persists `code_verifier` + ~10 min expiry;
  consume returns verifier and deletes the row (one-time use); consume returns `None` for an
  unknown state (no delete) and for an expired one (still deletes — no replay); string
  (SurrealDB-serialized) `expires_at` is parsed correctly.
- `tests/test_auth_cookies.py` (8): secure for `https` scheme; secure via
  `X-Forwarded-Proto: https` even when `request.url.scheme` is `http`; first value used from a
  comma-separated forwarded-proto list; **not** secure for `localhost`/`127.0.0.1` over plain
  `http`; secure by default for any other plain-`http` host; `AUTH_COOKIE_SECURE` override forces
  both directions.
- `tests/test_auth_entra_provider.py`: rewrote all cookie/state assertions for the new
  state-only cookie; added `test_handle_callback_rejects_tampered_oauth_cookie` (single flipped
  cookie char → `state mismatch`, DB lookup never reached) and
  `test_handle_callback_rejects_unknown_or_replayed_state` (valid state format but no matching
  DB row → `Missing or expired`).
- `tests/test_migration_25_oauth_state.py`: mirrors the existing `test_migration_24_*` pattern
  (schema statements present, rollback statement present, migration registered in both
  `up_migrations`/`down_migrations`).
- `tests/test_migration_24_auth_schema.py`: `test_migration_24_is_registered_for_up_and_down`
  updated to index `[23]` instead of `[-1]` now that migration 25 is the newest.

### Verification
- `uv run pytest tests/test_auth_entra_provider.py tests/test_auth_oauth_state.py
  tests/test_auth_cookies.py tests/test_migration_24_auth_schema.py
  tests/test_migration_25_oauth_state.py tests/test_auth_pkce.py tests/test_auth_entra_jwt.py
  tests/test_auth_admin_allowlist.py tests/test_auth_session.py -q` — 66 passed.
- `uv run pytest tests/ -q` — 822 passed, 4 skipped, the same 9 pre-existing
  `test_models_api.py::TestModelsProviderAvailability` failures (confirmed unrelated in the
  original task-5 report; still unrelated here — untouched by this change).
- `ruff check` on all new/changed files — clean.
- `uv run python -m mypy api/auth/entra.py api/auth/oauth_state.py api/auth/cookies.py` — no
  issues.
- No new dependencies added — no licensing impact.
