# WP3-06 Administration, Authentication, and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify administration under one local hierarchy, redesign login/global recovery states, and make WP2b roles, sharing origin, and destructive scope explicit without weakening authorization.

**Architecture:** Add one nested settings layout and local navigation, preserve old `/advanced` as a redirect, restyle existing settings/provider/group components, and convert sharing to the foundation Sheet. Add optional access-origin metadata to existing notebook/source responses while retaining `access_role` for compatibility. Additionally, stamp the podcast episode response with its notebook-inherited `access_role` and pass it into the existing `EpisodeActions` `role` seam, so podcast retry/delete gating is reflected in the UI — reusing the ownership helpers that already enforce it, with no authorization change.

**Tech Stack:** FastAPI/Pydantic, existing WP2b ownership helpers, Next.js nested layouts, Sheet, TanStack Query, Vitest, pytest.

## Global Constraints

- Administration routes: `/settings`, `/settings/api-keys`, `/settings/groups`, `/settings/advanced`; `/advanced` remains a working redirect.
- Current role and whether access is owner/direct/group/notebook/open are visible where permissions affect actions.
- Highest role still wins. Equal-role origin preference is direct user → group → notebook; owner/open remain explicit.
- Adding origin metadata is additive; existing `access_role` values and all authorization decisions remain unchanged.
- Viewer/editor/owner/admin controls follow WP2b exactly. Admin may allocate ACL but does not implicitly see all content.
- Forms use visible labels, inline validation, read-only distinction, explicit save boundaries, and separated destructive maintenance.
- Login restores the intended destination and never exposes API URL, frontend URL, credentials, internal IDs, or stack details.
- Podcast episodes expose the notebook-inherited effective role (`access_role`) additively; the UI **reflects** this role, it never recomputes access. Podcast/podcast-episode authorization (`_assert_episode_edit_or_403`, `filter_episodes_by_access`) stays the only enforcement boundary and is unchanged — hiding a button is never the security control, so the API must still 403 a viewer's retry/delete.
- The backend is the authorization boundary; the frontend `role` gate is cosmetic. The UI helper `canEditContent(undefined)` fails **open** (missing role = full access) and is safe only because the server fails closed — never let that default reach anything the server trusts.

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

### Task 2: Stamp podcast episodes with their notebook-inherited effective role

**Depends on:** existing WP2b ownership helpers only (`effective_role_for_notebook`). Independent of Task 1 — it adds `access_role`, not `access_summary`. This consciously extends the additive-metadata work to `api/routers/podcasts.py`, which Task 1's file list does not cover; record the extension as a pre-flight controller decision.

**Why:** Episode retry/delete is *already* enforced server-side (`_assert_episode_edit_or_403` → `assert_can_edit_notebook_or_403`; list/get filter via `filter_episodes_by_access`). But the episode response carries no role, so the UI's `EpisodeActions` `role` prop is `undefined` = full access, and a viewer sees Retry/Delete the API then 403s. This task makes the response report the same effective role the enforcement helpers compute, so the UI can **reflect** — never recompute — that decision. Authorization is unchanged; this is a UX/consistency fix, not a security fix.

**Files:**
- Modify: `api/ownership.py` — add `effective_role_for_episode`
- Modify: `api/routers/podcasts.py` — extend the `api.ownership` import (podcasts.py:9) with `AccessRole` + `effective_role_for_episode`; add `access_role` to `PodcastEpisodeResponse` (podcasts.py:147); populate it in `list_podcast_episodes` (podcasts.py:275) and `get_podcast_episode` (podcasts.py:341)
- Create: `tests/test_podcast_access_role.py`

**Interfaces:**
- Consumes: `effective_role_for_notebook` (api/ownership.py:172), `AccessRole` (api/ownership.py:16), `_same_owner` / `repo_query` / `ensure_record_id` / `auth_enforces_ownership` / `current_user_optional` (already in ownership.py)
- Produces:

```py
async def effective_role_for_episode(episode, request: Request) -> Optional[AccessRole]
```

`PodcastEpisodeResponse` gains `access_role: Optional[AccessRole] = None`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_podcast_access_role.py`, reusing the harness in `tests/test_ownership_notes_chat_podcasts.py`:

```py
"""Podcast episodes carry their notebook-inherited effective role (WP3-06)
without weakening the existing edit/delete enforcement."""

from unittest.mock import AsyncMock, patch

from tests.test_ownership_notes_chat_podcasts import (
    USER_A,
    USER_B,
    _client,
    _episode,
)


def _episode_in_notebook(episode_id, user_id, notebook_id="notebook:1"):
    ep = _episode(episode_id, user_id=user_id, client_id="client-1")
    ep.notebook_id = notebook_id
    return ep


