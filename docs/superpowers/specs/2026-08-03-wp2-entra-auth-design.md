# WP2 Identity & Microsoft Entra ID — Design Spec

- **Status**: Draft for review (frozen from design sessions 2026-08-03)
- **Date**: 2026-08-03
- **Branch**: `wp-2-entra-auth` (not created until implementation starts)
- **Related**: [PDR-003](../../7-DEVELOPMENT/decisions/PDR-003-per-user-ownership-and-sharing.md), [TENANCY.md](../../TENANCY.md), [master plan WP2](../../commercialization/open-notebook-master-implementation-plan.md)

## Goal

Replace the single shared-password gate with production Entra ID authentication (OIDC Authorization Code + PKCE via a FastAPI BFF), per-user identity, roles, and owner-only data access — without building sharing/groups yet (WP2b).

## Prerequisites (verified complete before this work)

| Package | Status |
|---|---|
| WP0 Foundations | Done (PRs #1–#2) |
| WP1 Licensing | Done (PRs #3–#5) |
| WP-DEC Model A tenancy | Done (`docs/TENANCY.md`) |

## Locked decisions

| Topic | Choice |
|---|---|
| Tenancy | Model A — one isolated instance per client |
| Ownership | Strict per-user on notebooks/sources; sharing/groups = **WP2b** |
| Session | FastAPI **BFF** + opaque **httpOnly** session cookie + server-side `auth_session` |
| Deployment | UI + API behind **same-origin reverse proxy** (`SameSite=Lax`) |
| Admin bootstrap | Required `AUTH_ADMIN_EMAILS` (≥1); no empty allowlist; no first-login-as-admin |
| Day-to-day API auth | Session lookup — **not** re-validating Entra JWT on every request |
| Dev/CI fallback | `AUTH_PROVIDER=password` preserves today’s Bearer behaviour |

---

## §1 Architecture

```text
Browser ──same origin──► Reverse proxy
                           ├─ /       → Next.js UI
                           └─ /api/*  → FastAPI
```

### AuthProvider protocol

Thin plug-in so route handlers never import Entra SDK types:

- `PasswordAuthProvider` — local/CI; Bearer shared password; synthetic/seeded admin user
- `EntraOIDCProvider` — production; BFF login/callback/logout; session cookie
- Selected once at startup via `AUTH_PROVIDER=password|entra`
- Stub `GenericOIDCProvider` proves pluggability (acceptance criterion)

### FastAPI BFF endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/status` | `{ auth_enabled, provider }` — public |
| GET | `/api/auth/login` | Start Entra Auth Code + PKCE |
| GET | `/api/auth/callback` | Code exchange, JIT user, Set-Cookie, redirect UI |
| POST | `/api/auth/logout` | Delete session, clear cookie, optional Entra logout |
| GET | `/api/auth/me` | Current `AuthenticatedUser` |

### Middleware

`AuthMiddleware` delegates to the configured provider, sets `request.state.user`, returns **401** when auth is enabled and identity is missing/invalid. Entra mode is always fail-closed. Password mode with unset password remains open (today’s behaviour).

### Frontend (Entra mode)

- “Sign in with Microsoft” → full-page navigate to `/api/auth/login`
- `apiClient` uses `credentials: 'include'`; no Entra tokens in localStorage
- Password mode keeps existing Bearer + `auth-store` flow when `provider=password`

---

## §2 Data model

Migration **`24.surrealql`** (+ down + hard-coded `AsyncMigrationManager` entry).

### Table `user`

| Field | Notes |
|---|---|
| `email` | unique |
| `display_name` | from Entra |
| `entra_oid` | unique; null in password mode |
| `role` | `admin` \| `user` |
| `client_id` | from env `CLIENT_ID` (constant per instance) |
| `created` / `updated` | standard timestamps |

### Table `auth_session`

| Field | Notes |
|---|---|
| `session_token_hash` | hash of cookie value only |
| `user` | record\<user\> |
| `expires_at` | absolute expiry |
| `created_at` | |
| `entra_refresh_token_enc` | optional; encrypted; for renew / WP5 Graph later |

### Ownership columns

Add `user_id` (option\<record\<user\>\>) and `client_id` (option\<string\>) to **`notebook`** and **`source`**.

Notes / insights / chats: access via parent ownership in WP2 (no separate ACL columns).

### Pre-existing rows

- Migration leaves `user_id = NONE`
- Entra mode: rows with null `user_id` are **hidden** (fail closed)
- Optional ops script later to claim orphans → allowlisted admin (not automatic)

### Out of WP2 schema

No `group`, `share`, or `acl` tables — see PDR-003 WP2b backlog.

---

## §3 Auth flows

### Login → callback → session

1. UI → `GET /api/auth/login` → PKCE + state → 302 Entra
2. Entra → `GET /api/auth/callback`
3. Verify state; exchange code; validate id_token (issuer, audience, JWKS signature, expiry)
4. JIT upsert `user`; role from `AUTH_ADMIN_EMAILS`
5. Insert `auth_session`; Set-Cookie `HttpOnly; Secure; SameSite=Lax; Path=/`
6. 302 to UI `/`

### API request

Cookie → hash → session row (not expired) → load user → `request.state.user`. Else **401**.

### Logout

`POST /api/auth/logout` → delete session → clear cookie → optional Entra end_session redirect.

### CSRF

1. `SameSite=Lax`
2. Origin/Referer allowlist check on mutating methods

No double-submit token in WP2 unless Origin checks prove insufficient.

### Session lifetime

Default absolute **8 hours** (`AUTH_SESSION_HOURS=8`). Sliding expiry optional; absolute-only is acceptable for v1.

### Password mode

Existing password form + Bearer; login/callback unused; status returns `provider=password`.

---

## §4 Authorization

| Failure | Meaning |
|---|---|
| **401** | Not authenticated |
| **403** | Authenticated but forbidden |
| **404** on owned resources | Prefer over 403 when id exists but is not owned (no existence leak) |

### Roles

- **`user`**: CRUD on own notebooks/sources and dependent features (notes, chat, search, podcasts on owned data)
- **`admin`**: user powers + credentials, model mutations/defaults, settings, embedding rebuild

### Read vs write for models/providers

- `user` may **read** model list / provider catalog needed to use the app
- `user` may **not** mutate credentials, defaults, or rebuild embeddings

### Ownership enforcement

- Create: stamp `user_id` + `client_id`
- List/get: filter by current user
- Update/delete: not owner → **404**

### Admin-only routers (mutations / sensitive)

`credentials`, `models` (writes/defaults), `settings`, `embedding_rebuild`, provider write paths if any.

### Excluded paths

`/`, `/health`, `/api/auth/status`, `/api/auth/login`, `/api/auth/callback`, `/api/config` (non-secret). Prefer closing `/docs` in entra production via flag.

### Startup fail-closed

`AUTH_PROVIDER=entra` and missing/empty `AUTH_ADMIN_EMAILS` → API **refuses to start**.

---

## §5 Testing, acceptance, rollout

### Branch discipline

- `wp-2-entra-auth` from `main`
- No WP3 / WP2b on this branch
- PR only to **HariHaranDFX/open-notebook**; stop for human review when AC + CI green

### Tests

- Unit: JWKS/id_token checks, PKCE/state, session hash, allowlist → role, password provider
- API: middleware 401; admin 403; ownership filters; pluggability stub
- Frontend: provider-aware login UI; credentials include; route guards
- Manual E2E against real Entra (checklist in `docs/AUTH.md`, not CI-blocking)
- Coverage floors: backend ≥ 56%, frontend ≥ 35.79%
- Characterization updates must be intentional and called out in commits

### Acceptance criteria

- [ ] Entra login E2E (redirect → callback → session → UI)
- [ ] Protected API requires valid session; entra fail-closed
- [ ] JIT `user` after first login; role from required allowlist
- [ ] Startup fails if entra + empty/missing `AUTH_ADMIN_EMAILS`
- [ ] Admin routes return 403 for `user`
- [ ] Users only see/change own notebooks/sources
- [ ] Password provider works with `AUTH_PROVIDER=password`
- [ ] Stub second provider needs no route-handler changes
- [ ] `docs/AUTH.md` complete (app reg, proxy, env, password fallback, WP2b pointer)
- [ ] CI green on fork PR

### Rollout

1. Entra app registration (redirect `https://<host>/api/auth/callback`)
2. Env: `AUTH_PROVIDER=entra`, Entra vars, `AUTH_ADMIN_EMAILS`, `CLIENT_ID`, encryption key
3. Same-origin reverse proxy
4. API start runs migration 24
5. Smoke: admin creates notebook; second user cannot see it

### Deferred (WP2b — PDR-003)

- [ ] ACL / share grants (notebook & source → user)
- [ ] User groups + membership
- [ ] Admin allocate to users/groups
- [ ] List filters: owner OR grant OR group
- [ ] Share / allocate UI
- [ ] Sharing docs

---

## Env reference (WP2)

| Variable | Required when | Notes |
|---|---|---|
| `AUTH_PROVIDER` | always | `password` \| `entra` |
| `OPEN_NOTEBOOK_PASSWORD` | password mode | existing |
| `ENTRA_TENANT_ID` | entra | |
| `ENTRA_CLIENT_ID` | entra | |
| `ENTRA_CLIENT_SECRET` | entra | confidential BFF client |
| `ENTRA_REDIRECT_URI` | entra | must match proxy path |
| `AUTH_ADMIN_EMAILS` | entra | comma-separated; ≥1 required |
| `CLIENT_ID` | entra (recommended always) | stamped on users/rows; Model A constant |
| `AUTH_SESSION_HOURS` | optional | default 8 |
| `OPEN_NOTEBOOK_ENCRYPTION_KEY` | already required for credentials | also for optional refresh-token encryption |

---

## Non-goals (this package)

- Sharing, groups, admin allocation (WP2b)
- Multi-tenant Model B
- Next.js-as-BFF or SPA MSAL token storage
- Redis session store
- SAML (optional later via same AuthProvider socket)

## Spec self-review (2026-08-03)

- No TBD/TODO placeholders left in normative sections
- BFF + opaque session + allowlist + owner-only are consistent across §§1–5
- Scope is one implementable package; WP2b explicitly deferred
- Ambiguities resolved: session vs Entra-JWT-per-request; admin bootstrap; 404 on non-owned ids; users may read model catalog
