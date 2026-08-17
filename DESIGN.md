---
name: Open Notebook
description: An evidence-first research workbench for collecting sources, developing thought, and synthesizing with visible provenance.
---

<!-- SEED: approved before WP3 implementation. The implementation must be checked against this contract, then this document must be refreshed only where verified code requires a deliberate, approved correction. -->

# Design System: Open Notebook

## Overview

**Creative North Star: “The Parallel Evidence Workbench.”**

Open Notebook is an operating environment for sustained research, not a dashboard, landing page, or general-purpose chat shell. Its visual world combines an **Evidence Atelier**—calm, editorial space for reading and writing—with a **Surveyor’s Table**—precise instruments for scope, state, permissions, and provenance. The result should feel exact without becoming clinical, quiet without becoming empty, and curious without becoming whimsical.

Every surface must communicate the five approved qualities: **precision, trust, calm, momentum, and curiosity**. A redesign choice that weakens any of them is off-direction even when it is visually attractive in isolation.

The interface exists to support one continuous experience: **collect sources → organize in notebooks → compose the active context → ask or synthesize → verify provenance**. On capable screens, evidence, notes, and synthesis remain simultaneously visible in a resizable workbench. On smaller screens, the same model becomes an explicit sequence without hiding capabilities or losing state.

The signature is the **provenance channel**: evidence selection, context scope, AI references, authorship, processing status, and permissions use a consistent visual grammar throughout the product. Provenance is not decorative metadata. It is how the interface earns trust.

This is the single visual and interaction contract for WP3. [PRODUCT.md](PRODUCT.md) remains the source of product truth and capability scope. Existing backend contracts, data relationships, authentication behavior, and the incoming WP2b permission model remain intact even when navigation, route hierarchy, and containers change.

**Key characteristics:**

- Operate-mode density: calm and compact, with visible controls and no marketing-style hero composition.
- A persistent relationship between evidence, human thought, AI synthesis, and the references connecting them.
- Editorial serif used selectively inside research content; operational UI remains a highly legible sans serif.
- Cool Survey Blue surfaces, precise borders, low radii, and tonal depth instead of floating card stacks.
- One adaptive labeled navigation system and one primary action per view.
- Complete light and dark modes designed independently, not produced by color inversion.
- Keyboard, screen-reader, touch, localization, text-scaling, and reduced-motion behavior treated as core design constraints.

**The Evidence Before Ornament Rule.** A visual device must clarify content, scope, state, action, or provenance. If it does none of those jobs, remove it.

**The Research Momentum Rule.** Navigation, overlays, errors, and asynchronous work must preserve context and help the user continue from the smallest recoverable point.

**The One Product Rule.** Collection libraries, research workspaces, output studios, and administration may have different densities, but they must share the same navigation, token language, state model, and component behavior.

## Colors

The palette is **Survey Blue**: cool, restrained, and instrument-like. Neutral surfaces carry most of the interface. Blue is reserved for action, selection, and provenance; amber is reserved for keyboard focus and attention. Semantic colors communicate outcomes, always with a label, icon, or shape.

### Light theme

| Role | Value | Use |
|---|---:|---|
| Canvas | `#F1F4F7` | Application background and the quiet space behind primary surfaces. |
| Surface | `#FDFEFE` | Main panes, reading surfaces, forms, menus, and dialogs. |
| Raised surface | `#E5EBF0` | Selected groups, toolbars, secondary panels, and tonal separation. |
| Ink | `#172433` | Primary text, high-emphasis icons, and essential structure. |
| Muted ink | `#536272` | Secondary text and supporting metadata; never use where contrast becomes marginal. |
| Border | `#B8C3CD` | Standard dividers, field outlines, pane boundaries, and row separators. |
| Strong border | `#8595A3` | Resizers, emphasized boundaries, and high-clarity control states. |
| Action | `#275E91` | Primary actions, active controls, links, and intentional interaction emphasis. |
| On action | `#FFFFFF` | Text and icons on the Action color. |
| Selected surface | `#DDEAF5` | Selected rows, active tabs, and chosen context items. |
| Selected border | `#9DB5C9` | Boundary for selected controls and evidence rows. |
| Selected ink | `#1C4568` | Text and icons inside a selected surface. |
| Provenance | `#3D6D8D` | Citation edges, reference numbers, and evidence-origin affordances. |
| Provenance surface | `#E2EDF3` | Reference previews and provenance annotations. |
| Focus / attention | `#AD7620` | Keyboard focus rings and attention that is not an error. |
| Focus soft | `#F0DEBD` | Low-emphasis attention surfaces; never the only focus indicator. |