def _role_query_side_effect(*, notebook_owner="user:c", grant_role=None):
    """Mock api.ownership.repo_query for the episode -> notebook -> grant path."""
    async def _side_effect(query, params=None):
        if "FROM user_group_member" in query:
            return []
        if "FROM resource_grant" in query:
            return [{"role": grant_role}] if grant_role else []
        if "FROM notebook" in query:
            return [{"user_id": notebook_owner}]
        return []

    return _side_effect


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_owner_episode_reports_owner_role(mock_get, mock_query, monkeypatch):
    mock_get.return_value = _episode("episode:1", user_id="user:a", client_id="client-1")
    mock_query.side_effect = _role_query_side_effect()
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "owner"


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_notebook_viewer_reports_viewer_role(mock_get, mock_query, monkeypatch):
    mock_get.return_value = _episode_in_notebook("episode:1", user_id="user:b")
    mock_query.side_effect = _role_query_side_effect(grant_role="viewer")
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "viewer"


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_notebook_editor_reports_editor_role(mock_get, mock_query, monkeypatch):
    mock_get.return_value = _episode_in_notebook("episode:1", user_id="user:b")
    mock_query.side_effect = _role_query_side_effect(grant_role="editor")
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "editor"


@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_open_mode_reports_owner_role(mock_get, monkeypatch):
    mock_get.return_value = _episode("episode:1", user_id="user:b")
    client = _client(monkeypatch, auth_enabled=False, user=None)

    response = client.get("/api/podcasts/episodes/episode:1")

    assert response.status_code == 200
    assert response.json()["access_role"] == "owner"


@patch("api.ownership.repo_query", new_callable=AsyncMock)
@patch("api.routers.podcasts.PodcastService.get_episode", new_callable=AsyncMock)
def test_notebook_viewer_delete_still_403(mock_get, mock_query, monkeypatch):
    """Enforcement is unchanged: the response says 'viewer' AND the API still
    forbids the delete. Hiding the button is never the security boundary."""
    mock_get.return_value = _episode_in_notebook("episode:1", user_id="user:b")
    mock_query.side_effect = _role_query_side_effect(grant_role="viewer")
    client = _client(monkeypatch, auth_enabled=True, user=USER_A)

    response = client.delete("/api/podcasts/episodes/episode:1")

    assert response.status_code == 403
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `uv run pytest tests/test_podcast_access_role.py -q`
Expected: FAIL — the response JSON has no `access_role` key (the owner/viewer/editor assertions raise `KeyError`).

- [ ] **Step 3: Add the resolver to `api/ownership.py`**

Mirror `filter_episodes_by_access` exactly so the response and the enforcement agree by construction:

```py
async def effective_role_for_episode(
    episode, request: Request
) -> Optional[AccessRole]:
    """Episode's effective role: owner if the episode owner, else inherited
    from its notebook. Mirrors filter_episodes_by_access / the edit guard so
    the response reflects the same decision the enforcement helpers make."""
    if not auth_enforces_ownership():
        return "owner"
    user = current_user_optional(request)
    if user is None:
        return "owner"
    if _same_owner(getattr(episode, "user_id", None), user.id):
        return "owner"
    nb_id = getattr(episode, "notebook_id", None)
    if not nb_id:
        return None
    rows = await repo_query(
        "SELECT user_id FROM notebook WHERE id = $id",
        {"id": ensure_record_id(str(nb_id))},
    )
    if not rows:
        return None
    return await effective_role_for_notebook(
        rows[0].get("user_id"), str(nb_id), request
    )
```

- [ ] **Step 4: Carry it on the response in `api/routers/podcasts.py`**

Extend the `api.ownership` import (podcasts.py:9) to include `AccessRole` and `effective_role_for_episode`. Add the field to the model (podcasts.py:147):

```py
class PodcastEpisodeResponse(BaseModel):
    ...
    error_message: Optional[str] = None
    access_role: Optional[AccessRole] = None
```

In `list_podcast_episodes`, inside the existing `for episode in episodes:` loop, add one keyword to the `PodcastEpisodeResponse(...)` constructed at podcasts.py:275:

```py
                    access_role=await effective_role_for_episode(episode, request),
```

In `get_podcast_episode`, add the same keyword to the `PodcastEpisodeResponse(...)` returned at podcasts.py:341.

- [ ] **Step 5: Run tests, verify pass + no enforcement regression**

Run: `uv run pytest tests/test_podcast_access_role.py tests/test_ownership_notes_chat_podcasts.py -q`
Expected: PASS. `test_notebook_viewer_delete_still_403` proves authorization is unchanged.

- [ ] **Step 6: Commit**

```powershell
git add api/ownership.py api/routers/podcasts.py tests/test_podcast_access_role.py
git commit -m "feat(podcasts): expose notebook-inherited access role on episodes"
```

### Task 3: Enforce podcast permissions in the UI by wiring the inherited role

**Depends on:** Task 2 (`access_role` on the episode payload).

**Why:** `RetryEpisodeButton` / `DeleteEpisodeAction` already gate on `role` (`EpisodeActions.tsx:101,132`), and `EpisodeCard` / `EpisodeDetail` already thread a `role?: AccessRole | null` prop down to them — but the two call sites pass nothing, so `role` is `undefined` = full access. Passing `episode.access_role` lights up the dormant seam. No new i18n keys (reuses `podcasts.retry` / `podcasts.delete`).

