# WP3-03 Research Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn notebook and source detail routes into the adaptive Parallel Evidence Workbench with persistent pane state, explicit context composition, visible provenance, and role-aware actions.

**Architecture:** Add one reusable workbench layout and one small persisted Zustand store. Keep feature data and mutations in existing hooks/components. Replace icon-cycling context controls with explicit choices, then migrate notebook and source routes independently.

**Tech Stack:** React, Zustand persist, Pointer Events, existing media-query hook, Radix Tabs/Select, TanStack Query, Vitest.

## Global Constraints

- Desktop `≥1024px`: Evidence / Notes / Synthesis visible together; pane widths are keyboard- and pointer-resizable and persist per workspace.
- Tablet `768–1023px`: one active pane plus a persistent context summary/inspector.
- Phone `320–767px`: sticky Evidence / Notes / Synthesis tabs, one active pane, persistent compact context summary.
- Context values are source `off | insights | full` and note `off | full`; labels display Excluded / Insights only / Full source and Excluded / Included.
- Do not silently truncate evidence. Context count/token limits must remain visible.
- Completed evidence remains usable while other sources process.
- Human and AI note authorship stays visible.
- Viewer/editor/owner permissions come from WP2b; backend 403 is authoritative.
- Opening evidence or a reference must not discard the chat response/session.

---

### Task 1: Specify persisted workbench behavior with tests

**Files:**
- Create: `frontend/src/lib/stores/workbench-store.ts`
- Create: `frontend/src/lib/stores/workbench-store.test.ts`
- Create: `frontend/src/components/workbench/ResearchWorkbench.test.tsx`

**Interfaces:**
- Produces the `ResearchWorkbenchProps` contract from the roadmap and:

```ts
export type PaneSizes = [number, number, number]

interface WorkbenchStore {
  sizesByWorkspace: Record<string, PaneSizes>
  activePaneByWorkspace: Record<string, WorkbenchPaneId>
  setSizes: (workspaceKey: string, sizes: PaneSizes) => void
  setActivePane: (workspaceKey: string, pane: WorkbenchPaneId) => void
}
```

- [ ] **Step 1: Write store tests**

Assert default sizes `[34, 33, 33]`, workspace isolation, size normalization to 100, minimum pane size 20, active-pane persistence, and unique storage name `research-workbench-storage`.

- [ ] **Step 2: Write layout tests**

Mock media queries for phone, tablet, and desktop. Assert three panes plus two separators on desktop, one selected pane on phone, a context-summary region on tablet/phone, labeled tabs, and separators with `role="separator"`, `aria-orientation="vertical"`, and keyboard instructions.

- [ ] **Step 3: Run tests and verify red**

Run:

```powershell
npm run test -- src/lib/stores/workbench-store.test.ts src/components/workbench/ResearchWorkbench.test.tsx
```

Expected: failure because the store/layout do not exist.

### Task 2: Implement the minimal reusable workbench

**Files:**
- Create: `frontend/src/components/workbench/ResearchWorkbench.tsx`
- Create: `frontend/src/components/workbench/PaneResizer.tsx`
- Implement: `frontend/src/lib/stores/workbench-store.ts`
- Modify: `frontend/src/lib/hooks/use-media-query.ts`

**Interfaces:**
- Consumes: roadmap interfaces and store contract.
- Produces: a three-pane CSS grid at desktop and tabbed single-pane presentation below 1024px.

- [ ] **Step 1: Implement store normalization**

Use one function:

```ts
export function normalizePaneSizes(next: PaneSizes): PaneSizes {
  const clamped = next.map((value) => Math.max(20, Math.min(60, value))) as PaneSizes
  const total = clamped.reduce((sum, value) => sum + value, 0)
  return clamped.map((value) => (value / total) * 100) as PaneSizes
}
```

Persist only `sizesByWorkspace` and `activePaneByWorkspace`.

- [ ] **Step 2: Implement accessible resizing**

Pointer dragging adjusts the two adjacent percentages and commits on pointer-up. ArrowLeft/ArrowRight change by 2 percentage points; Home restores `[34, 33, 33]`. Do not animate grid dimensions. The separator visual is 1px but its hit area is at least 12px.

- [ ] **Step 3: Implement responsive presentations**

Use `useIsDesktop()` for three panes and add `useIsTablet()` for 768–1023px. Desktop renders CSS grid; tablet and phone render Radix Tabs with only the active pane mounted. Place `contextSummary` in a persistent aside on tablet and a sticky compact footer/header on phone.

- [ ] **Step 4: Verify workbench tests**

Run the Task 1 tests. Expected: pass.

### Task 3: Replace ambiguous context controls

**Files:**
- Create: `frontend/src/components/common/ContextSelector.tsx`
- Create: `frontend/src/components/common/ContextSelector.test.tsx`
- Modify: `frontend/src/components/common/ContextIndicator.tsx`
- Delete: `frontend/src/components/common/ContextToggle.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/SourcesColumn.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotesColumn.tsx`
- Modify: every locale file under `frontend/src/lib/locales/`

**Interfaces:**
- Produces:

```ts
interface ContextSelectorProps {
  value: 'off' | 'insights' | 'full'
  kind: 'source' | 'note'
  hasInsights?: boolean
  onValueChange: (value: 'off' | 'insights' | 'full') => void
  disabled?: boolean
}
```