### Dark theme

| Role | Value | Use |
|---|---:|---|
| Canvas | `#101820` | Dark application background. |
| Surface | `#17222C` | Main panes, forms, menus, and dialogs. |
| Raised surface | `#1E2C37` | Toolbars, secondary panels, and tonal separation. |
| Ink | `#EAF0F4` | Primary text and high-emphasis icons. |
| Muted ink | `#A8B5BF` | Secondary text and supporting metadata. |
| Border | `#3B4B58` | Standard dividers, outlines, and pane boundaries. |
| Strong border | `#677988` | Resizers and emphasized boundaries. |
| Action | `#74A9D6` | Primary actions, active controls, and links. |
| On action | `#0C2130` | Text and icons on the dark-theme Action color. |
| Selected surface | `#203A50` | Selected rows, tabs, and context items. |
| Selected border | `#3D6481` | Boundary for selected controls and evidence rows. |
| Selected ink | `#D2E8F7` | Text and icons inside a selected surface. |
| Provenance | `#8DB9D2` | Citation edges, reference numbers, and evidence-origin affordances. |
| Provenance surface | `#1B3342` | Reference previews and provenance annotations. |
| Focus / attention | `#EFB65B` | Keyboard focus rings and attention that is not an error. |
| Focus soft | `#4A381C` | Low-emphasis attention surfaces. |
| Navigation canvas | `#0C1218` | Persistent navigation background. |
| Navigation ink | `#97A7B4` | Inactive navigation labels and icons. |
| Navigation strong ink | `#EEF5F9` | Product identity and highest-emphasis navigation text. |
| Navigation border | `#455764` | Navigation separators and collapsed-rail boundaries. |
| Navigation active surface | `#203B51` | Active destination. |
| Navigation active ink | `#83B7DE` | Active destination label and icon. |

The light navigation uses `#E5EBF0` for its canvas, `#526575` for inactive ink, `#172433` for strong ink, `#B6C2CC` for boundaries, `#D2E1EC` for the active surface, and `#214E73` for active ink. The light and dark navigation canvases must visibly follow the selected theme; a permanently dark rail is not part of the brand signature.

### Semantic states

| State | Foreground | Soft surface | Required companion cue |
|---|---:|---:|---|
| Success | `#286B57` | `#E1F0E9` | Check or completed icon plus a clear label. |
| Information / processing | `#275E91` | `#DFEAF4` | Processing icon, progress, or explicit status text. |
| Warning | `#805614` | `#F5EAD4` | Warning icon and a recovery or consequence statement. |
| Error | `#9B3B37` | `#F5E1DF` | Error icon, problem description, and next action. |
| Provenance | `#3D6D8D` | `#DFEAF2` | Numbered reference, source label, and resource type. |

Dark-mode semantic foregrounds and surfaces must be mapped independently from these meanings and contrast-tested against the dark surfaces; do not reuse the light values mechanically. Disabled controls are neutral, semantically disabled, non-interactive, and approximately 48% emphasized. A dashed boundary or explicit label must distinguish unavailable or incomplete objects where opacity alone would be ambiguous.

**The Blue Has a Job Rule.** Blue identifies an available action, a selected state, or an evidence relationship. It is not general decoration.

**The Focus Is Not Selection Rule.** Selection is blue. Keyboard focus is amber and remains visible at a glance in both themes.

