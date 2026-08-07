# WP3-06 Administration, Authentication, and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify administration under one local hierarchy, redesign login/global recovery states, and make WP2b roles, sharing origin, and destructive scope explicit without weakening authorization.

**Architecture:** Add one nested settings layout and local navigation, preserve old `/advanced` as a redirect, restyle existing settings/provider/group components, and convert sharing to the foundation Sheet. Add optional access-origin metadata to existing notebook/source responses while retaining `access_role` for compatibility.

**Tech Stack:** FastAPI/Pydantic, existing WP2b ownership helpers, Next.js nested layouts, Sheet, TanStack Query, Vitest, pytest.

## Global Constraints

- Administration routes: `/settings`, `/settings/api-keys`, `/settings/groups`, `/settings/advanced`; `/advanced` remains a working redirect.
- Current role and whether access is owner/direct/group/notebook/open are visible where permissions affect actions.
- Highest role still wins. Equal-role origin preference is direct user → group → notebook; owner/open remain explicit.
- Adding origin metadata is additive; existing `access_role` values and all authorization decisions remain unchanged.
- Viewer/editor/owner/admin controls follow WP2b exactly. Admin may allocate ACL but does not implicitly see all content.
- Forms use visible labels, inline validation, read-only distinction, explicit save boundaries, and separated destructive maintenance.
- Login restores the intended destination and never exposes API URL, frontend URL, credentials, internal IDs, or stack details.

---

### Task 1: Add access-origin metadata without changing authorization

**Files:**
- Modify after WP2b merge: `api/ownership.py`
- Modify: `api/models.py`
- Modify: `api/routers/notebooks.py`
- Modify: `api/routers/sources.py`
- Modify: `frontend/src/lib/types/api.ts`
- Modify: `frontend/src/lib/utils/access-role.ts`
- Create: `tests/test_access_origin.py`
- Modify: `frontend/src/lib/utils/access-role.test.ts`

**Interfaces:**
- Produces:

```py
AccessOrigin = Literal["owner", "direct", "group", "notebook", "open"]

class AccessSummary(BaseModel):
    role: Literal["owner", "editor", "viewer"]
    origin: AccessOrigin
    origin_label: Optional[str] = None
```

Notebook/source response models retain `access_role` and add `access_summary: Optional[AccessSummary] = None`.

- [ ] **Step 1: Write failing origin tests**

Cover owner, direct user grant, group grant with group name, source access inherited from notebook, open/auth-off mode, higher role beating preferred origin, and equal role preferring direct over group over notebook. Assert existing assert/edit/delete helpers return the same role/status as before.

- [ ] **Step 2: Implement one summary resolver**

Refactor internal grant lookup to retain role plus origin metadata, then derive the existing effective role from the summary. Do not duplicate access queries in routers. Redact labels to the group name or linked notebook name only; never expose user IDs as labels.

- [ ] **Step 3: Populate responses additively**

Set both `access_role=summary.role` and `access_summary=summary` in notebook/source list/detail responses. Open mode uses owner role with open origin so current clients keep full access.

- [ ] **Step 4: Update frontend types/helpers**

Add `AccessOrigin` and `AccessSummary`. Keep existing permission helpers; add `describeAccess(summary, t)` only for presentation and test every origin.

- [ ] **Step 5: Verify backend/frontend permission behavior**

Run:

```powershell
uv run pytest tests/test_access_origin.py tests/test_access_grants_unit.py tests/test_ownership_notebooks.py tests/test_ownership_notes_chat_podcasts.py -q
```

Then from `frontend/`: `npm run test -- src/lib/utils/access-role.test.ts`. Expected: exit 0.

### Task 2: Create one administration hierarchy

**Files:**
- Create: `frontend/src/app/(dashboard)/settings/layout.tsx`
- Create: `frontend/src/components/settings/AdminNav.tsx`
- Create: `frontend/src/components/settings/AdminNav.test.tsx`
- Create: `frontend/src/app/(dashboard)/settings/advanced/page.tsx`
- Move: `frontend/src/app/(dashboard)/advanced/components/SystemInfo.tsx` to `frontend/src/components/settings/SystemInfo.tsx`
- Move: `frontend/src/app/(dashboard)/advanced/components/RebuildEmbeddings.tsx` to `frontend/src/components/settings/RebuildEmbeddings.tsx`
- Replace: `frontend/src/app/(dashboard)/advanced/page.tsx` with a server redirect
- Modify: `frontend/src/app/(dashboard)/settings/page.tsx`
- Modify: `frontend/src/app/(dashboard)/settings/api-keys/page.tsx`
- Modify after WP2b merge: `frontend/src/app/(dashboard)/settings/groups/page.tsx`
- Modify: `frontend/src/components/layout/AppSidebar.tsx`

**Interfaces:**
- Produces admin navigation items for General, Models and credentials, Groups, and Advanced.
- Consumes AppShell/PageFrame/PageHeader.

- [ ] **Step 1: Write failing navigation tests**