**Files:**
- Modify: `frontend/src/lib/types/podcasts.ts` — add `access_role` to `PodcastEpisode` (podcasts.ts:78) + a `type` import
- Modify: `frontend/src/components/podcasts/EpisodesTab.tsx:178` — pass `role={episode.access_role}` on `<EpisodeCard>`
- Modify: `frontend/src/app/(dashboard)/podcasts/[id]/page.tsx:89` — pass `role={episode.access_role}` on `<EpisodeDetail>`
- Modify: `frontend/src/components/podcasts/EpisodesTab.test.tsx` — add viewer/editor wiring tests

**Interfaces:**
- Consumes: `PodcastEpisodeResponse.access_role` (Task 2); the `role?: AccessRole | null` props on `EpisodeCard` (EpisodeCard.tsx:19) and `EpisodeDetail` (EpisodeDetail.tsx:24); `AccessRole` (`frontend/src/lib/utils/access-role.ts`)
- Produces: none

- [ ] **Step 1: Write the failing wiring tests**

Append to `frontend/src/components/podcasts/EpisodesTab.test.tsx` (reusing its `makeEpisode` / `mockEpisodes` helpers; translation keys render as literal strings under the global mock):

```ts
  it('hides retry and delete on a failed row when access is viewer', () => {
    mockEpisodes([
      makeEpisode({ id: 'episode:failed', job_status: 'failed', access_role: 'viewer' }),
    ])

    render(<EpisodesTab />)

    expect(screen.queryByText('podcasts.retry')).not.toBeInTheDocument()
    expect(screen.queryByText('podcasts.delete')).not.toBeInTheDocument()
  })

  it('keeps retry and delete on a failed row when access is editor', () => {
    mockEpisodes([
      makeEpisode({ id: 'episode:failed', job_status: 'failed', access_role: 'editor' }),
    ])

    render(<EpisodesTab />)

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
    expect(screen.getByText('podcasts.delete')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run, verify fail**

Run (in `frontend/`): `npm run test -- src/components/podcasts/EpisodesTab.test.tsx`
Expected: FAIL — the viewer row still renders `podcasts.retry` / `podcasts.delete` (role not wired), and `tsc` rejects `access_role` on `makeEpisode` until the type is added.

- [ ] **Step 3: Add `access_role` to the type**

In `frontend/src/lib/types/podcasts.ts`, add the import near the top:

```ts
import type { AccessRole } from '@/lib/utils/access-role'
```

and inside `export interface PodcastEpisode { … }` (podcasts.ts:78):

```ts
  /** Notebook-inherited effective role (WP3-06); absent = open mode = full access. */
  access_role?: AccessRole | null
```

- [ ] **Step 4: Pass the role at both call sites**

In `EpisodesTab.tsx`, on the `<EpisodeCard>` rendered at line 178, add the prop:

```tsx
                  role={episode.access_role}
```

In `podcasts/[id]/page.tsx`, on the `<EpisodeDetail>` rendered at line 89, add the same `role={episode.access_role}`.

- [ ] **Step 5: Run tests + static gates**

Run (in `frontend/`):

```
npm run test -- src/components/podcasts/EpisodesTab.test.tsx
npm run lint
npm run build
```

Expected: all pass (build confirms the type/`TranslationShape` parity is intact).

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/lib/types/podcasts.ts frontend/src/components/podcasts/EpisodesTab.tsx "frontend/src/app/(dashboard)/podcasts/[id]/page.tsx" frontend/src/components/podcasts/EpisodesTab.test.tsx
git commit -m "feat(podcasts): gate episode retry/delete on inherited access role"
```

### Task 4: Create one administration hierarchy

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

### Task 5: Redesign sharing as an explicit permission sheet

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

### Task 6: Redesign login and global recovery states

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

### Task 7: Visual verification and commit

- [ ] **Step 1: Inspect admin/auth/sharing states**

At all required widths/themes, verify admin subnavigation, long provider/group names, sticky save, read-only viewer, editor/owner differences, inherited access, podcast episode rows as a viewer (no Retry/Delete) vs editor/owner (both present) on both the studio list and the `/podcasts/[id]` detail page, ShareSheet focus/close, password/Entra, connection failure, 403, 404, reduced motion, and 200% zoom.

- [ ] **Step 2: Commit backend metadata**

The podcast episode role (Tasks 2–3) is already committed on its own; this commit covers the Task 1 notebook/source `access_summary` work only.

```powershell
git add api tests frontend/src/lib/types frontend/src/lib/utils
git commit -m "feat(sharing): expose effective access origin"
```

- [ ] **Step 3: Commit administration and gateway redesign**

```powershell
git add frontend/src
git commit -m "feat(frontend): redesign administration and sharing"
```
