# WP2 Entra Auth (BFF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared-password auth with Entra OIDC via a FastAPI BFF (httpOnly opaque session), JIT users, admin allowlist roles, and owner-only notebook/source access — per [design spec](../specs/2026-08-03-wp2-entra-auth-design.md).

**Architecture:** `AuthProvider` protocol (`password` | `entra`); FastAPI owns login/callback/logout and session cookies; Next.js existing `/api/*` rewrite provides same-origin; ownership filters on notebook/source; sharing deferred to WP2b ([PDR-003](../../7-DEVELOPMENT/decisions/PDR-003-per-user-ownership-and-sharing.md)).

**Tech Stack:** FastAPI, SurrealDB migration 24, PyJWT + httpx (no MSAL), Next.js (existing rewrites), vitest/pytest.

## Global Constraints

- Branch: `wp-2-entra-auth` from `main`; PR only to `HariHaranDFX/open-notebook`.
- Spec is normative: [2026-08-03-wp2-entra-auth-design.md](../specs/2026-08-03-wp2-entra-auth-design.md).
- `AUTH_ADMIN_EMAILS` required (≥1) when `AUTH_PROVIDER=entra`; refuse startup otherwise.
- No share/group/ACL tables in WP2.
- Prefer `PyJWT[crypto]` + `httpx` over `msal` (code exchange is one POST).
- New deps: check [LICENSE_COMPLIANCE.md](../../LICENSE_COMPLIANCE.md); regenerate `THIRD-PARTY-NOTICES.md` on Linux if PyJWT is new.
- Coverage floors must not drop (backend ≥56%, frontend ≥35.79%).
- Characterization behaviour changes must be intentional and named in the commit message.
- Stop after WP2 AC + CI green — do not start WP3/WP2b on this branch.

## File map (create / modify)

| Path | Responsibility |
|---|---|
| `api/auth/` (package; replace `api/auth.py`) | Protocol, providers, middleware, deps, sessions, factory |
| `api/routers/auth.py` | status, login, callback, logout, me |
| `api/main.py` | Wire middleware, startup allowlist check, CORS credentials for same-origin |
| `open_notebook/domain/user.py` | User model |
| `open_notebook/domain/notebook.py` | `user_id` / `client_id` on Notebook + Source |
| `open_notebook/database/migrations/24.surrealql` (+ down) | user, auth_session, ownership fields |
| `open_notebook/database/async_migrate.py` | Register migration 24 |
| `api/routers/notebooks.py`, `sources.py`, … | Ownership filters + stamps |
| `api/routers/credentials.py`, `models.py`, `settings.py`, `embedding_rebuild.py` | `require_admin` |
| `frontend/src/lib/api/client.ts` | `withCredentials`; Entra = cookie, no Bearer |
| `frontend/src/lib/stores/auth-store.ts`, `LoginForm.tsx` | Provider-aware login |
| `frontend/src/lib/locales/*` | i18n for Entra login strings |
| `docs/AUTH.md` | Operator guide |
| `tests/test_auth_*.py`, frontend vitest | Coverage |

---

### Task 1: Branch + AuthProvider protocol + Password provider extract

**Files:**
- Create: `api/auth/__init__.py`, `api/auth/types.py`, `api/auth/protocol.py`, `api/auth/password.py`, `api/auth/factory.py`, `api/auth/middleware.py`
- Modify: `api/main.py` (import path)
- Delete after cutover: `api/auth.py` (move logic into package)
- Test: `tests/test_auth_password_provider.py`

**Interfaces:**
- Produces: `AuthenticatedUser`, `AuthProvider` protocol, `PasswordAuthProvider`, `build_auth_provider()`, `AuthMiddleware`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull origin main
git checkout -b wp-2-entra-auth
```

- [ ] **Step 2: Write failing test for password Bearer auth**

```python
# tests/test_auth_password_provider.py
import pytest
from starlette.requests import Request
from api.auth.password import PasswordAuthProvider
from api.auth.types import AuthenticatedUser