- [ ] **Step 1: Write failing selector tests**

Assert visible labels, no Insights-only option for a source without insights, notes expose only Excluded/Included, keyboard selection works, disabled is announced, and selection never triggers row navigation.

- [ ] **Step 2: Implement explicit choices**

Use a compact segmented RadioGroup when space permits and a labeled Select inside narrow rows. Do not cycle modes from one icon. Replace hard-coded English in `ContextIndicator`; show counts, token/character estimate, and an explicit no-context message through `t()`.

- [ ] **Step 3: Verify context behavior and locale parity**

Run:

```powershell
npm run test -- src/components/common/ContextSelector.test.tsx src/lib/utils/source-context.test.ts src/lib/locales/index.test.ts
```

Expected: pass.

### Task 4: Migrate the notebook workspace

**Files:**
- Modify: `frontend/src/app/(dashboard)/notebooks/[id]/page.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotebookHeader.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/SourcesColumn.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/NotesColumn.tsx`
- Modify: `frontend/src/app/(dashboard)/notebooks/components/ChatColumn.tsx`
- Delete: `frontend/src/components/notebooks/CollapsibleColumn.tsx`
- Delete: `frontend/src/lib/stores/notebook-columns-store.ts`
- Create: `frontend/src/app/(dashboard)/notebooks/[id]/page.test.tsx`

**Interfaces:**
- Consumes: ResearchWorkbench, ContextSelector, current notebook/source/note/chat hooks, and WP2b access-role helpers.
- Produces: `workspaceKey="notebook:${notebookId}"` with Evidence, Notes, and Synthesis panes.

- [ ] **Step 1: Write route tests**

Mock notebook/source/note/chat hooks. Assert the three pane labels, context summary, loading skeleton, 404 state with return action, viewer read-only state, editor metadata edit without delete, owner share/delete controls, and completed sources remaining visible beside processing sources.

- [ ] **Step 2: Replace bespoke desktop/mobile branches**

Build the three pane objects and pass them to ResearchWorkbench. Remove collapse-state code and `CollapsibleColumn`; the workbench store becomes the only pane-layout state. Keep existing context-selection calculation and bulk actions.

- [ ] **Step 3: Preserve chat/session behavior**

Do not rewrite `useNotebookChat`. Preserve current session selection, pending model override, SSE handling, save-to-note, copy, and reference behavior. Change only containers, context summary placement, and visible state copy.

- [ ] **Step 4: Apply permission presentation**

Use `canEditContent`, `canDeleteNotebook`, and `canManageAcl`. A viewer sees content/chat but no editing controls; an editor may manage notebook content but not delete/manage ACL; owner/admin rules remain as WP2b defines.

- [ ] **Step 5: Verify notebook tests**

Run notebook page, ChatColumn, NoteEditorDialog, source-context, access-role, and locale tests. Expected: exit 0.

### Task 5: Migrate the source workspace without losing reusable detail views

**Files:**
- Modify: `frontend/src/app/(dashboard)/sources/[id]/page.tsx`
- Create: `frontend/src/components/sources/SourceWorkspace.tsx`
- Create: `frontend/src/components/sources/SourceContentPane.tsx`
- Create: `frontend/src/components/sources/SourceInsightsPane.tsx`
- Modify: `frontend/src/components/sources/SourceDetailContent.tsx`
- Modify: `frontend/src/components/sources/ChatPanel.tsx`
- Create: `frontend/src/components/sources/SourceWorkspace.test.tsx`

**Interfaces:**
- Produces: `workspaceKey="source:${sourceId}"` with Content, Insights, and Source chat panes.
- Keeps: `SourceDetailContent` as a compatibility composition for existing dialog consumers until WP3-04 replaces search dialogs.

- [ ] **Step 1: Write workspace tests**

Assert AppShell remains visible, all three panes render, loading/404/403 states are scoped, reference/detail navigation preserves chat, and source role gates edit/delete/share actions.

- [ ] **Step 2: Extract content and insights once**

Move content/metadata rendering to `SourceContentPane` and insight list/actions to `SourceInsightsPane`. `SourceWorkspace` owns `useSource`, insight fetching, refresh, and mutation state; do not render `SourceDetailContent` twice.

`SourceDetailContent` composes the extracted panes in tabs for legacy dialog use, preserving its public props and existing tests.

- [ ] **Step 3: Use the shared workbench route**

Wrap the direct route in AppShell and PageFrame, preserve return-path behavior, and render Content / Insights / Source chat through ResearchWorkbench. Keep source-chat session behavior unchanged.

- [ ] **Step 4: Verify source behavior**

Run:

```powershell
npm run test -- src/components/sources/SourceWorkspace.test.tsx src/components/sources/SourceDetailContent.test.tsx src/components/sources/ChatPanel.test.tsx
npm run lint
npm run build
```

Expected: all commands exit 0.

### Task 6: Visual verification and commit

- [ ] **Step 1: Inspect notebook and source workspaces**

At 375, 768, 1024, and 1440px in both themes, verify pane adaptation, resizers, sticky context summary, long titles, independent pane scrolling, reference opening, viewer/editor/owner states, 200% zoom, keyboard resizing, and reduced motion.

- [ ] **Step 2: Commit**

```powershell
git add frontend/src
git commit -m "feat(frontend): add adaptive research workbench"
```
