# Source and Notebook Keyset Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace offset pagination on the Sources library with stable cursor/keyset pagination and add the same pagination model to the active and archived Notebooks libraries.

**Architecture:** Add backend-issued opaque cursors at library-specific API boundaries so the existing complete-list endpoints can continue serving notebook/source selectors without truncation. Both library hooks use TanStack `useInfiniteQuery`; list and card modes consume the same accumulated pages, while Recently Viewed remains a deliberately capped, non-paginated collection.

**Tech Stack:** FastAPI, SurrealDB, Pydantic, Next.js, TanStack Query, Axios, pytest, Vitest.

**Spec:** `docs/superpowers/plans/2026-08-07-wp3-02-collection-libraries.md` and `DESIGN.md`.

## Global Constraints

- Defer execution until the `wp3-app-redesign` work is complete.
- Use keyset predicates; the Sources and Notebooks library routes must not use `START`, `OFFSET`, or an offset-derived page number.
- Every sort uses the selected field plus record `id` as a deterministic tie-breaker.
- Cursors are opaque, versioned, URL-safe, backend-issued, and rejected with HTTP 400 when malformed or used with different query/sort/filter parameters.
- Apply ownership/access and text filters before keyset pagination so page boundaries cannot expose inaccessible records.
- Return `limit + 1` records internally, expose at most `limit`, and issue `next_cursor` only when another page exists.
- Changing search, sort field, sort direction, or archived state starts a fresh query with no cursor.
- List and card views show the same loaded records and pagination state; switching view must not refetch or reset the collection.
- Preserve current actions, processing polling, role checks, empty/error states, and persisted view preference.
- Keep `GET /sources` and `GET /notebooks` compatible for dialogs, command palette, podcasts, notebook associations, and other complete-list consumers.
- Keep Recently Viewed at its existing capped limit; it is not part of these pagination tasks.
- Add no dependency: cursor encoding/decoding uses Python's standard-library JSON and URL-safe Base64 support.

---

### Task 1: Replace Sources library offset pagination with keyset pagination

**Files:**
- Create: `api/pagination.py`
- Modify: `api/models.py`
- Modify: `api/routers/sources.py`
- Modify: `frontend/src/lib/types/api.ts`
- Modify: `frontend/src/lib/api/sources.ts`
- Modify: `frontend/src/lib/hooks/use-sources.ts`
- Modify: `frontend/src/lib/hooks/use-source-library.test.tsx`
- Modify: `frontend/src/app/(dashboard)/sources/page.test.tsx`
- Create: `tests/test_source_cursor_pagination.py`
- Verify unchanged callers: `frontend/src/components/podcasts/GeneratePodcastDialog.tsx`, `frontend/src/components/podcasts/ContentSelectionPanel.tsx`, `frontend/src/components/sources/AddExistingSourceDialog.tsx`

**Interfaces:**
- Produces `encode_cursor(payload: dict[str, object]) -> str` and `decode_cursor(token: str) -> dict[str, object]` in `api/pagination.py`.
- Produces `GET /api/sources/library` with `query`, `sort_by`, `sort_order`, `limit`, and optional `cursor` query parameters.
- Produces `SourceLibraryPageResponse { items: list[SourceListResponse], next_cursor: str | None }` and frontend `SourceLibraryPage` with the equivalent TypeScript shape.
- Produces `sourcesApi.listLibrary(params)`; preserves `sourcesApi.list(params)` and its current array response for non-library consumers.
- Preserves the existing `useSourceLibrary()` public result: flattened `sources`, loading/error state, `hasNextPage`, and `fetchNextPage`.

- [ ] **Step 1: Write failing backend cursor tests**

  Add tests that cover:

  - a first request returns at most 30 items and a cursor only when item 31 exists;
  - a second request contains no record from the first page;
  - equal primary sort values are ordered deterministically by record ID;
  - a record inserted before the cursor does not shift or duplicate the next page;
  - access and title-query filters remain in the query before the keyset predicate;
  - `type`, `title`, `created`, `updated`, `insights_count`, and `embedded` work in both directions;
  - malformed, oversized, wrong-version, and query/sort-mismatched cursors return HTTP 400;
  - the generated SurrealQL does not contain `START` or `OFFSET`.

- [ ] **Step 2: Run the backend test and verify red**

  Run: `uv run pytest tests/test_source_cursor_pagination.py -q`

  Expected: failures because the library cursor route and cursor codec do not exist.

