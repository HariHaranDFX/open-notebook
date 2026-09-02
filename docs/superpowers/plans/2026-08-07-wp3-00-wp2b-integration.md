# WP3-00 WP2b Integration Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the completed WP2b sharing work into `codex/wp3-app-redesign` and establish a green, permission-aware baseline before changing frontend design.

**Architecture:** Merge the complete branch because WP2b spans migrations, FastAPI access helpers, REST routes, frontend hooks/components, localization, and tests. Resolve no design changes during the merge; verification proves the inherited behavior before WP3 touches it.

**Tech Stack:** Git, FastAPI, SurrealDB migrations, pytest, Next.js, Vitest, ESLint.

## Global Constraints

- Starting WP3 checkpoint: `929253d` (`docs: define WP3 product and design contract`).
- WP2b source branch: `wp-2b-sharing` at `fb1c4c4`.
- Verified merge base: `4967823f7ad2a3bf052b43d7c99afffef9c30faf`.
- Read-only merge preview on 2026-08-07 reported zero changed-in-both files and zero conflict markers.
- WP2b includes 58 files, 3,666 insertions, migration 28, ACL APIs, groups, ShareDialog, role gating, all-locale strings, and tests.
- Do not squash, cherry-pick selected files, or reimplement WP2b inside WP3.
- Do not start visual changes in this work package.

---

### Task 1: Reconfirm the merge inputs

**Files:** None.

**Interfaces:**
- Consumes: clean `codex/wp3-app-redesign` at or after `929253d`.
- Produces: verified branch references and a clean worktree.

- [ ] **Step 1: Verify branch and worktree**

Run:

```powershell
git branch --show-current
git status --short
git show -s --format="%H %s" wp-2b-sharing
```

Expected: current branch is `codex/wp3-app-redesign`; status is empty; WP2b resolves to `fb1c4c4d748a2ab143d42b8e420fa157c34a1604`.

- [ ] **Step 2: Re-run the non-mutating merge preview**

Run:

```powershell
$base = git merge-base HEAD wp-2b-sharing
git merge-tree $base HEAD wp-2b-sharing | Select-String 'changed in both|<<<<<<<|^CONFLICT '
```

Expected: no output. If output appears, stop and create a conflict-specific addendum before merging.

### Task 2: Merge WP2b as one integration unit

**Files:** The merge brings the 58-file WP2b delta; do not edit files manually in this task.

**Interfaces:**
- Consumes: verified WP2b branch.
- Produces: migration 28, sharing/group APIs, frontend sharing types/hooks/components, and permission-aware UI on WP3.

- [ ] **Step 1: Merge with an explicit merge commit**

Run:

```powershell
git merge --no-ff wp-2b-sharing -m "merge: integrate WP2b sharing into WP3"
```

Expected: merge completes without conflicts and creates a two-parent commit.

- [ ] **Step 2: Verify merge shape**

Run:

```powershell
git show -s --format="%H%n%P%n%s" HEAD
git status --short
```

Expected: subject is `merge: integrate WP2b sharing into WP3`, two parent hashes are printed, and status is empty.

### Task 3: Verify backend sharing and ownership behavior

**Files:** No edits unless a test exposes a genuine integration regression; diagnose before changing code.

**Interfaces:**
- Consumes: merged ACL helpers and routers.
- Produces: evidence that ownership, viewer/editor roles, groups, and migrations still work.

- [ ] **Step 1: Run targeted ACL tests**

Run:

```powershell
uv run pytest tests/test_access_grants_unit.py tests/test_ownership_notebooks.py tests/test_ownership_notes_chat_podcasts.py -q
```

Expected: exit 0 with all selected tests passing.

- [ ] **Step 2: Run the full backend suite**

Run:

```powershell
uv run pytest tests/
```

Expected: exit 0. Record any documented environment-only skip; do not waive failures.

### Task 4: Verify frontend sharing integration

**Files:** No edits unless a test exposes a genuine integration regression.

**Interfaces:**
- Consumes: `ShareDialog`, groups route, access-role helpers, and locale additions.
- Produces: a green frontend baseline for WP3-01.

- [ ] **Step 1: Run permission and navigation tests**

Run from `frontend/`:

```powershell
npm run test -- src/lib/utils/access-role.test.ts src/components/layout/AppSidebar.test.tsx src/lib/locales/index.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run all frontend verification**

Run from `frontend/`:

```powershell
npm run test
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 3: Checkpoint**

Do not add a second commit when the merge and tests are clean. Record the merge commit hash in the WP3 execution log and proceed to WP3-01 only after human approval.
