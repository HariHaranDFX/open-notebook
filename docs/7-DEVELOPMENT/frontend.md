# Frontend Architecture

How the Next.js app is layered and how data flows through it. Normative rules (commands, i18n, gotchas) live in [`frontend/AGENTS.md`](../../frontend/AGENTS.md); this page is the mental model.

## Layers

```
Pages (src/app/, App Router) → Feature components (src/components/) → Hooks (src/lib/hooks/)
                                                                          ↓
                              Stores (src/lib/stores/) → API modules (src/lib/api/) → Backend
```

- **Pages** — route endpoints. Router groups `(auth)` / `(dashboard)` organize routes without affecting URLs. Pages call hooks and render components.
- **Components** — feature folders (`source/`, `notebooks/`, `podcasts/`, …) own page-level state (loading, error); `components/ui/` are stateless Radix UI wrappers styled with Tailwind + CVA.
- **Hooks** (`src/lib/hooks/`) — TanStack Query wrappers. Query hooks return `{ data, isLoading, error, refetch }`; mutation hooks invalidate caches and toast. Complex hooks (`useNotebookChat`, `useAsk`) add session management, context building, SSE streaming.
- **Stores** (`src/lib/stores/`) — Zustand for authentication, library display preferences, theme, navigation, and per-workspace pane state. Persisted stores use distinct localStorage keys; authentication uses `auth-storage`.
- **API modules** (`src/lib/api/`) — namespaced typed clients (`sourcesApi.list()`, …) over a single axios instance with auth/FormData/401 interceptors.

Provider tree in `app/layout.tsx` (outermost → innermost): BrandProvider → ErrorBoundary → ThemeProvider → QueryProvider → I18nProvider → ConnectionGuard, with Toaster inside the guard. The authenticated dashboard layout adds CreateDialogsProvider → SettingsDialogProvider, followed by the URL-backed ModalProvider and CommandPalette.

## Route families and administration

- **Authentication:** `/login` renders the password or Entra entry surface from runtime auth status.
- **Libraries:** `/notebooks` and `/sources` use `AppShell`, `PageFrame`, `PageHeader`, and the shared library toolbar.
- **Research workspaces:** `/notebooks/[id]` and `/sources/[id]` compose feature panes through `ResearchWorkbench`; `/search` switches between Ask and Search without discarding query state.
- **Output studios:** `/podcasts`, `/podcasts/[id]`, and `/transformations` keep library, editor, playback, and playground concerns in their feature folders.
- **Administration:** `/settings/api-keys` and `/settings/groups` are admin-only routes nested under the settings layout. General settings and Advanced tools are sections of the global `SettingsDialog`, opened from the account menu or command palette; they are intentionally not duplicate pages.

The root route and authenticated dashboard root redirect to `/notebooks`. Route groups organize source files only and do not change public URLs. See [FRONTEND_MAP.md](../FRONTEND_MAP.md) for the page-to-component and data-flow map.

## WP3 design foundation and shell

[DESIGN.md](../../DESIGN.md) is the single visual and interaction contract. `app/globals.css` maps its Survey Blue roles onto the existing Tailwind semantic variables and also exposes provenance and semantic-state roles. Source Sans 3 is the operational font; the `font-research` utility selects Source Serif 4 for research reading and thought hierarchy only. Both are configured through `next/font` in the root layout, and the provider order above remains unchanged.

`AppShell` provides one responsive navigation hierarchy and one focusable `#main-content` landmark:

- below `1024px`: the sidebar is a left-hand drawer;
- `1024–1439px`: a `72px` rail keeps every destination label in the DOM and exposes it on demand;
- `1440px` and above: the same sidebar expands and shows its labels;
- route changes focus the main landmark without scrolling it, and a skip link is the first shell control.

`PageFrame` is the outer container for migrated routes. It owns the page's single vertical scroller, responsive gutters, and one of the shared `full`, `content`, or `reading` width constraints. Do not wrap an existing page-level scroller inside it; remove the old scroller as part of that route's migration. `PageHeader` standardizes eyebrow, title, description, subordinate actions, and the view's one primary action while allowing actions to wrap on narrow screens.

The shell and primitives deliberately reuse the current Radix, Tailwind, theme, and routing foundations. Do not add another theme provider, navigation registry, UI framework, or page-builder abstraction. Customer branding must not remap provenance, focus, or semantic-state meaning.

`BrandProvider` receives the startup-validated configuration from `lib/brand-config.ts`. The root layout derives metadata, logo/favicon identity, and contrast-safe light/dark action variables from the same immutable object. Invalid paths, unsafe URLs, malformed JSON, or action colors below the required contrast fail startup instead of producing a partially branded UI.

## Workbench and URL state

`ResearchWorkbench` is the shared notebook/source/Ask container. At desktop widths it presents a persisted, resizable research pane beside collapsible chat. Below the desktop breakpoint it serializes the same capabilities into Chat and Panel tabs. `workbench-store.ts` persists the active pane, left-pane width, collapsed chat state, and compact view per `workspaceKey`; feature data remains in TanStack Query rather than being duplicated in Zustand.

Evidence previews use URL state. `use-resource-preview.ts` owns `?preview=<type>&previewId=<id>` for source, note, and source-insight previews while preserving unrelated query parameters. The dashboard `ModalProvider` separately owns the established `?modal=<type>&id=<id>` editing/detail flows. Use the URL when browser back, deep linking, or return-state preservation matters; use local component state only for ephemeral presentation.

## Flow walkthrough: notebook chat

1. `notebooks/[id]/page.tsx` passes `notebookId` to `ChatColumn`.
2. `useNotebookChat()` queries sessions, manages message state, returns `{ messages, sendMessage(), setModelOverride() }`.
3. On send: `buildContext()` assembles selected sources/notes (token/char counts), calls `chatApi.sendMessage()`, and applies an **optimistic update** (message added locally, removed on error).
4. Response updates the TanStack Query cache; related source/note mutations elsewhere invalidate broadly so stale UI refreshes.
5. Model override before a session exists is stored as pending and applied on session creation.

## Flow walkthrough: file upload

1. `SourceDialog` collects the file; `useFileUpload` builds FormData — nested JSON fields are stringified.
2. The client interceptor deletes the Content-Type header so the browser sets the multipart boundary.
3. On success, `queryClient.invalidateQueries(['sources'])` refetches lists; `useSourceStatus` polls every 2s while the source is processing.

## Caching strategy

Query keys are hierarchical (`QUERY_KEYS.sources(notebookId)`), but invalidation is deliberately **broad** (`['sources']` catches everything) — a precision/simplicity trade-off. Frequently changing data uses `refetchOnWindowFocus: true`.

## Auth

The token is validated by an actual API call (`/notebooks`), not JWT decoding, with a 30-second cache in the auth store. The response interceptor clears auth and redirects to `/login` on 401. Logout is client-side only.

## Error handling

`getApiErrorMessage()` (`lib/utils/error-handler.ts`) prefers an i18n mapping. It may retain an actionable, classified 4xx detail, but hides statusless/network failures and 5xx details behind a safe translated fallback. Mutations surface those messages as toasts; the app-level ErrorBoundary catches render errors without exposing stack or infrastructure details.

## Theme, language, and accessibility state

`ThemeProvider` applies the persisted `light`, `dark`, or `system` choice to the document root. `I18nProvider` waits until client mount to avoid hydration mismatch, shows the language-loading overlay, and synchronizes the active locale to `<html lang>`. `AppShell` provides the first-page skip link, one `#main-content` landmark, route-change focus, and the same navigation hierarchy as a desktop sidebar or mobile drawer.
