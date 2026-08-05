# WP2b Sharing ACL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship notebook/source ACL (viewer/editor), app-local groups, admin allocate, and role-aware UI per [spec](../specs/2026-08-06-wp2b-sharing-acl-design.md).

**Architecture:** Extend `api/ownership.py` with grant-aware access helpers; one `resource_grant` table + local `user_group`; stamp `episode.notebook_id` for podcast inheritance; no new ACL libraries.

**Tech Stack:** FastAPI, SurrealDB migrations, Next.js, Vitest/pytest, existing auth deps.

## Global Constraints

- Branch: `wp-2b-sharing` from `main` only; never mix WP3.
- No GPL/AGPL deps; no Casbin/OPA.
- Coverage may only go up; intentional characterization updates allowed.
- i18n: every new UI string in all locales.
- Auth off / password-open: access helpers remain no-op.
- Editor cannot delete sources; viewer cannot generate/delete podcasts.
- User picker = DB users only; groups `source=local` for now.
- PRs only to HariHaranDFX/open-notebook.

---

### Task 1: Schema migration 28

**Files:**
- Create: `open_notebook/database/migrations/28.surrealql`
- Create: `open_notebook/database/migrations/28_down.surrealql`
- Modify: `open_notebook/database/async_migrate.py` (register 28)

- [ ] Define `user_group`, `user_group_member`, `resource_grant`, `episode.notebook_id`
- [ ] Register up/down in AsyncMigrationManager
- [ ] Verify manager lists 28 migrations

---

### Task 2: Access helpers (TDD)

**Files:**
- Modify: `api/ownership.py`
- Create: `tests/test_access_grants.py`

- [ ] RED: tests for view via user grant, view via group, highest-wins editor, source delete owner-only, manage ACL owner/admin
- [ ] GREEN: implement `list_user_group_ids`, `access_where`, `effective_role`, assert helpers
- [ ] Keep `ownership_where` / `assert_owner_or_404` as thin wrappers or migrate call sites

---

### Task 3: Groups + users + grants API (TDD)

**Files:**
- Create: `api/routers/groups.py`, `api/routers/grants.py`, `api/routers/users.py` (or combine)
- Modify: `api/main.py`
- Create: `tests/test_groups_api.py`, `tests/test_grants_api.py`

- [ ] Admin CRUD groups + members
- [ ] Authenticated `GET /api/users` (id, email, display_name only)
- [ ] Notebook/source grant CRUD (owner or admin)
- [ ] Wire routers

---

### Task 4: Wire routers to access helpers

**Files:**
- Modify: `api/routers/notebooks.py`, `sources.py`, `notes.py`, `chat.py`, `source_chat.py`, `podcasts.py`, `search.py`, `insights.py`
- Modify: `api/podcast_service.py` + episode model (stamp `notebook_id`)
- Update: `tests/test_ownership_*.py` for new semantics

- [ ] List/get use `access_where` / `assert_can_view_or_404`
- [ ] Mutations use edit/delete rules per matrix
- [ ] Responses include `access_role`
- [ ] Podcast list/play/delete/generate honor matrix + notebook_id

---

### Task 5: Frontend Share + Groups

**Files:**
- Hooks/API clients under `frontend/src/lib/`
- Share dialog component; Groups admin page
- Role gating on notebook/source/podcast actions
- Locales (all)

- [ ] Share UI for notebook (+ source)
- [ ] Admin Groups under settings
- [ ] Hide/disable actions by `access_role`

---

### Task 6: Docs + close-out

**Files:**
- Create: `docs/SHARING.md`
- Modify: `docs/AUTH.md`, `CLAUDE.md`, `scripts/wbs_tasks.py`, regenerate WBS Excel

- [x] Document model, roles, Entra sync future
- [x] WBS: WP2b Done **4.15–4.18**, review **4.19**; deferred Pending **4.20–4.22**
- [ ] Acceptance checklist against spec + CI green
- [ ] Stop for human review (do not start WP3 on this branch)

### Explicitly deferred (WBS Pending — do not implement in WP2b)

| WBS | Item |
|---|---|
| **4.20** | Entra ID group sync (main post-WP2b group goal; schema ready) |
| **4.21** | Full org directory user picker via Microsoft Graph |
| **4.22** | Public links, editor reshare, ownership transfer |