**The Provenance Channel Rule.** A reference combines a blue edge, numbered citation, source label, and resource type. Color alone never carries origin.

**The Constrained Brand Rule.** Customer accent configuration may influence identity and primary action emphasis only after contrast validation. It may not remap semantic outcomes, provenance, focus, or permission meaning.

## Typography

**Operational font:** Source Sans 3, followed by Noto Sans and the platform sans-serif fallback.

**Research font:** Source Serif 4, followed by Noto Serif, Georgia, and the platform serif fallback.

Production fonts are self-hosted. Runtime calls to Google Fonts or another mandatory font service are not allowed. Load only the approved weights: Source Sans 3 at 400, 500, and 600; Source Serif 4 at 400 and 600. Use `font-display: swap` or `optional`, reserve stable text space, and preload only the critical faces.

The sans serif carries navigation, controls, labels, rows, tables, metadata, settings, and operational page headings. The serif appears only where the user is doing research: notebook and research titles, note titles, synthesis conclusions, and sustained reading hierarchy. It never appears on buttons, field labels, status text, or dense administration UI.

### Hierarchy

| Role | Style | Use |
|---|---|---|
| Research display | Source Serif 4, 600, `2rem` / 32px, line-height 1.15 | A major research identity or synthesis heading; uncommon in dense views. |
| Page headline | Source Sans 3, 600, `1.5rem` / 24px, line-height 1.2 | Collection, studio, and administration page titles. |
| Research title | Source Serif 4, 600, `1.125rem` / 18px, line-height 1.3 | Note titles, source-reading sections, and synthesis conclusions. |
| Operational title | Source Sans 3, 600, `1.125rem` / 18px, line-height 1.3 | Pane titles, dialog titles, and section headings. |
| Body | Source Sans 3, 400, `1rem` / 16px, line-height 1.5 | Ordinary interface and reading text; 16px is the production floor. |
| Label | Source Sans 3, 500, `0.875rem` / 14px, line-height 1.35 | Controls, tabs, row labels, and compact navigation. |
| Metadata | Source Sans 3, 400, `0.75rem` / 12px, line-height 1.35 | Timestamps, types, counts, and secondary status; never smaller than 12px. |

Long-form prose measures 60–75 characters on desktop and 35–60 characters on mobile. Prefer wrapping to truncation. Where a dense row must truncate, provide the full value through an accessible reveal, not a hover-only tooltip. Use tabular figures for timers, token counts, progress, and aligned numeric data.

UI copy uses sentence case, direct verbs, and the user’s vocabulary. Actions retain the same name through initiation, progress, and completion. Labels label, examples demonstrate, and errors state both the problem and a safe recovery path.

**The Operational Sans, Evidentiary Serif Rule.** Serif marks reading and considered thought. Sans serif marks control, navigation, and system state. Do not use serif merely to make a page feel premium.

**The Translation Is Real Content Rule.** Layouts must tolerate longer translations, RTL, CJK fallback, 200% zoom, and system text scaling without hiding actions or changing meaning.

## Layout

The spatial model is a persistent application shell around four related surface families. Notebooks are the default entry because they are the primary working object; there is no separate dashboard that duplicates recent work and summary cards.

| Surface family | Routes | Structural pattern |
|---|---|---|
| Collection libraries | `/notebooks`, `/sources` | Page title and one primary action; search, filter, and sort; row-based collection; pagination or virtualization. |
| Research workspaces | `/notebooks/[id]`, `/sources/[id]`, `/search` | Parallel evidence workbench with persistent context, provenance, sessions, and an inspector or preview. |
| Output studios | `/podcasts`, `/transformations` | Local subnavigation; creation header; active queue; artifact library; details, profile, or playground inspector. |
| Administration | `/settings`, `/settings/api-keys`, incoming `/settings/groups`, `/advanced` | Local subnavigation; task-based sections; inline validation; explicit save boundary; destructive maintenance separated from routine configuration. |
| Gateway and global state | `/login` plus global layers | Authentication, session restore, setup, API availability, language loading, error, toast, command palette, and activity status. |

