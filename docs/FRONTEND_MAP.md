# Frontend Map

Concrete ownership and data-flow map for the Next.js frontend. Read [frontend architecture](7-DEVELOPMENT/frontend.md) for the mental model and [`frontend/AGENTS.md`](../frontend/AGENTS.md) for normative rules.

## Shared runtime

```text
app/layout.tsx
└─ BrandProvider
   └─ ErrorBoundary
      └─ ThemeProvider
         └─ QueryProvider
            └─ I18nProvider
               └─ ConnectionGuard
                  ├─ route content
                  └─ Toaster

(dashboard)/layout.tsx
└─ auth/version gate
   └─ CreateDialogsProvider
      └─ SettingsDialogProvider
         ├─ route content
         ├─ ModalProvider (?modal=…&id=…)
         └─ CommandPalette
```

`AppShell` owns the adaptive sidebar/drawer, skip link, route-change focus, setup banner, and `#main-content`. `PageFrame` owns the route's vertical scroller and width/gutters. `PageHeader` owns the common page heading/action structure.

## Pages and component trees

| URL | Page and primary component tree |
|---|---|
| `/` | Server redirect to `/notebooks`. |
| `/login` | `LoginForm` inside a route `ErrorBoundary`; selects password or Entra presentation from auth status. |
| dashboard root | Server redirect to `/notebooks`. |
| `/notebooks` | `AppShell` → `PageFrame` → `PageHeader`, `LibraryToolbar`, `RecentlyViewed`, `NotebookList`/`NotebookRow`, `CreateNotebookDialog`. |
| `/notebooks/[id]` | `AppShell` → `NotebookHeader` → `NotebookWorkspace` → shared `ResearchWorkbench`; research panes are `SourcesColumn`, `NotesColumn`, and URL preview, beside `ChatColumn`. |
| `/sources` | `AppShell` → `PageFrame` → `PageHeader`, `LibraryToolbar`, `SourceLibraryRow`, `AddSourceButton`, and delete confirmation. |
| `/sources/[id]` | `AppShell` → `SourceWorkspace` → shared `ResearchWorkbench`; content/insight/preview panes sit beside source chat. |
| `/search` | `AppShell` → Ask/Search tabs → `AskWorkspace` or `SearchWorkspace`; both can open shared `ResourcePreview` with URL state. |
| `/podcasts` | `AppShell` → `PageFrame` → `PageHeader` → Episodes/Templates tabs → `EpisodesTab` or `TemplatesTab`; global Create Podcast opens the generation sheet. |
| `/podcasts/[id]` | `AppShell` → episode loading/error boundary → `EpisodeDetail` with playback, summary, outline, transcript, and common details. |
| `/transformations` | `AppShell` → `PageFrame` → `PageHeader` → Library/Playground tabs → `TransformationsList`, `TransformationEditorDialog`, `DefaultPromptEditor`, or `TransformationPlayground`. |
| `/settings/api-keys` | settings `AppShell` + `AdminOnly` → model defaults, credentials, provider discovery/sync, testing, and credential/model sheets. |
| `/settings/groups` | settings `AppShell` + `AdminOnly` → group list/detail, membership controls, and create/delete dialogs. |

General settings and Advanced tools are not routes. `SettingsDialogProvider` renders one global `SettingsDialog`; its General tab contains `SettingsForm`, while Advanced contains `SystemInfo` and `RebuildEmbeddings`.

The frontend also exposes same-origin route handlers for streamed Ask and source-chat messages under `app/api/`. They proxy SSE while the ordinary REST calls continue through the shared API client.

## State and data flow

```text
user event
  → page/feature component
  → TanStack hook (lib/hooks/use-*.ts)
  → typed API module (lib/api/*.ts)
  → shared apiClient (auth, timeout, multipart, 401 handling)
  → FastAPI
  → query cache invalidation/refetch
  → rendered state + translated toast/status
```

