# WP3-02 Collection Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign notebook and source collection routes as calm libraries with clear search, sort, state, ownership, recovery, and user-selectable list/card views while preserving current actions and pagination.

**Architecture:** Reuse `PageFrame`, `PageHeader`, existing hooks, dialogs, and mutations. Keep notebook filtering client-side because both active and archived collections are already loaded; add one optional server-side source-title query because the source collection is paginated and client-only filtering would be incomplete.

**Tech Stack:** Next.js route components, TanStack Query, existing FastAPI source list endpoint, Radix controls, Vitest, pytest.

## Global Constraints

- Notebook and source libraries follow: title + one primary action → search/filter/sort/view → collection → pagination/infinite loading.
- List rows and cards expose title, type, ownership/role, processing state, useful counts, and updated time without requiring detail navigation.
- The complete row/card surface opens its resource through one native link; row/card actions remain separate and above the stretched-link layer with no nested interactive markup.
- Sources and notebooks each remember their independently selected list/card view after navigation and reload; render list view until the persisted store hydrates.
- No hover-only actions. Overflow may hold infrequent actions, but its trigger remains visible.
- Removing a source from a notebook and deleting it globally retain distinct labels and confirmations.
- Active, archived, and recently viewed work remain reachable; do not add a dashboard.
- Mobile uses one-column list/card stacks with no horizontal table scroll; card grids expand to two and then three columns as space permits.
- Semantic interactive elements across the app use the pointer cursor; disabled controls use the unavailable cursor and text-entry controls keep text-entry behavior.

---

### Task 1: Add paginated source-title filtering at the existing boundary

**Files:**
- Modify: `api/routers/sources.py`
- Modify: `frontend/src/lib/api/sources.ts`
- Create: `tests/test_source_list_query.py`

**Interfaces:**
- Produces: optional `query?: string` on `sourcesApi.list()`; omitted query preserves the current REST behavior.
- Consumes: existing ownership/access clause and sort allowlist.

- [ ] **Step 1: Write failing API tests**

Cover a case-insensitive title query, an empty query behaving like omission, query plus pagination/sort, and ownership/access filtering still applying before results are returned. Mock `repo_query` and assert the query string uses a bound `$title_query` parameter rather than interpolating user text.

```py
def test_source_query_is_bound_and_combined_with_access(monkeypatch):
    captured = {}

    async def fake_query(query, params):
        captured.update(query=query, params=params)
        return []

    monkeypatch.setattr(sources_router, "repo_query", fake_query)
    # call get_sources with query="Lithium", limit=30, offset=0
    assert "$title_query" in captured["query"]
    assert captured["params"]["title_query"] == "lithium"
```

- [ ] **Step 2: Run the focused backend test and verify red**

Run:

```powershell
uv run pytest tests/test_source_list_query.py -q
```

Expected: failure because `query` is not accepted.

- [ ] **Step 3: Implement the optional bound filter**

Add `query: Optional[str] = Query(None, max_length=200)` to `get_sources`. Normalize with `strip().lower()`. Combine `string::lowercase(title OR '') CONTAINS $title_query` with the existing access predicate using `AND`; never replace or bypass the access clause.

Add `query?: string` to the `sourcesApi.list()` parameter type. Do not add a new endpoint.

- [ ] **Step 4: Run the test and verify green**

Run the focused test, then `uv run pytest tests/test_ownership_notebooks.py tests/test_access_grants_unit.py -q`. Expected: exit 0.

### Task 2: Move source-library fetching into the existing hook layer

**Files:**
- Modify: `frontend/src/lib/api/query-client.ts`
- Modify: `frontend/src/lib/hooks/use-sources.ts`
- Create: `frontend/src/lib/hooks/use-source-library.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface SourceLibraryParams {
  query: string
  sortBy: SourceSortField
  sortOrder: 'asc' | 'desc'
}

export function useSourceLibrary(params: SourceLibraryParams): {
  sources: SourceListResponse[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  refetch: () => void
  error: Error | null
}
```

- [ ] **Step 1: Write the failing hook test**

Mock `sourcesApi.list`, render the hook inside a QueryClient, and assert that the first request uses `{ query, sort_by, sort_order, limit: 30, offset: 0 }`; the next page uses offset 30; changing query creates a new query key.

- [ ] **Step 2: Implement with `useInfiniteQuery`**

Add `QUERY_KEYS.sourceLibrary(params)` and flatten pages exactly as `useNotebookSources` does. Keep broad `['sources']` invalidation compatible with the new key.

- [ ] **Step 3: Verify the hook**

Run `npm run test -- src/lib/hooks/use-source-library.test.tsx` from `frontend/`. Expected: pass.

### Task 3: Redesign the notebook library

**Files:**
- Modify: `frontend/src/app/(dashboard)/notebooks/page.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookList.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookRow.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/RecentlyViewed.tsx`
- Create: `frontend/src/app/(dashboard)/notebooks/components/NotebookList.test.tsx`
- Delete: `frontend/src/app/(dashboard)/notebooks/components/NotebookCard.tsx`
- Delete: `frontend/src/lib/stores/notebook-view-store.ts`

**Interfaces:**
- Consumes: `PageFrame`, `PageHeader`, current notebook hooks, create/archive/delete dialogs, and WP2b `access_role`.
- Produces: one responsive row view with active, recent, and archived sections.

- [ ] **Step 1: Write failing list tests**

Assert loading renders skeleton rows, empty active state exposes the create action, search with no match exposes clear guidance, archived content is collapsible, every notebook has one named link, and row actions are visible without hover.