### Application shell

- Use one adaptive sidebar with an icon and visible label for every top-level destination.
- Desktop users can expand or collapse the sidebar with a dedicated control or `Ctrl+B` / `Cmd+B`. In the expanded state, the control remains separate from the brand. In the collapsed state, the centered brand slot is the expansion control: it shows the logo at rest, reveals the expand icon on hover or keyboard focus, and keeps the icon visible for coarse pointers. The choice persists locally; without a saved choice, the sidebar defaults to expanded on wide screens and collapsed at laptop widths.
- Small screens use the same hierarchy in a drawer; do not introduce a competing bottom navigation model.
- Group research destinations, output studios, and administration visibly. Keep theme, language, account, and global activity available without making them primary destinations.
- Keep Search / Ask and the common create action keyboard-reachable. A command palette accelerates navigation; it does not replace visible navigation.
- Show the current location in navigation using shape, label weight, and color. Core navigation remains reachable from deep routes.
- On route changes, move programmatic focus to the main content heading while preserving predictable browser back behavior.

### Parallel evidence workbench

Notebook and source research workspaces use two related regions: a tabbed research panel and a persistent synthesis panel. Notebook tabs are Sources / Notes; source tabs are Content / Insights. Chat remains visible beside them on capable screens and collapses to an explicit rail when the researcher needs more reading space. This preserves parallel evidence and synthesis without forcing three narrow columns.

The research-panel width is resizable on desktop and persists per workspace. Every panel has one deliberate vertical scroller; avoid scroll regions nested inside other scroll regions. Native overflow regions and custom scroll areas use the same thin, token-driven scrollbar treatment with a transparent track and a clearly visible thumb in both themes; the navigation scroller maps that treatment to sidebar tokens. Panel controls remain visible without covering the last content row. Opening a reference updates the appropriate evidence or preview region without discarding the synthesis response.

On narrow screens, Notebook and Source serialize into an explicit Chat / Research-panel segmented choice, defaulting to Chat so the composer remains usable. Search may use Query / Results / Preview, or Query / Answer / References when Ask is active. These are expressions of one evidence-first workbench model, not unrelated page templates.

### Responsive behavior

| Viewport | Navigation | Workspace behavior |
|---|---|---|
| Wide, `≥1440px` | Expanded labeled sidebar by default; user may collapse it | Tabbed research panel plus resizable, collapsible chat. |
| Laptop, `1024–1439px` | Collapsed rail by default; user may expand it | The same two-panel workspace with a narrower research-panel default. |
| Tablet, `768–1023px` | Navigation drawer | Chat / Research-panel segmented choice; internal research tabs remain available. |
| Phone, `320–767px` | Navigation drawer | Chat / Research-panel segmented choice, defaulting to Chat. |

Every capability remains available at every supported width. Library tables become labeled row stacks on narrow screens. Studio grids become ordered lists. Administration subnavigation becomes a sheet or select control. Multi-column forms become one column. Fixed elements respect safe areas and reserve content space. No page causes horizontal viewport scrolling.

Coarse-pointer targets are at least 44×44px with at least 8px between adjacent actions. Desktop density may use smaller visible icons only when their hit area still meets the target requirement. Never rely on hover for discovery or access.

### Spacing and density

Use a 4px base rhythm with the reusable scale `4, 8, 12, 16, 24, 32, 48px`. Apply 4–8px inside compact status groups, 8–12px inside dense rows and controls, 16–24px for pane and section padding, and 32–48px only for major page separation. Responsive gutters grow with the viewport; research prose remains measure-constrained rather than stretching edge to edge.

### State preservation and addressability

Preserve route, active tab, filters, sort, scroll position, selected chat session, pane widths, context choices, and recoverable drafts across navigation. Use optimistic updates only for safe, reversible actions. Source details, insights, transformation playgrounds, episode details, transcripts, and permission-relevant objects remain URL-addressable or deep-linkable even when visually presented in a pane.

