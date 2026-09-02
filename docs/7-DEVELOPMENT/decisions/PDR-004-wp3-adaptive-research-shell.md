# PDR-004: One adaptive research shell for WP3

- **Status**: Superseded by [PDR-005](PDR-005-user-controlled-adaptive-sidebar.md)
- **Date**: 2026-08
- **Related**: [PRODUCT.md](../../../PRODUCT.md), [DESIGN.md](../../../DESIGN.md), [WP3 roadmap](../../superpowers/plans/2026-08-07-wp3-redesign-roadmap.md)

## Context

WP3 must redesign the application without changing its capabilities or backend behavior. The previous shell used a persisted manual collapse preference, hover-dependent controls, and page-local containers; that model did not express the approved evidence-first responsive hierarchy or provide a stable foundation for later route migrations.

## Decision

Open Notebook uses one adaptive navigation hierarchy: a drawer below `1024px`, a `72px` rail from `1024px` through `1439px`, and an expanded labeled sidebar from `1440px`. Labels remain in the DOM in rail mode and are available on demand. `AppShell` owns the skip link, responsive navigation boundary, and focusable main landmark; `PageFrame` owns the single page scroller and responsive gutters when a route is migrated.

The foundation continues to use the existing Tailwind semantic variables, shadcn-style primitives, Radix components, theme provider, and route model. Survey Blue roles and Source Sans 3 / Source Serif 4 are defined centrally according to [DESIGN.md](../../../DESIGN.md).

## Alternatives considered

- **Keep a persisted manual collapse toggle** — rejected because it conflicts with the approved viewport contract and creates stale layout state.
- **Add separate mobile or bottom navigation** — rejected because it would create a competing hierarchy and make capabilities diverge by viewport.
- **Adopt another UI, theme, or navigation framework** — rejected because the existing primitives can express the contract without parallel state or dependencies.
- **Let each page own arbitrary outer scrolling and gutters** — rejected because nested scrollers weaken focus, restoration, and responsive behavior.

## Consequences

- Later WP3 packages reuse `AppShell`, `PageFrame`, `PageHeader`, and the existing primitive exports instead of creating page-local systems.
- Route migrations may remain incremental, but a migrated page must not place another page scroller inside `PageFrame`.
- Navigation adaptation is CSS-driven; tests and visual checks must cover `375`, `768`, `1024`, and `1440px` in both themes.
- Focus, localization, reduced motion, coarse-pointer targets, and no horizontal viewport scrolling are shell acceptance requirements.