| Concern | Owner | Persistence/source of truth |
|---|---|---|
| Server data and mutations | TanStack Query hooks plus `QUERY_KEYS` | Backend; frontend query cache is disposable. |
| Auth status, user, token | `auth-store.ts`, accessed through `use-auth.ts` | `auth-storage` plus live API validation. |
| Theme | `theme-store.ts` + `ThemeProvider` | Local storage and document-root class. |
| Library list/card preference | `library-view-store.ts` | Local storage. |
| Sidebar preference | `AppShell`/sidebar primitives | `open-notebook:sidebar-expanded`. |
| Workbench pane/view/width | `workbench-store.ts` | Local storage, keyed by workspace. |
| Resource preview | `use-resource-preview.ts` | `preview` and `previewId` URL parameters. |
| Edit/detail modal | `use-modal-manager.ts` + `ModalProvider` | `modal` and `id` URL parameters. |
| Brand identity | `brand-config.ts` + `BrandProvider` | Validated startup JSON; immutable at runtime. |
| Locale | i18next + `I18nProvider` | i18n language state; mirrored to `<html lang>`. |

Feature hooks map directly to API domains: notebooks/notes, sources/insights, notebook and source chat, Ask/Search, podcasts, transformations, credentials/providers/models, settings, sharing, and embedding maintenance. Add data access to the existing domain module and hook; do not create a second axios client or put request logic in a component.

## Folder ownership

| Folder | Responsibility |
|---|---|
| `src/app/` | Routing, route-level composition, redirects, and same-origin SSE handlers. |
| `src/components/layout/` | Shell, navigation, setup banner, page frame/header. |
| `src/components/workbench/` | Shared responsive research/chat frame, pane tabs, resizer, detail header. |
| `src/components/common/` | Cross-feature behavior such as previews, context selectors, command palette, empty/loading/error primitives. |
| `src/components/<feature>/` | Reusable feature UI for auth, notebooks, sources, search, podcasts, transformations, settings, and sharing. |
| `src/components/ui/` | Stateless Radix-based primitives and variants; no domain requests. |
| `src/lib/hooks/` | Query/mutation orchestration and complex feature controllers. |
| `src/lib/api/` | Typed request functions over the one shared client. |
| `src/lib/stores/` | Small client-only durable UI/auth state. |
| `src/lib/locales/` | The 14 synchronized translation dictionaries; `en-US` defines the shape. |

## Where do I change X?

| Change | Start here | Also verify |
|---|---|---|
| Color, radius, font, motion, scrollbar | `src/app/globals.css` | root `DESIGN.md`, both themes, contrast, reduced motion. |
| Sidebar destination or create action | `components/layout/AppSidebar.tsx` | `CommandPalette.tsx`, active-route tests, mobile drawer. |
| Page spacing or heading structure | `components/layout/PageFrame.tsx` / `PageHeader.tsx` | every consuming route at compact and desktop widths. |
| Notebook/source pane behavior | `components/workbench/ResearchWorkbench.tsx` | `workbench-store.ts`, keyboard resizer, compact tabs. |
| Reference preview/deep link | `use-resource-preview.ts` and `ResourcePreview.tsx` | query-param preservation and browser Back. |
| Auth redirect/session behavior | `auth-store.ts`, `use-auth.ts`, dashboard layout, API client interceptor | password and Entra flows, intended-route restoration. |
| API error copy/disclosure | `lib/utils/error-handler.ts` | locale keys, 4xx actionability, 5xx/network secrecy. |
| Customer identity | `config/brand*.json`, `brand-config.ts`, `BrandProvider.tsx` | startup validation, metadata, both themes, contrast. |
| General/Advanced settings | `SettingsDialog.tsx` and `settings/components/SettingsForm.tsx` | admin gate, API settings hook, narrow-sheet layout. |
| Models and credentials | `/settings/api-keys/page.tsx` plus `components/settings/` | provider registry, encryption readiness, dialog tests. |
| Sharing and groups | `components/sharing/`, `use-sharing.ts`, `/settings/groups/page.tsx` | viewer/editor/owner/admin permissions and 403 state. |
| Any visible copy | `src/lib/locales/en-US/index.ts` | all other locale files and locale parity test. |