- [ ] **Step 3: Write failing frontend hook tests**

  Update `use-source-library.test.tsx` so `sourcesApi.listLibrary` returns:

  ```ts
  { items: firstThirtySources, next_cursor: 'source-cursor-1' }
  ```

  Assert the first request omits `cursor`, the next request sends `cursor: 'source-cursor-1'`, the hook flattens both pages, and no call contains `offset`. Assert changing search or sorting starts again without a cursor.

- [ ] **Step 4: Run the frontend hook test and verify red**

  Run from `frontend/`: `npm run test -- src/lib/hooks/use-source-library.test.tsx`

  Expected: failures because `listLibrary` and cursor-based page parameters are not implemented.

- [ ] **Step 5: Implement the shared opaque cursor codec**

  Encode a compact payload containing `v`, `sort_by`, `sort_order`, typed `value`, `id`, and a SHA-256 fingerprint of normalized filters. Decode with strict maximum token length, JSON shape, version, field allowlist, direction, record ID, and value-type validation. Raise a small pagination-specific validation exception that routes translate to HTTP 400 without returning decoder internals.

- [ ] **Step 6: Implement the Source library keyset route**

  Reuse the current source projection, access predicate, normalized title query, sort allowlist, and response conversion. Query `limit + 1`, order by the selected expression and `id` in the requested direction, then apply:

  ```sql
  sort_value > $cursor_value
  OR (sort_value = $cursor_value AND id > $cursor_id)
  ```

  for ascending order and the corresponding `<` predicate for descending order. Parse cursor values into the correct bound type for datetime, integer, boolean, and string sort fields. Return only `limit` items and build `next_cursor` from the last returned item only when the extra row exists.

- [ ] **Step 7: Switch only the Sources library hook to the new route**

  Add `sourcesApi.listLibrary()` and change `useSourceLibrary()` from numeric `pageParam` offsets to `string | undefined` cursors. Leave `sourcesApi.list()`, `useSources()`, and `useNotebookSources()` unchanged so dialogs, podcasts, and notebook workbench behavior are not silently truncated.

- [ ] **Step 8: Verify Sources list/card integration**

  Confirm the existing Load more control still appears only when `hasNextPage`, works in both list and card modes, preserves accumulated records when switching view, and retains the current retry behavior when a later page fails.

- [ ] **Step 9: Run focused and regression verification**

  Run:

  ```powershell
  uv run pytest tests/test_source_cursor_pagination.py tests/test_source_list_query.py tests/test_ownership_sources.py -q
  cd frontend
  npm run test -- src/lib/hooks/use-source-library.test.tsx 'src/app/(dashboard)/sources/page.test.tsx'
  npm run lint
  ```

  Expected: all commands exit 0; Sources library traffic uses cursors and existing non-library source consumers still receive arrays.

- [ ] **Step 10: Commit Task 1**

  ```bash
  git add api/pagination.py api/models.py api/routers/sources.py tests/test_source_cursor_pagination.py frontend/src/lib/types/api.ts frontend/src/lib/api/sources.ts frontend/src/lib/hooks/use-sources.ts frontend/src/lib/hooks/use-source-library.test.tsx frontend/src/app/\(dashboard\)/sources/page.test.tsx
  git commit -m "feat: add source library keyset pagination"
  ```

---

### Task 2: Add keyset pagination to active and archived Notebook libraries

**Files:**
- Modify: `api/models.py`
- Modify: `api/routers/notebooks.py`
- Modify: `frontend/src/lib/types/api.ts`
- Modify: `frontend/src/lib/api/notebooks.ts`
- Modify: `frontend/src/lib/hooks/use-notebooks.ts`
- Modify: `frontend/src/lib/hooks/use-notebooks.test.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/page.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/page.test.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookList.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookList.test.tsx`
- Create: `tests/test_notebook_cursor_pagination.py`
- Consume unchanged: `api/pagination.py`
- Verify unchanged consumers: `frontend/src/components/common/CommandPalette.tsx`, `frontend/src/components/podcasts/GeneratePodcastDialog.tsx`, `frontend/src/components/search/SaveToNotebooksDialog.tsx`, `frontend/src/components/sources/AddSourceDialog.tsx`, `frontend/src/components/sources/NotebookAssociations.tsx`

**Interfaces:**
- Produces `GET /api/notebooks/library` with required `archived`, optional `query`, `sort_by`, `sort_order`, `limit`, and optional `cursor` parameters.
- Produces `NotebookLibraryPageResponse { items: list[NotebookResponse], next_cursor: str | None }` and frontend `NotebookLibraryPage`.
- Produces `notebooksApi.listLibrary(params)` and `useNotebookLibrary(params)` with flattened notebooks and infinite-query controls.
- Preserves `notebooksApi.list()` and `useNotebooks()` as complete-list APIs for selection and navigation surfaces.
- Adds optional `hasNextPage`, `isFetchingNextPage`, `onLoadMore`, and `loadMoreLabel` inputs to `NotebookList` without changing its row/card rendering contract.

