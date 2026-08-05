# PDR-003: Per-user ownership now; sharing & groups after WP2

- **Status**: Accepted
- **Date**: 2026-08
- **Related**: [TENANCY.md](../../TENANCY.md) (Model A), [PDR-001](PDR-001-single-user-first.md) (extended for commercial fork), WP2 in [master plan](../../commercialization/open-notebook-master-implementation-plan.md)

## Context

WP2 replaces the shared password with Entra identity inside a Model A (single-tenant per client) instance. Product needs real multi-user behaviour: documents are private to the uploader by default, owners can share, and admins can allocate to users or groups. Building full ACL + groups in the same package as Entra auth doubles risk and surface area. Identity must land correctly first.

## Decision

**Target product rule (do not forget):**

1. Notebooks and sources are **owned** by the creating user (`user_id`). Private by default.
2. An **owner** may later **share** a notebook/source with other users in the same instance.
3. An **admin** may later **allocate** notebooks/sources to **users** and/or **user groups**.
4. Cross-client isolation remains **physical** (Model A) — no cross-instance sharing.

**Phasing (agreed 2026-08-03):**

| Phase | Package | In scope |
|---|---|---|
| **Now** | **WP2** | Entra OIDC identity, roles (`admin` / `user`), JIT `user` model, stamp `user_id` (+ `client_id` constant), **owner-only** create/read filters |
| **Next** | **WP2b** (after WP2 merges) | Share-to-user, user groups, admin allocation, permission checks beyond owner-only |

**Auth session (agreed 2026-08-03):** **BFF** — FastAPI performs OIDC Authorization Code + PKCE, sets httpOnly cookies; browser does not store Entra tokens. **Deployment shape:** UI and API served behind a **same-origin reverse proxy** so the session cookie is first-party (`SameSite=Lax`). Cross-origin cookie setups and Next.js-as-BFF are out of scope for WP2.

**Admin bootstrap (agreed 2026-08-03):** `AUTH_ADMIN_EMAILS` allowlist is **required** and must contain **at least one** email. Matching emails get `admin` on JIT provision; all others get `user`. **No** “first login wins admin” and **no** empty allowlist — startup must fail closed if the allowlist is missing/empty when `AUTH_PROVIDER=entra`.

WP2 schema must not preclude WP2b: keep `user_id` / `client_id` on notebooks and sources; do **not** invent a throwaway visibility model that must be rewritten for ACLs.

## Alternatives considered

- **Full sharing + groups inside WP2** — rejected: highest-risk auth change plus ACL/UI in one branch.
- **Shared instance workspace (everyone sees everything; roles only on settings)** — rejected: product requires strict per-user ownership of uploads.
- **Per-user ownership only forever** — rejected: sharing and admin allocation are required; deferred, not dropped.

## Consequences

- WP2 acceptance criteria stay: users only see **their own** notebooks/sources until WP2b.
- Characterization tests that assume global data must be updated intentionally in WP2.
- **WP2b backlog (implemented on `wp-2b-sharing`):**
  - [x] ACL / share grants (notebook & source → user/group, viewer/editor)
  - [x] User **groups** model + membership (app-local; Entra sync later)
  - [x] Admin **allocate** to users and groups (same grant API)
  - [x] List/get filters: owner **OR** explicit grant **OR** group grant
  - [x] Share / allocate UI (owner + admin)
  - [x] Docs: `docs/SHARING.md` + AUTH.md pointer
- PDR-001 remains the upstream OSS posture; this record is the **commercial fork** multi-user rule under Model A.