**The Simultaneous When Useful, Sequential When Necessary Rule.** Wide screens reveal relationships in parallel. Small screens serialize the same relationships with explicit tabs and a durable context summary.

**The No Redundant Dashboard Rule.** Recent and active research belongs in the notebook library. Do not add a dashboard that duplicates those objects as decorative summary cards.

## Elevation & Depth

Open Notebook is flat and layered. Canvas, surface, raised surface, and selected surface create hierarchy through tone; 1px borders describe panes, rows, fields, and containers. Cards do not float at rest, and hover does not make ordinary content leap toward the user.

Dialogs, sheets, menus, and drag previews are the only routinely elevated objects. Use one restrained overlay shadow: `0 16px 40px rgba(23, 36, 51, 0.18)` in light mode and `0 16px 40px rgba(0, 0, 0, 0.40)` in dark mode. Modal scrims use approximately 48% black and must isolate the foreground without obscuring the user’s sense of place. Blur is allowed only when it reinforces background dismissal and remains performant; it is never decoration.

Selection, focus, loading, and validation change border, tone, icon, or label—not elevation. Resizers use the strong-border role and expand their interactive hit area without becoming visually heavy.

**The Flat by Default Rule.** If an object belongs in the normal reading or working plane, separate it with tone, spacing, and a border—not a shadow.

**The Overlay Earns Elevation Rule.** Elevation signals a temporary layer that requires attention. It does not signal importance, marketing emphasis, or hover.

## Shapes

The form language is compact and instrument-like rather than soft and bubbly:

- **Surfaces:** 4px radius for standalone cards and bordered list containers. Connected workbench panes, tables, and rows inside a unified bordered list remain square.
- **Controls:** 5px radius for buttons, fields, segmented controls, menus, and compact interactive elements.
- **Overlays:** 10px radius for dialogs and sheets, giving temporary layers a slightly more forgiving silhouette.
- **Pills:** 999px radius only for genuine tags, toggles, status tokens, and avatars. It is not a general container style.
- **Borders:** 1px by default; strong borders mark resizers, focus-adjacent structure, and boundaries that must remain evident at low contrast.

Use one Lucide-style outline icon language with 1.5px strokes and consistent optical sizing. Icons accompany visible labels for navigation and unfamiliar actions. Emoji, mixed filled/outline families, and raster structural icons are not part of the system.

**The Radius Has Meaning Rule.** Small radii belong to durable working surfaces, medium radii to controls, and the largest radius to temporary overlays. Do not round every object into the same card silhouette.

**The Pill Must Describe a Token Rule.** A pill shape is valid only when the object is a tag, status, toggle, or similarly compact token.

## Components

Components are direct and explicit. Repeated evidence uses rows; cards are reserved for top-level visual objects such as a notebook, episode, template, or profile when their content benefits from a bounded preview. Editing and recovery happen inline when possible. Overlays are reserved for focused creation, permissions, complex configuration, and irreversible decisions.

### Buttons and action hierarchy

- Show one primary action per view. Use Action blue for that action and keep secondary actions outlined or tonal.
- Keep stable meanings for primary, secondary, ghost, destructive, disabled, and loading variants across all routes.
- Button labels state the result: “Add sources,” “Save changes,” “Generate episode,” or “Remove from notebook.” Do not use vague labels such as “Submit,” “Continue,” or “Confirm” when the result can be named.
- A loading button retains its label context, becomes non-repeatable, and shows progress without changing width.
- Destructive actions use the error role, sit apart from routine actions, and name the exact scope of deletion or revocation.
- Icon-only buttons are limited to familiar, repeated controls; they require an accessible name, visible tooltip for pointer users, and a complete keyboard/touch target.

### Fields, forms, and editing