- [ ] **Step 1: Write failing backend Notebook pagination tests**

  Cover first/next pages, duplicate primary values resolved by ID, inserted records not duplicating later pages, active and archived isolation, case-insensitive name search, access filtering, `name`/`created`/`updated` sorts in both directions, malformed or mismatched cursors, and absence of `START`/`OFFSET` in generated SurrealQL.

- [ ] **Step 2: Run the backend test and verify red**

  Run: `uv run pytest tests/test_notebook_cursor_pagination.py -q`

  Expected: failures because the Notebook library page response and route do not exist.

- [ ] **Step 3: Write failing hook and page tests**

  Assert `useNotebookLibrary({ archived: false, query, sortBy, sortOrder })` sends no cursor on its first request, passes the returned cursor on Load more, and resets when any filter changes. On the page, assert active and archived collections maintain independent cursors, search is server-backed rather than filtering only loaded records, and list/card switching preserves each accumulated collection.

- [ ] **Step 4: Run the frontend tests and verify red**

  Run from `frontend/`:

  ```powershell
  npm run test -- src/lib/hooks/use-notebooks.test.tsx 'src/app/(dashboard)/notebooks/page.test.tsx' 'src/app/(dashboard)/notebooks/components/NotebookList.test.tsx'
  ```

  Expected: failures because `listLibrary`, `useNotebookLibrary`, and Notebook Load more controls do not exist.

- [ ] **Step 5: Implement the Notebook library keyset route**

  Apply access, `archived`, and normalized name-query predicates in SurrealQL before ordering and limiting; do not fetch all notebooks and filter archived records in Python. Use `name`/`created`/`updated` plus record `id` as the composite key, fetch `limit + 1`, and return a backend-issued next cursor only when another item exists. Continue calculating source and note counts for each returned notebook and preserve effective access roles.

- [ ] **Step 6: Add the independent infinite-query hook**

  Add `notebooksApi.listLibrary()` and `useNotebookLibrary()` without changing `useNotebooks()`. Include `archived`, normalized query, sort field, and sort direction in the query key. Use the opaque cursor as `pageParam` and flatten pages for the collection component.

- [ ] **Step 7: Connect both Notebook sections**

  Replace the two complete-list calls on the Notebooks library page with independent active and archived `useNotebookLibrary()` calls. Pass pagination state into each `NotebookList`, reuse the localized Load more label, and keep later-page errors recoverable without hiding already loaded notebooks. Keep Recently Viewed at its current fixed limit and hide it during search as it behaves today.

- [ ] **Step 8: Verify responsive list/card behavior**

  Confirm Load more is keyboard accessible, appears after its own section in both views, does not cause horizontal overflow on mobile, and keeps the current list/card layout, full-surface navigation, actions, counts, skeletons, and empty states unchanged.

- [ ] **Step 9: Run focused and final verification**

  Run:

  ```powershell
  uv run pytest tests/test_notebook_cursor_pagination.py tests/test_ownership_notebooks.py tests/test_access_grants_unit.py -q
  cd frontend
  npm run test -- src/lib/hooks/use-notebooks.test.tsx 'src/app/(dashboard)/notebooks/page.test.tsx' 'src/app/(dashboard)/notebooks/components/NotebookList.test.tsx' 'src/app/(dashboard)/notebooks/components/RecentlyViewed.test.tsx'
  npm run lint
  npm run build
  ```

  Expected: all commands exit 0; active and archived libraries page independently with cursors, complete-list notebook consumers remain unchanged, and Recently Viewed remains capped rather than paginated.

- [ ] **Step 10: Commit Task 2**

  ```bash
  git add api/models.py api/routers/notebooks.py tests/test_notebook_cursor_pagination.py frontend/src/lib/types/api.ts frontend/src/lib/api/notebooks.ts frontend/src/lib/hooks/use-notebooks.ts frontend/src/lib/hooks/use-notebooks.test.tsx frontend/src/app/\(dashboard\)/notebooks/page.tsx frontend/src/app/\(dashboard\)/notebooks/page.test.tsx frontend/src/app/\(dashboard\)/notebooks/components/NotebookList.tsx frontend/src/app/\(dashboard\)/notebooks/components/NotebookList.test.tsx
  git commit -m "feat: add notebook library keyset pagination"
  ```