- [ ] **Step 2: Replace the tile/list branch**

Remove `NotebookCard`, the view toggle, and `notebook-view-store`. Use `PageHeader` with “New notebook” as the sole primary action, search as a visible labeled control, and rows for every collection state.

Keep `RecentlyViewed` inside the library as a mixed-resource collection that follows the selected view: compact rows in List mode and concise cards in Card mode. Preserve notebook/source links and timestamps.

- [ ] **Step 3: Apply role-aware row actions**

After WP2b, show the effective role as a labeled status. Editors may archive/update metadata; only owner/open mode may delete the notebook; owners/admins receive the existing Share action. Keep the backend authoritative when a stale role produces 403.

- [ ] **Step 4: Verify notebooks**

Run:

```powershell
npm run test -- 'src/app/(dashboard)/notebooks/components/NotebookList.test.tsx' src/lib/utils/access-role.test.ts
```

Expected: pass.

### Task 4: Redesign the source library

**Files:**
- Modify: `frontend/src/app/(dashboard)/sources/page.tsx`
- Create: `frontend/src/components/sources/SourceLibraryRow.tsx`
- Create: `frontend/src/components/sources/SourceLibraryRow.test.tsx`
- Modify: `frontend/src/components/sources/AddSourceButton.tsx`
- Modify: every locale file under `frontend/src/lib/locales/`

**Interfaces:**
- Consumes: `useSourceLibrary`, `PageFrame`, `PageHeader`, source mutations, status polling, and WP2b access role.
- Produces: source rows that reflow into labeled stacks below 768px.

- [ ] **Step 1: Write failing row tests**

For completed, queued, processing, partial-data, failed, viewer, editor, and owner fixtures, assert visible type, title, status text/icon, embedding state, insight count, access role, open link, and permitted actions. Assert the delete trigger is absent for editor/viewer and retry remains visible for a failed editable source.

- [ ] **Step 2: Replace the page monolith with the hook and row**

Keep page-owned query, sort, and delete-confirmation state. Replace the fixed 920px table and global keyboard listener with semantic rows, a visible search label, sort select, direction control, primary Add sources action, and a “Load more” boundary backed by `fetchNextPage`.

Do not use hover to change keyboard selection. Native links and buttons provide navigation and actions. Preserve URL-safe source IDs and the existing delete confirmation.

- [ ] **Step 3: Add only required locale keys**

Add keys for source-library search label, sort label, access-role label, load-more action, and partial state in all locales. Reuse existing type, status, retry, delete, and empty-state keys.

- [ ] **Step 4: Verify sources and locale parity**

Run:

```powershell
npm run test -- src/components/sources/SourceLibraryRow.test.tsx src/lib/locales/index.test.ts
npm run lint
npm run build
```

Expected: all commands exit 0.

### Task 5: Restore accessible list/card choice and complete-surface navigation

**Files:**
- Create: `frontend/src/lib/stores/library-view-store.ts`
- Create: `frontend/src/lib/stores/library-view-store.test.ts`
- Modify: `frontend/src/app/(dashboard)/notebooks/page.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookList.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookRow.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/RecentlyViewed.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookList.test.tsx`
- Create: `frontend/src/app/(dashboard)/notebooks/components/RecentlyViewed.test.tsx`
- Modify: `frontend/src/app/(dashboard)/sources/page.tsx`
- Modify: `frontend/src/components/sources/SourceLibraryRow.tsx`
- Modify: `frontend/src/components/sources/SourceLibraryRow.test.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/lib/design-system.test.ts`
- Modify: every locale file under `frontend/src/lib/locales/`

**Interfaces:**
- Produces: `LibraryViewMode = 'list' | 'card'` and `setViewMode(library, mode)` for the `notebooks` and `sources` libraries.
- Produces: `viewMode?: LibraryViewMode` on reusable notebook/source collection items.

- [x] **Step 1: Write failing tests**

Assert independent persisted view preferences, list/card collection classes, a complete-surface stretched native link, action controls above the link layer, and global semantic pointer/disabled cursor selectors.

- [x] **Step 2: Implement the minimal shared view preference**

Use the already-installed Zustand persist middleware with the unique `library-view-storage` key. Default both libraries to list and expose hydration state so server and first client render agree.

- [x] **Step 3: Implement reusable list/card variants**

Add a labeled, pressed-state view switch to each library toolbar. Reuse `NotebookRow` and `SourceLibraryRow` with a `viewMode` prop; do not restore duplicate card components or JavaScript router navigation.

- [x] **Step 4: Make each complete surface a native link**

Use a pseudo-element stretched link inside a relatively positioned article. Keep retry and overflow controls in a higher stacking context. Apply visible focus to the complete article with `:focus-within` without hiding the native link name.

- [x] **Step 5: Add global semantic cursor behavior and translations**

Scope pointer cursors to enabled links, buttons, selects, summaries, labels for controls, and enabled ARIA button/menu/tab/options. Scope `not-allowed` to disabled or `aria-disabled` controls. Add list/card view labels to all locales.

- [x] **Step 6: Verify the refinement**

Run focused store/component/design-system tests, locale parity, lint, and the production build.

### Task 6: Visual verification and commit

- [ ] **Step 1: Inspect both libraries**

At 375, 768, 1024, and 1440px in light/dark mode, verify one primary action, visible search/sort, row reflow, long translated titles, no horizontal scroll, visible focus, and explicit destructive scope.

- [ ] **Step 2: Commit**

```powershell
git add api/routers/sources.py tests/test_source_list_query.py frontend/src
git commit -m "feat(frontend): redesign notebook and source libraries"
```
