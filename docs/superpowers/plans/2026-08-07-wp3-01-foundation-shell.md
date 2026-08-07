# WP3-01 Design Foundation and Adaptive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the approved Survey Blue tokens, typography, primitives, responsive app shell, and page scaffolding once so every later route can migrate without local styling systems.

**Architecture:** Map DESIGN.md roles onto the existing shadcn/Tailwind CSS variables, use `next/font/google` so Next self-hosts Source Sans 3 and Source Serif 4 at runtime, and adapt the current `AppShell`/`AppSidebar`. Use the installed Radix Dialog primitive to build one sheet component; add no dependencies.

**Tech Stack:** Next.js layout/font optimization, Tailwind CSS 4 theme variables, existing Radix Dialog, Lucide, React, Vitest.

## Global Constraints

- Light: canvas `#F1F4F7`, surface `#FDFEFE`, raised `#E5EBF0`, ink `#172433`, muted ink `#536272`, border `#B8C3CD`, strong border `#8595A3`, action `#275E91`, selected `#DDEAF5`, provenance `#3D6D8D`, focus `#AD7620`.
- Dark: canvas `#101820`, surface `#17222C`, raised `#1E2C37`, ink `#EAF0F4`, muted ink `#A8B5BF`, border `#3B4B58`, strong border `#677988`, action `#74A9D6`, selected `#203A50`, provenance `#8DB9D2`, focus `#EFB65B`.
- Dark semantic pairs: success `#7CC7AA` / `#17362C`, info `#74A9D6` / `#1B3342`, warning `#EFB65B` / `#4A381C`, error `#F0A09B` / `#442726`, provenance `#8DB9D2` / `#1B3342`; each tested above 5.2:1.
- Radii: surface 2px, control 5px, overlay 10px, pill 999px.
- Motion: press 120ms, hover/focus/selection 160ms, dialog/sheet 220ms, immediate under reduced motion.
- Sidebar: drawer below 1024px, rail from 1024–1439px, expanded from 1440px.
- Do not add a second theme provider, navigation registry, or page-builder abstraction.

---

### Task 1: Characterize the design contract in tests

**Files:**
- Create: `frontend/src/lib/design-system.test.ts`
- Modify: `frontend/src/components/layout/AppSidebar.test.tsx`
- Create: `frontend/src/components/layout/AppShell.test.tsx`

**Interfaces:**
- Consumes: DESIGN.md token and responsive rules.
- Produces: failing tests for the foundation implementation.

- [ ] **Step 1: Add the token-source test**

Write a test that reads `src/app/globals.css` and asserts the exact light/dark action, focus, provenance, radius, and motion values:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

describe('WP3 design tokens', () => {
  it.each([
    '--background: #F1F4F7',
    '--primary: #275E91',
    '--ring: #AD7620',
    '--provenance: #3D6D8D',
    '--surface-radius: 2px',
    '--control-radius: 5px',
    '--overlay-radius: 10px',
    '--motion-fast: 120ms',
    '--motion-standard: 160ms',
    '--motion-overlay: 220ms',
  ])('contains %s', (token) => expect(css).toContain(token))

  it('contains the independent dark theme', () => {
    expect(css).toContain('--background: #101820')
    expect(css).toContain('--primary: #74A9D6')
    expect(css).toContain('--ring: #EFB65B')
  })
})
```

- [ ] **Step 2: Update shell/navigation tests**

Assert that the sidebar renders notebook, source, Ask/Search, podcast, transformation, settings, API key, advanced, and WP2b group destinations; assert that `AppShell` renders a `main` landmark with `id="main-content"` and a button named by `common.openNavigation`.

- [ ] **Step 3: Run tests and verify red**

Run from `frontend/`:

```powershell
npm run test -- src/lib/design-system.test.ts src/components/layout/AppSidebar.test.tsx src/components/layout/AppShell.test.tsx
```

Expected: failures for missing WP3 tokens and shell contract.

### Task 2: Replace global tokens and typography

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/components/ui/button.tsx`
- Modify: `frontend/src/components/ui/card.tsx`
- Modify: `frontend/src/components/ui/input.tsx`
- Modify: `frontend/src/components/ui/textarea.tsx`
- Modify: `frontend/src/components/ui/dialog.tsx`
- Modify: `frontend/src/components/ui/tabs.tsx`
- Modify: `frontend/src/components/ui/badge.tsx`

**Interfaces:**
- Consumes: current semantic Tailwind variables.
- Produces: the same class API with WP3 visuals, plus `font-research` and semantic status utilities.

- [ ] **Step 1: Configure fonts in the root layout**

Replace Inter with:

```ts
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google'

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-source-sans',
  display: 'swap',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-source-serif',
  display: 'swap',
})
```

Set the body class to both variables plus `font-sans`. Keep the existing provider order unchanged.

- [ ] **Step 2: Map the exact token roles**