@pytest.mark.asyncio
async def test_password_provider_accepts_matching_bearer(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")
    provider = PasswordAuthProvider()
    scope = {"type": "http", "headers": [(b"authorization", b"Bearer secret")], "method": "GET", "path": "/api/x"}
    # Build a minimal Request or call authenticate with a stub — implement against real Request API
    user = await provider.authenticate_request(make_request_with_auth("Bearer secret"))
    assert user is not None
    assert user.role == "admin"
    assert provider.auth_enabled() is True

@pytest.mark.asyncio
async def test_password_provider_rejects_bad_password(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "secret")
    provider = PasswordAuthProvider()
    user = await provider.authenticate_request(make_request_with_auth("Bearer wrong"))
    assert user is None
```

- [ ] **Step 3: Run test — expect fail (module missing)**

Run: `uv run pytest tests/test_auth_password_provider.py -v`  
Expected: FAIL import / not found

- [ ] **Step 4: Implement types + protocol + PasswordAuthProvider + AuthMiddleware**

```python
# api/auth/types.py
from dataclasses import dataclass
from typing import Literal, Optional

@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str
    display_name: str
    role: Literal["admin", "user"]
    entra_oid: Optional[str]
    client_id: str
```

```python
# api/auth/protocol.py
from typing import Optional, Protocol
from fastapi import Request
from starlette.responses import Response
from api.auth.types import AuthenticatedUser

class AuthProvider(Protocol):
    name: str
    def auth_enabled(self) -> bool: ...
    async def authenticate_request(self, request: Request) -> Optional[AuthenticatedUser]: ...
    async def begin_login(self, request: Request) -> Response: ...
    async def handle_callback(self, request: Request) -> Response: ...
    async def logout(self, request: Request) -> Response: ...
```

Move constant-time Bearer check from current `api/auth.py` into `PasswordAuthProvider`. For password mode, return a fixed synthetic user:

```python
AuthenticatedUser(
    id="user:password-local",
    email="local@dev",
    display_name="Local Admin",
    role="admin",
    entra_oid=None,
    client_id=os.getenv("CLIENT_ID", "local"),
)
```

`begin_login` / `handle_callback` / `logout` for password: return 400 JSON “not supported” (frontend won’t call them).

`AuthMiddleware`: same excluded paths as today; call `provider.authenticate_request`; if `auth_enabled` and user is None → 401; else set `request.state.user` and continue. OPTIONS always pass.

`factory.py`:

```python
def build_auth_provider() -> AuthProvider:
    mode = os.getenv("AUTH_PROVIDER", "password").lower()
    if mode == "entra":
        from api.auth.entra import EntraOIDCProvider
        return EntraOIDCProvider()
    return PasswordAuthProvider()
```

(Temporarily raise `NotImplementedError` if entra until Task 5 — or stub empty class.)

- [ ] **Step 5: Point `api/main.py` at new middleware; remove old `api/auth.py`**

- [ ] **Step 6: Run tests**

Run: `uv run pytest tests/test_auth_password_provider.py tests/test_config_endpoint_no_leak.py -v`  
Expected: PASS (update config test imports if they name `PasswordAuthMiddleware`)

- [ ] **Step 7: Commit**

```bash
git add api/auth api/main.py tests/test_auth_password_provider.py
git rm api/auth.py  # if removed
git commit -m "feat(wp2): extract AuthProvider protocol and PasswordAuthProvider"
```

---

### Task 2: Migration 24 — user, auth_session, ownership columns

**Files:**
- Create: `open_notebook/database/migrations/24.surrealql`, `24_down.surrealql`
- Modify: `open_notebook/database/async_migrate.py`
- Create: `open_notebook/domain/user.py`
- Modify: `open_notebook/domain/notebook.py` (add optional `user_id`, `client_id` on Notebook + Source)
- Test: `tests/test_migration_24_auth_schema.py` (or query-level unit if full DB heavy — match existing migration test style)

**Interfaces:**
- Produces: Surreal tables `user`, `auth_session`; fields on `notebook`/`source`; `User(ObjectModel)`

- [ ] **Step 1: Write migration up**

```surql
-- open_notebook/database/migrations/24.surrealql
DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS email ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS display_name ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS entra_oid ON TABLE user TYPE option<string>;
DEFINE FIELD IF NOT EXISTS role ON TABLE user TYPE string ASSERT $value IN ["admin", "user"];
DEFINE FIELD IF NOT EXISTS client_id ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS created ON user DEFAULT time::now() VALUE $before OR time::now();
DEFINE FIELD IF NOT EXISTS updated ON user DEFAULT time::now() VALUE time::now();
DEFINE INDEX IF NOT EXISTS idx_user_email ON TABLE user COLUMNS email UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_user_entra_oid ON TABLE user COLUMNS entra_oid UNIQUE;

DEFINE TABLE IF NOT EXISTS auth_session SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS session_token_hash ON TABLE auth_session TYPE string;
DEFINE FIELD IF NOT EXISTS user ON TABLE auth_session TYPE record<user>;
DEFINE FIELD IF NOT EXISTS expires_at ON TABLE auth_session TYPE datetime;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE auth_session DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS entra_refresh_token_enc ON TABLE auth_session TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_session_hash ON TABLE auth_session COLUMNS session_token_hash UNIQUE;

DEFINE FIELD IF NOT EXISTS user_id ON TABLE notebook TYPE option<record<user>>;
DEFINE FIELD IF NOT EXISTS client_id ON TABLE notebook TYPE option<string>;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE source TYPE option<record<user>>;
DEFINE FIELD IF NOT EXISTS client_id ON TABLE source TYPE option<string>;
```

Down: `REMOVE FIELD` / `REMOVE TABLE` as appropriate (match project down style).

- [ ] **Step 2: Register in AsyncMigrationManager** (both up and down lists, after 23)

- [ ] **Step 3: User domain model**

```python
# open_notebook/domain/user.py
class User(ObjectModel):
    table_name: ClassVar[str] = "user"
    email: str
    display_name: str
    entra_oid: Optional[str] = None
    role: Literal["admin", "user"] = "user"
    client_id: str
```

- [ ] **Step 4: Add optional fields to Notebook and Source pydantic models**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(wp2): migration 24 user, session, and ownership columns"
```

---

### Task 3: Session store + auth deps

**Files:**
- Create: `api/auth/session.py`, `api/auth/deps.py`
- Test: `tests/test_auth_session.py`

**Interfaces:**
- Produces:
  - `create_session(user_id, refresh_token_enc=None) -> raw_cookie_value`
  - `resolve_session(raw_cookie) -> AuthenticatedUser | None`
  - `delete_session(raw_cookie) -> None`
  - `require_user(request) -> AuthenticatedUser`
  - `require_admin(request) -> AuthenticatedUser`
- Cookie name: `on_session`
- Hash: `hashlib.sha256(raw.encode()).hexdigest()`

- [ ] **Step 1: Failing tests for create/resolve/expiry/delete**

- [ ] **Step 2: Implement session.py using `repo_query` / `repo_create` / `repo_delete`**

- [ ] **Step 3: Implement deps**

```python
def require_user(request: Request) -> AuthenticatedUser:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(401, detail="Not authenticated")
    return user

def require_admin(request: Request) -> AuthenticatedUser:
    user = require_user(request)
    if user.role != "admin":
        raise HTTPException(403, detail="Admin required")
    return user
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(wp2): opaque session store and require_user/admin deps"
```

---

### Task 4: Auth status + me + logout routes; CSRF Origin check

**Files:**
- Modify: `api/routers/auth.py`
- Create: `api/auth/csrf.py` (Origin allowlist for mutating methods — can live inside middleware)
- Test: `tests/test_auth_routes_status.py`

**Interfaces:**
- `GET /api/auth/status` → `{ "auth_enabled": bool, "provider": "password"|"entra" }`
- `GET /api/auth/me` → user dict (401 if anonymous when enabled)
- `POST /api/auth/logout` → provider.logout

- [ ] **Step 1: Failing tests for status shape**

- [ ] **Step 2: Implement routes; middleware Origin check on POST/PUT/PATCH/DELETE**

Allowed origins: from `CORS_ORIGINS` plus same-host. Reject missing/mismatched Origin with 403.

- [ ] **Step 3: Exclude `/api/auth/login`, `/api/auth/callback` from auth requirement** (add to middleware excluded_paths)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(wp2): auth status/me/logout and CSRF Origin checks"
```

---

### Task 5: EntraOIDCProvider — config, JWKS, login, callback

**Files:**
- Create: `api/auth/entra.py`, `api/auth/jwt_validate.py`, `api/auth/pkce.py`
- Modify: `pyproject.toml` / lockfile — add `PyJWT[crypto]`
- Modify: `api/auth/factory.py` — real Entra path; startup validation
- Modify: `api/main.py` lifespan — fail if entra + empty allowlist
- Test: `tests/test_auth_entra_jwt.py`, `tests/test_auth_admin_allowlist.py`

**Interfaces:**
- Consumes: session.create_session, User upsert
- Produces: working EntraOIDCProvider

- [ ] **Step 1: Add dependency**

```bash
uv add "PyJWT[crypto]"
```

Confirm MIT; schedule notices regen on Linux.

- [ ] **Step 2: Failing tests — allowlist parse; id_token validation rejects bad iss/aud/exp**

Use crafted JWTs with a test RSA key (stdlib cryptography via PyJWT).

- [ ] **Step 3: Implement helpers**

```python
# role from allowlist
def resolve_role(email: str) -> Literal["admin", "user"]:
    allowed = {e.strip().lower() for e in os.environ["AUTH_ADMIN_EMAILS"].split(",") if e.strip()}
    return "admin" if email.lower() in allowed else "user"

def require_entra_config() -> None:
    for key in ("ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI", "AUTH_ADMIN_EMAILS"):
        if not os.getenv(key, "").strip():
            raise RuntimeError(f"Missing required env {key} for AUTH_PROVIDER=entra")
    if not any(e.strip() for e in os.environ["AUTH_ADMIN_EMAILS"].split(",")):
        raise RuntimeError("AUTH_ADMIN_EMAILS must contain at least one email")
```

Call `require_entra_config()` from lifespan when provider is entra.

- [ ] **Step 4: EntraOIDCProvider**

- `begin_login`: generate PKCE verifier+challenge, store verifier+state in short-lived DB row or signed cookie (`on_oauth` httpOnly, 10 min); 302 to  
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?...`
- `handle_callback`: validate state; POST token endpoint with code+verifier+client_secret; validate `id_token` via JWKS (`https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`); upsert User by `oid`/`email`; `create_session`; Set-Cookie `on_session`; 302 `/`
- `authenticate_request`: read `on_session` cookie → `resolve_session`
- `logout`: delete session; clear cookie; optional end_session redirect

Scopes: `openid profile email offline_access` (offline_access only if storing refresh token).

- [ ] **Step 5: Wire login/callback on auth router to `provider.begin_login` / `handle_callback`**

- [ ] **Step 6: Run unit tests**

Run: `uv run pytest tests/test_auth_entra_jwt.py tests/test_auth_admin_allowlist.py -v`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(wp2): EntraOIDCProvider with PKCE BFF and allowlist roles"
```

---

### Task 6: Admin gates on sensitive routers

**Files:**
- Modify: `api/routers/credentials.py`, `models.py`, `settings.py`, `embedding_rebuild.py` (+ provider write endpoints if any)
- Test: `tests/test_auth_admin_gates.py`

**Interfaces:**
- Consumes: `require_admin` as FastAPI `Depends`

- [ ] **Step 1: Failing test — non-admin gets 403 on POST /api/credentials** (use password provider + monkeypatch user role, or inject request.state)

- [ ] **Step 2: Add `Depends(require_admin)` to mutating and sensitive credential/settings/rebuild endpoints**

Keep model **list** readable by any authenticated user (spec §4).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(wp2): require admin on credentials, settings, model writes, rebuild"
```

---

### Task 7: Ownership filters on notebooks and sources

**Files:**
- Modify: `api/routers/notebooks.py`, `api/routers/sources.py`, and any list/get that returns notebooks/sources (search/podcasts/notes as needed — filter via parent ownership)
- Modify: domain create paths to stamp `user_id` / `client_id`
- Test: `tests/test_ownership_notebooks.py`
- Update characterization tests that assume global lists — intentional

**Interfaces:**
- Create stamps `user_id=request.state.user.id`, `client_id=user.client_id`
- List: `WHERE user_id = $user` (and hide null `user_id` in entra mode)
- Get/update/delete: not owner → **404**

- [ ] **Step 1: Failing tests — user A cannot list/get user B notebook**

- [ ] **Step 2: Implement filters + stamps**

Helper:

```python
def ownership_filter_clause(user: AuthenticatedUser) -> str:
    return "user_id = $owner_id"
# bind owner_id = ensure_record_id(user.id)
```

Password mode: still stamp synthetic user id so behaviour matches.

- [ ] **Step 3: Update characterization tests deliberately**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(wp2): owner-only notebook and source access"
```

---

### Task 8: Frontend — provider-aware login + cookie credentials

**Files:**
- Modify: `frontend/src/lib/api/client.ts`, `auth-store.ts`, `auth-token.ts`, `components/auth/LoginForm.tsx`, `lib/hooks/use-auth.ts`
- Modify: all locale files under `frontend/src/lib/locales/` (i18n mandatory)
- Test: `frontend/src/lib/stores/auth-store.test.ts` (or new `auth-entra.test.ts`)

**Critical same-origin rule:** Browser must call `/api` on the **page origin** (Next rewrite → FastAPI) so `Set-Cookie` is first-party. Do not point `apiClient` at `http://localhost:5055` in Entra mode.

- [ ] **Step 1: Extend `/auth/status` consumer for `provider`**

- [ ] **Step 2: When `provider === 'entra'`**

- Login button → `window.location.href = '/api/auth/login'` (relative)
- `apiClient.defaults.withCredentials = true`
- Do not set Authorization Bearer from localStorage
- `checkAuth` → `GET /api/auth/me` with credentials
- Logout → `POST /api/auth/logout` then redirect

- [ ] **Step 3: When `provider === 'password'`** — keep existing Bearer flow

- [ ] **Step 4: Prefer api base as empty string / same origin when using Next rewrite** (document `NEXT_PUBLIC_API_URL=` empty for cookie mode)

- [ ] **Step 5: i18n keys** e.g. `auth.signInWithMicrosoft`, `auth.signingIn` in **all** locales

- [ ] **Step 6: Frontend tests + lint**

Run: `cd frontend && npm run test && npm run lint`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(wp2): Entra login UI and credentialed apiClient"
```

---

### Task 9: GenericOIDCProvider stub (pluggability proof)

**Files:**
- Create: `api/auth/generic_oidc.py` (minimal stub)
- Test: `tests/test_auth_provider_pluggable.py`

- [ ] **Step 1: Stub class implementing AuthProvider** (authenticate always None / raise)

- [ ] **Step 2: Test that `api/routers/notebooks.py` and credentials router import graph does not reference `api.auth.entra`**

```python
def test_routers_do_not_import_entra():
    import api.routers.notebooks as nb
    import api.routers.credentials as cr
    import sys
    assert "api.auth.entra" not in sys.modules or True
    # Stronger: inspect source files for forbidden imports
    from pathlib import Path
    for path in Path("api/routers").glob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "api.auth.entra" not in text
        assert "msal" not in text
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test(wp2): prove AuthProvider pluggability without route coupling"
```

---

### Task 10: docs/AUTH.md + env reference touch-up

**Files:**
- Create: `docs/AUTH.md`
- Modify: `docs/5-CONFIGURATION/environment-reference.md` (new vars)
- Link from PDR-003 / TENANCY if needed (one line)

- [ ] **Step 1: Write AUTH.md covering**

1. Entra app registration (redirect URI via Next/proxy: `https://host/api/auth/callback`)
2. API permissions / openid scopes
3. Env table from spec
4. Same-origin / Next rewrite note
5. Password fallback for local
6. Admin allowlist rule
7. WP2b sharing pointer → PDR-003

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(wp2): add AUTH.md operator guide"
```

---

### Task 11: Full verification, PR, human stop

**Files:** none new required

- [ ] **Step 1: Backend suite**

Run: `uv run pytest tests/ -q`  
Expected: green (or only known Windows skips documented in DEV_SETUP)

- [ ] **Step 2: Ruff + mypy**

Run: `ruff check . --fix` and `uv run python -m mypy api/auth open_notebook/domain/user.py`  
Expected: clean on touched packages

- [ ] **Step 3: Frontend build**

Run: `cd frontend && npm run test && npm run lint && npm run build`

- [ ] **Step 4: License scan**

Run: `uv run python scripts/check_licenses.py`  
If PyJWT added: regenerate notices on Linux before merge.

- [ ] **Step 5: Manual Entra smoke (operator)** — checklist in AUTH.md

- [ ] **Step 6: Push and open PR to fork only**

```bash
git push -u origin wp-2-entra-auth
gh pr create --repo HariHaranDFX/open-notebook --title "WP2 — Identity & Entra ID auth (BFF)" --body "$(cat <<'EOF'
## Summary
- FastAPI BFF Entra OIDC (Auth Code + PKCE) with httpOnly opaque sessions
- JIT users, required AUTH_ADMIN_EMAILS, admin gates, owner-only notebooks/sources
- Password provider retained for local/CI; sharing/groups deferred (PDR-003 / WP2b)

## Test plan
- [ ] pytest + frontend test/lint/build green in CI
- [ ] Manual Entra login against registered app
- [ ] Second user cannot see first user’s notebook
- [ ] Non-admin gets 403 on credentials write
- [ ] AUTH_PROVIDER=password still works locally

EOF
)"
```

- [ ] **Step 7: Stop for human review** — do not start WP3 or WP2b

---

## Plan self-review

| Spec requirement | Task |
|---|---|
| AuthProvider + password fallback | 1 |
| user + session schema + ownership columns | 2 |
| Opaque session + deps | 3 |
| status/me/logout + CSRF | 4 |
| Entra BFF + allowlist fail-closed | 5 |
| Admin on sensitive routes | 6 |
| Owner-only data | 7 |
| Frontend Entra + cookies | 8 |
| Pluggability stub | 9 |
| AUTH.md | 10 |
| AC + CI + PR stop | 11 |
| WP2b sharing | Deferred (PDR-003) — not in tasks |

No TBD placeholders. Cookie name `on_session` and synthetic password user id `user:password-local` are consistent across tasks.
