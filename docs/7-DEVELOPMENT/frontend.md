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
- **Stores** (`src/lib/stores/`) — Zustand for auth and modal state; `persist` middleware syncs to localStorage (auth token under `auth-storage`).
- **API modules** (`src/lib/api/`) — namespaced typed clients (`sourcesApi.list()`, …) over a single axios instance with auth/FormData/401 interceptors.

Provider tree in `app/layout.tsx` (outermost → innermost): ErrorBoundary → ThemeProvider → QueryProvider → I18nProvider → ConnectionGuard → Toaster.

## WP3 design foundation and shell

[DESIGN.md](../../DESIGN.md) is the single visual and interaction contract. `app/globals.css` maps its Survey Blue roles onto the existing Tailwind semantic variables and also exposes provenance and semantic-state roles. Source Sans 3 is the operational font; the `font-research` utility selects Source Serif 4 for research reading and thought hierarchy only. Both are configured through `next/font` in the root layout, and the provider order above remains unchanged.

`AppShell` provides one responsive navigation hierarchy and one focusable `#main-content` landmark:

- below `1024px`: the sidebar is a left-hand drawer;
- `1024–1439px`: a `72px` rail keeps every destination label in the DOM and exposes it on demand;
- `1440px` and above: the same sidebar expands and shows its labels;
- route changes focus the main landmark without scrolling it, and a skip link is the first shell control.

`PageFrame` is the outer container for migrated routes. It owns the page's single vertical scroller, responsive gutters, and one of the shared `full`, `content`, or `reading` width constraints. Do not wrap an existing page-level scroller inside it; remove the old scroller as part of that route's migration. `PageHeader` standardizes eyebrow, title, description, subordinate actions, and the view's one primary action while allowing actions to wrap on narrow screens.

The shell and primitives deliberately reuse the current Radix, Tailwind, theme, and routing foundations. Do not add another theme provider, navigation registry, UI framework, or page-builder abstraction. Customer branding must not remap provenance, focus, or semantic-state meaning.

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

`getApiErrorMessage()` (`lib/utils/error-handler.ts`) tries an i18n mapping first, then falls back to the backend's descriptive message — which the backend error-classification system already makes user-friendly (see [architecture.md](architecture.md)). Mutations surface errors as toasts; an app-level ErrorBoundary catches render errors.