Assert all four labeled links, active state for nested paths, AdminOnly wrapping, mobile subnavigation control, and `/advanced` redirect target `/settings/advanced`.

- [ ] **Step 2: Add the nested layout**

The settings layout renders AppShell → AdminOnly → responsive AdminNav + page content. Remove duplicate AppShell/AdminOnly wrappers from child pages. Desktop uses a compact local rail/list; phone uses a labeled Select or Sheet.

- [ ] **Step 3: Preserve the old route**

`frontend/src/app/(dashboard)/advanced/page.tsx` becomes:

```ts
import { redirect } from 'next/navigation'

export default function AdvancedRedirect() {
  redirect('/settings/advanced')
}
```

Move the two advanced components to shared settings components and import them from the new page.

- [ ] **Step 4: Apply page scaffolding and save boundaries**

Use PageHeader on each page. General Settings keeps its single save action visible at the form boundary; API Keys separates encryption warning, defaults, providers, and help; Advanced separates system info from destructive rebuild; Groups separates create, group selection, membership, and deletion.

- [ ] **Step 5: Verify admin hierarchy**

Run AdminNav, SettingsForm, API keys, ProviderSection, groups, navigation, and locale tests. Expected: pass.

### Task 3: Redesign sharing as an explicit permission sheet

**Files:**
- Modify after WP2b merge: `frontend/src/components/sharing/ShareDialog.tsx`
- Rename to: `frontend/src/components/sharing/ShareSheet.tsx`
- Create: `frontend/src/components/sharing/ShareSheet.test.tsx`
- Modify: notebook/source callers imported from WP2b
- Modify: every locale file under `frontend/src/lib/locales/`

**Interfaces:**
- Keeps existing props except component name:

```ts
interface ShareSheetProps {
  resourceType: 'notebook' | 'source'
  resourceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canManage: boolean
  accessSummary?: AccessSummary | null
}
```

- [ ] **Step 1: Write failing permission tests**

Assert current access summary, owner effect, direct user/group grants, viewer/editor labels, add/update/revoke states, admin group option, owner user-only behavior, no rendering without manage permission, and unsaved/pending close protection.

- [ ] **Step 2: Convert Dialog to Sheet**

Use the existing grant hooks and mutations. Render current role/origin first, then grant rows, then add-access controls. Label inherited group/notebook access distinctly from direct grants. Disable duplicate mutation while pending and keep errors inline beside the failed operation.

- [ ] **Step 3: Make revocation scope explicit**

Revoke copy names the principal and resource and states that other direct/group/notebook access can still apply. Do not promise total loss of access when another grant may remain.

- [ ] **Step 4: Verify sharing and locale parity**

Run ShareSheet, access-role, notebook/source caller, and locale tests. Expected: pass.

### Task 4: Redesign login and global recovery states

**Files:**
- Modify: `frontend/src/components/auth/LoginForm.tsx`
- Create: `frontend/src/components/auth/LoginForm.test.tsx`
- Modify: `frontend/src/components/common/ConnectionGuard.tsx`
- Modify: `frontend/src/components/errors/ConnectionErrorOverlay.tsx`
- Modify: `frontend/src/components/common/ContentUnavailable.tsx`
- Modify: `frontend/src/components/common/ErrorBoundary.tsx`
- Modify: `frontend/src/components/common/LanguageLoadingOverlay.tsx`

**Interfaces:**
- Preserves password/Entra auth and `redirectAfterLogin`.
- Produces safe setup, connection, 401 restore, 403 read-only, and 404 return presentation.

- [ ] **Step 1: Write login/recovery tests**

Assert visible password label, password show/hide, password and Entra paths, intended destination restore, connection retry, no rendered API/frontend URL, no console instruction, and keyboard focus on the first actionable control after an error.

- [ ] **Step 2: Remove diagnostic leakage from login**

Delete `getConfig` loading and the API/frontend URL block. Keep safe product version only if already available without a network diagnostic request; otherwise omit it. Add a visible password label and native autocomplete.

- [ ] **Step 3: Apply the gateway visual world**

Use canvas/surface/border tokens, restrained product identity, one sign-in action, and no marketing hero. Restyle global overlays with exact cause + recovery, polite/alert live regions, and preserved destination/context.

- [ ] **Step 4: Verify global states**

Run login, auth-store, ContentUnavailable, config route, locale tests, lint, and build. Expected: all pass.

### Task 5: Visual verification and commit

- [ ] **Step 1: Inspect admin/auth/sharing states**

At all required widths/themes, verify admin subnavigation, long provider/group names, sticky save, read-only viewer, editor/owner differences, inherited access, ShareSheet focus/close, password/Entra, connection failure, 403, 404, reduced motion, and 200% zoom.

- [ ] **Step 2: Commit backend metadata**

```powershell
git add api tests frontend/src/lib/types frontend/src/lib/utils
git commit -m "feat(sharing): expose effective access origin"
```

- [ ] **Step 3: Commit administration and gateway redesign**

```powershell
git add frontend/src
git commit -m "feat(frontend): redesign administration and sharing"
```