- Every field has a persistent visible label. Place helper text and errors next to the relevant field; placeholders provide examples, not labels.
- Validate on blur or submission rather than interrupting every keystroke. On a failed submit, focus the first invalid field and provide an error summary when several fields fail.
- Distinguish read-only from disabled. Read-only content remains selectable and legible; disabled controls are visibly unavailable and semantically disabled.
- Preserve drafts in long or multi-step flows. Confirm dismissal when an overlay contains unsaved changes.
- Use progressive disclosure for advanced model, provider, processing, and maintenance options.
- Keep the save boundary explicit. Administration views may use a sticky save region when changes span multiple sections.

### Rows, selection, and collections

- Use rows for sources, notes, search results, jobs, credentials, models, groups, and repeated artifacts where comparison matters.
- Selecting an item for context uses checkbox semantics on the row. Opening the item is a separate, clearly labeled action; clicking ambiguous whitespace must not both select and navigate.
- A selected row uses the selected surface, border, and ink roles. Keyboard focus remains independently visible in amber.
- Rows expose type, ownership/authorship, processing status, permission, and relevant relationship without forcing the user to open a detail view.
- Use skeleton rows while structure is loading, a guided empty state with the next useful action, inline retry for partial failures, and pagination or virtualization for large collections.

### Navigation and local subnavigation

- Top-level navigation uses icon plus text label, predictable grouping, and a persistent active state.
- Tabs change peer content within the current object; they do not duplicate top-level routes.
- Breadcrumbs or a compact parent link orient routes deeper than two levels.
- Overflow menus contain genuinely infrequent actions. They must not hide the only path to a primary or safety-critical action.
- Browser back restores the previous collection state instead of resetting the user to a default screen.

### Evidence context controls

Each notebook source has three explicit context choices: **Excluded**, **Insights only**, and **Full source**. Each note is **Excluded** or **Included**. Bulk controls must state their scope. A context summary and token estimate remain visible before and during synthesis.

When the selected context exceeds a model limit, explain which material is affected and offer a deliberate adjustment. Never silently truncate evidence. Completed evidence remains usable while other items continue processing.

### Provenance and references

- AI references are numbered in reading order and connect to a source, note, or source insight through the provenance channel.
- A reference exposes resource type, title, authorship where relevant, permission state, and enough context to recognize the evidence.
- Opening a reference reveals the material in a pane, inspector, sheet, or addressable route without losing the response or current session.
- Missing, deleted, or revoked resources remain represented as unavailable references. Do not silently remove them and make the response appear unsupported.
- Human-authored notes, saved AI output, generated insights, transformations, and podcast artifacts retain visible authorship and origin.

### Asynchronous work and feedback

Use the shared state progression **editing / idle → validating → queued → processing or streaming → completed**, with explicit branches for **partial**, **failed**, **cancelled**, **interrupted**, and **changed elsewhere**.

- Source ingestion reports every URL, file, or text item independently so one failure does not erase completed work.
- Jobs remain visible near the object and in a global activity surface. Navigating away does not make durable work disappear.
- Streaming responses support cancel and retry. A retry resumes the smallest failed step when the backend allows it.
- Use progress indicators for measurable work, state-specific skeletons for structural loading over roughly 300ms, and restrained spinners only for short indeterminate actions.
- Success toasts are brief, non-blocking, and announced through a polite live region. Errors stay until the user understands the problem and recovery path.
- Optimistic feedback is reserved for safe, reversible actions. Destructive, permission, credential, and model changes wait for server authority.

### Dialogs, sheets, and addressable details

- **Small dialogs, up to 480px:** rename/create notebook, delete or revoke confirmation, and concise model-test results.
- **Medium dialogs, up to 640px:** credential editor, profile editor, and advanced-model selection.
- **Sheets or side panels:** add-source flow, podcast generation, sharing, and permission management.
- **Addressable route or workbench pane:** source and insight detail, transformation playground, episode detail, and transcript.

Dialogs trap focus, receive an accessible title and description, return focus to the trigger, and always provide Escape plus a visible close or cancel action. On phone, complex dialogs become full-height sheets without losing unsaved state.

### Permissions and destructive scope

