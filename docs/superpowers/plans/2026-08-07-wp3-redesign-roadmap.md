# WP3 Application Redesign Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the complete Open Notebook application around the approved evidence-first research workflow while preserving every verified capability, backend contract, and WP2b permission rule.

**Architecture:** Integrate WP2b first, replace the visual token and application-shell foundation once, then migrate existing routes in vertical slices. Reuse the current Next.js, Tailwind, Radix, TanStack Query, Zustand, and API layers; introduce only small structural components that are reused by at least two route families.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, existing Radix UI packages, Lucide, TanStack Query, Zustand, Vitest, Testing Library, FastAPI, SurrealDB.

## Global Constraints

- Product truth is [PRODUCT.md](../../../PRODUCT.md); visual and interaction authority is [DESIGN.md](../../../DESIGN.md).
- The central loop remains **collect sources → organize in notebooks → compose context → ask or synthesize → verify provenance**.
- Every surface must communicate **precision, trust, calm, momentum, and curiosity**.
- Preserve all current capabilities, REST contracts, authentication, ownership, provider choice, and data relationships.
- Integrate `wp-2b-sharing` before redesign work; preserve viewer/editor/owner/admin rules and group sharing.
- Use existing dependencies. Do not add a UI kit, state library, CSS framework, resizable-panels library, animation library, or icon package.
- No GPL or AGPL dependencies or assets.
- Every UI string uses `t()` and exists in all locale files under `frontend/src/lib/locales/`.
- Use Source Sans 3 for operations and Source Serif 4 only for research reading/thought hierarchy.
- Body text is at least 16px; metadata is at least 12px; coarse-pointer targets are at least 44×44px.
- Light/dark modes, keyboard access, screen-reader semantics, 200% zoom, reduced motion, and WCAG AA contrast are release gates.
- Preserve route, tab, filter, sort, scroll, session, context, pane-width, and recoverable-draft state where each applies.
- Do not expose credentials, stack traces, internal record IDs, provider payloads, or deployment URLs in user-facing errors.
- Keep one root `DESIGN.md`; do not create prototypes or `.impeccable/design.json`.
- Each work package uses TDD for behavior changes and ends with lint, targeted tests, a production build, and a human review checkpoint.

## Dependency Order

1. [x] [WP3-00: WP2b integration baseline](2026-08-07-wp3-00-wp2b-integration.md) — Complete
2. [x] [WP3-01: Design foundation and adaptive shell](2026-08-07-wp3-01-foundation-shell.md) — Complete and approved
3. [x] [WP3-01B: Deployment-level white-label branding](2026-08-07-wp3-01b-branding.md) — Complete and approved
4. [x] [WP3-02: Collection libraries](2026-08-07-wp3-02-collection-libraries.md) — Complete and approved
5. [x] [WP3-03: Research workbench](2026-08-07-wp3-03-research-workbench.md) — Complete and approved
6. [ ] [WP3-04: Ask and Search](2026-08-07-wp3-04-ask-search.md)
7. [ ] [WP3-05: Output studios](2026-08-07-wp3-05-output-studios.md)
8. [ ] [WP3-06: Administration, authentication, and sharing](2026-08-07-wp3-06-admin-auth-sharing.md)
9. [ ] [WP3-07: Hardening and release verification](2026-08-07-wp3-07-hardening.md)

Do not execute packages out of order. WP3-01 establishes tokens and structural interfaces consumed by every route plan. WP3-01B adds deployment identity without allowing customer configuration to override semantic, provenance, or focus meaning. WP3-03 establishes the workbench and resource-preview interfaces consumed by Ask/Search. WP3-06 consumes WP2b sharing types and may add access-origin metadata without weakening existing authorization.

## Recorded Product Follow-ups

These issues were discovered while testing the running WP3 application. They are executable Superpowers plans, but they are tracked separately from the nine WP3 redesign packages so completed WP3 package status remains accurate.

1. [ ] [Source–notebook relationship integrity](2026-08-13-source-notebook-relationship-integrity.md) — correct reversed edge predicates, make repeated linking idempotent, and enforce pair uniqueness. Complete before bulk notebook population.
2. [ ] [Notebook–source documentation truth](2026-08-13-notebook-source-documentation-truth.md) — remove the stale one-notebook-per-source and re-upload guidance, then document reuse, unlinking, and global deletion accurately.
3. [ ] [Ingestion runtime capabilities](2026-08-13-ingestion-runtime-capabilities.md) — require a complete FFmpeg/FFprobe runtime for advertised media support, gate images on optional Docling, and remove unsupported ZIP/TAR/GZ from the picker.
4. [ ] [Long-context handling](2026-08-13-long-context-handling.md) — add model-aware context budgeting, warnings, and recovery without silently dropping selected evidence.

## Shared Interfaces

These names are fixed across the work-package plans:

```ts
// frontend/src/components/layout/PageHeader.tsx
export interface PageHeaderProps {
  title: string
  description?: string
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode
  eyebrow?: string
}

// frontend/src/components/workbench/ResearchWorkbench.tsx
export type WorkbenchPaneId = 'evidence' | 'notes' | 'synthesis'

export interface WorkbenchPane {
  id: WorkbenchPaneId
  label: string
  icon: React.ComponentType<{ className?: string }>
  content: React.ReactNode
  inspector?: boolean
}

export interface ResearchWorkbenchProps {
  workspaceKey: string
  panes: WorkbenchPane[]
  contextSummary?: React.ReactNode
}

// frontend/src/lib/hooks/use-resource-preview.ts
export type PreviewResourceType = 'source' | 'note' | 'source_insight'

export interface ResourcePreviewState {
  type: PreviewResourceType | null
  id: string | null
  openPreview: (type: PreviewResourceType, id: string) => void
  closePreview: () => void
}
```

Do not create an abstract page-builder, route registry, theme service, component factory, or general workflow engine. These interfaces cover the repeated structure the redesign actually needs.

## Verification Layers

Every work package must pass all applicable layers before its review checkpoint:

1. **Behavior:** focused Vitest/pytest tests written before implementation.
2. **Static:** `npm run lint` and TypeScript through `npm run build`.
3. **Integration:** existing feature tests and affected API tests.
4. **Visual:** browser inspection at 375, 768, 1024, and 1440px in light and dark modes.
5. **Accessibility:** keyboard-only path, visible focus, logical heading/focus order, reduced motion, 200% zoom, and screen-reader names/states.
6. **Product:** capability/state checklist against PRODUCT.md and DESIGN.md.

## Commit Strategy

Use one reviewable commit per independently testable task. Recommended prefixes:

- `merge: integrate WP2b sharing into WP3`
- `feat(frontend): establish WP3 design foundation`
- `feat(frontend): add deployment brand configuration`
- `feat(frontend): redesign notebook and source libraries`
- `feat(frontend): add adaptive research workbench`
- `feat(frontend): redesign Ask and Search workspaces`
- `feat(frontend): redesign output studios`
- `feat(frontend): redesign administration and sharing`
- `test(frontend): harden WP3 responsive and accessibility behavior`
- `docs: finalize WP3 design implementation record`

## Completion Criteria

WP3 is complete only when all nine work packages are approved, two visibly different deployment brand configurations work from the same build, `docs/FRONTEND_MAP.md` covers the final route architecture, the full frontend and affected backend suites pass, the production build succeeds, all routes have been inspected at the four required widths in both themes, WP2b permission behavior is verified, and the seed marker is removed from `DESIGN.md` after code-to-document reconciliation.