In `globals.css`, replace the incumbent OKLCH palette with the exact light/dark values in Global Constraints. Map `background` to canvas, `card`/`popover` to surface, `secondary`/`muted` to raised surface, `accent` to selected surface, `primary` to action, `ring` to focus, and add custom provenance/success/info/warning roles through `@theme inline`.

Remove `.sidebar-menu-item` scale/shadow behavior and `.card-hover` lift/shadow behavior. Add `prefers-reduced-motion` rules that set WP3 transitions to immediate and a coarse-pointer rule that gives buttons, inputs, and tab triggers a 44px minimum hit area.

- [ ] **Step 3: Restyle existing primitives without changing their exports**

Use 5px controls, 2px cards, 10px dialogs, tonal states, 1px borders, amber focus, no resting card shadow, and 1.5px Lucide strokes. Keep current variants and sizes so feature components continue compiling.

- [ ] **Step 4: Run the token test**

Run:

```powershell
npm run test -- src/lib/design-system.test.ts
```

Expected: pass.

### Task 3: Build the adaptive shell and shared page frame

**Files:**
- Create: `frontend/src/components/ui/sheet.tsx`
- Create: `frontend/src/components/layout/PageFrame.tsx`
- Create: `frontend/src/components/layout/PageHeader.tsx`
- Modify: `frontend/src/components/layout/AppShell.tsx`
- Modify: `frontend/src/components/layout/AppSidebar.tsx`
- Modify: `frontend/src/components/layout/AppSidebar.test.tsx`
- Modify: `frontend/src/components/layout/AppShell.test.tsx`
- Delete: `frontend/src/lib/stores/sidebar-store.ts`
- Modify: `frontend/src/test/setup.ts`
- Modify: every locale file under `frontend/src/lib/locales/`

**Interfaces:**
- Consumes: `PageHeaderProps` from the roadmap.
- Produces: responsive shell, drawer, rail, expanded sidebar, skip link, and shared page spacing.

- [ ] **Step 1: Compose Sheet from installed Radix Dialog**

Export `Sheet`, `SheetTrigger`, `SheetContent`, `SheetTitle`, and `SheetDescription`. `SheetContent` is fixed to the left, full height, 320px maximum width, 10px radius only on its right edge, and uses the existing overlay/focus behavior.

- [ ] **Step 2: Make sidebar adaptation CSS-driven**

Give `AppSidebar` this API:

```ts
interface AppSidebarProps {
  mode?: 'persistent' | 'drawer'
  onNavigate?: () => void
}
```

Render all labels in the DOM. Hide labels and section headings only from 1024–1439px; expand them at 1440px. In drawer mode, always show labels. Keep WP2b Groups inside the administration group and close the drawer after navigation.

Delete `sidebar-store.ts`; responsive behavior replaces a persisted manual state that no longer matches the approved contract.

- [ ] **Step 3: Add the mobile/tablet drawer and route focus**

`AppShell` renders the persistent sidebar at 1024px+, a compact header and Sheet below 1024px, a skip link, and `<main id="main-content" tabIndex={-1}>`. On pathname change, focus the main element without scrolling.

- [ ] **Step 4: Add page scaffolding**

`PageFrame` owns one page scroller, responsive gutters, and optional width constraint. `PageHeader` renders eyebrow, title, description, one primary-action slot, and subordinate secondary actions with mobile wrapping.

- [ ] **Step 5: Add locale keys**

Add `common.openNavigation`, `common.closeNavigation`, and `common.skipToContent` to en-US and linguistically equivalent values in all other locale files. Do not use fallback-only English.

- [ ] **Step 6: Run shell and locale tests**

Run:

```powershell
npm run test -- src/components/layout/AppSidebar.test.tsx src/components/layout/AppShell.test.tsx src/lib/locales/index.test.ts
```

Expected: pass.

### Task 4: Verify and checkpoint the foundation

**Files:**
- Create: `docs/7-DEVELOPMENT/decisions/PDR-004-wp3-adaptive-research-shell.md`
- Modify: `docs/7-DEVELOPMENT/frontend.md`

**Interfaces:**
- Produces: recorded structural decision and verified foundation for WP3-02.

- [ ] **Step 1: Record the structural decision**

Document the adaptive sidebar breakpoints, one-main-scroller rule, reuse of existing primitives, and rejection of a second UI/state framework. Cite PRODUCT.md and DESIGN.md rather than copying them.

- [ ] **Step 2: Run complete frontend verification**

Run from `frontend/`:

```powershell
npm run test
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the shell visually**

At 375, 768, 1024, and 1440px in both themes, verify drawer/rail/expanded states, labels, focus order, no horizontal scroll, 44px coarse targets, reduced motion, and 200% zoom.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/app frontend/src/components frontend/src/lib frontend/src/test docs/7-DEVELOPMENT
git commit -m "feat(frontend): establish WP3 design foundation"
```