The interface distinguishes owner, administrator, viewer, and editor capabilities, including access inherited through a group. The current role, why the user has access, and how ownership changes available actions must be visible where decisions depend on them. The backend is authoritative.

A `403` response converts the affected surface to a safe read-only or access-lost state while preserving context. Do not hide a failed edit or imply it was saved. Removing a source from a notebook, deleting the source globally, deleting a notebook, deleting a generated artifact, revoking access, deleting a credential, and changing a default model are separate actions with separate consequence copy.

### Motion and interaction feedback

Motion is state-driven and interruptible:

- `120ms` for press feedback.
- `160ms` for hover, focus, selection, and compact state changes.
- `220ms` for dialogs and sheets.
- No nonessential transition when reduced motion is requested; the final state appears immediately.

Animate transform and opacity, not layout dimensions or pane geometry. Do not choreograph page-load entrances, stagger routine list items, or block input while motion completes. Pressed and focused states never shift surrounding layout.

### Resilience and global states

- **Offline, slow, or timed out:** retain input and context; name the condition; offer retry or a safe degraded path.
- **401 / expired session:** authenticate, then restore the intended destination and recoverable draft.
- **403 / access changed:** preserve safe visibility, explain the permission state, and remove editing affordances only after authority is known.
- **404 / removed object:** explain what is unavailable and return to the relevant collection without inventing replacement content.
- **429 / capacity limit:** retain the request and offer retry timing or an allowed alternative model/provider.
- **API unavailable or setup incomplete:** show an application-level recovery state without leaking infrastructure, credentials, stack traces, or internal identifiers.
- **Extreme data:** support long titles, many sources, large batches, long chats, empty notebooks, partial processing, and conflicting concurrent edits.

## Do's and Don'ts

### Do

- **Do** make the active evidence boundary, authorship, processing state, and permission scope visible wherever they affect an answer or action.
- **Do** keep research material and synthesis parallel on wide screens through a tabbed research panel plus chat, then serialize them through an explicit segmented choice on small screens.
- **Do** use Source Sans 3 for operations and Source Serif 4 only for research reading and thought hierarchy.
- **Do** use rows for repeated evidence and reserve cards for top-level objects that benefit from a bounded preview.
- **Do** preserve drafts, filters, scroll, sessions, context selection, pane widths, and return paths through navigation and authentication.
- **Do** keep one primary action per view and name every action by its exact result.
- **Do** pair every semantic color with text, iconography, shape, or position and verify WCAG AA contrast in both themes.
- **Do** support keyboard operation, logical focus order, screen-reader announcements, 44px coarse-pointer targets, 200% zoom, localization, RTL, and reduced motion.
- **Do** retain visible origin and configuration on generated notes, insights, transformations, and podcast episodes.
- **Do** constrain white-label identity so customer branding cannot weaken accessibility, provenance, focus, or semantic state.

### Don't

- **Don't** redesign Open Notebook as a landing page, generic analytics dashboard, or chat-first product.
- **Don't** add a redundant dashboard, decorative KPI cards, oversized marketing typography, gradients, glass surfaces, or ambient animation to make the app feel “modern.”
- **Don't** use blue decoratively, use color as the only status cue, or make keyboard focus look identical to selection.
- **Don't** hide important actions behind hover, an unlabeled icon, a context menu, or a command palette.
- **Don't** silently truncate evidence, drop failed batch items, remove unavailable references, or imply an asynchronous action completed before server confirmation.
- **Don't** conflate selecting evidence with opening it, removing a notebook association with deleting a source, or viewer access with editor access.
- **Don't** let overlays become primary navigation or use a dialog for content that needs a stable URL, back behavior, or sustained comparison.
- **Don't** use rounded cards as the default container, shadows on ordinary rows, emoji as structural icons, or mixed icon families.
- **Don't** make dark mode by inverting light colors or reuse untested light semantic colors on dark surfaces.
- **Don't** expose credentials, provider payloads, stack traces, internal record identifiers, or deployment details in user-facing errors.
