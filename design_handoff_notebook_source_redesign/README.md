# Handoff: Open Notebook — Notebook & Source screen redesign

## Overview
Redesign of the Notebook detail screen and the Source detail screen in Open Notebook. Both screens replace a cramped 3-column layout (sources/notes, content/insights, chat) with a **2-panel layout**: a resizable tabs panel on the left, and a chat panel on the right that can be fully collapsed. Includes desktop, tablet (landscape + portrait), and mobile variants.

## About the design files
`reference.html` in this folder is a **design reference**, not production code — it's a static/interactive HTML mockup built to show layout, states, and behavior. Do not copy its markup or inline styles directly into the app. Recreate this design in the target codebase's existing framework (React, Vue, etc.) and component/styling conventions, using its existing design tokens/components where they already match this spec.

## Fidelity
**High-fidelity.** Colors, type, spacing, and interactions below are final — implement pixel-close using the app's real component library.

## Global layout (all breakpoints)
Left global sidebar (existing app nav — unchanged, not redesigned here) + one main content area per screen.

Main content area, top to bottom:
1. **Header** — back arrow, title block, Share button, "⋯" overflow menu, pills row.
2. **Body** — two panels: a left "tabs" panel and a right "Chat" panel, separated by a draggable resize handle.

## Header spec
- Back arrow (`←`), 16px, color `#8993a3`, top-aligned with title.
- **Notebook screen**: Title = notebook name, serif, 700 weight, 22px, color `#1a1f29`, font-family `"Source Serif 4", Georgia, serif`. Directly below: description text ("Add description..." placeholder when empty), 13px system-ui, color `#8993a3`.
- **Source screen**: Title = filename (serif, 700, 18px, truncate with ellipsis if long). Directly below: "Source ID: source:xxxxxxxx" — 12px system-ui, color `#8993a3`.
- Right of title: **Share** button (outline, `#1a1f29` text, `#dde2e9` 1px border, 6px radius, 12.5px 600 weight) and **⋯** overflow menu button (same outline style, icon only).
- Below title block: **pills row**, 8px gap. Pills are 20px-radius rounded chips, background `#eef1f5`, text `#55607a`, ~11.5px.
  - Notebook: `Owner` (600 weight) · `Created 7 days ago` · `Updated 39 minutes ago`.
  - Source: `PDF` (600 weight, file type) · `Created 7 days ago` · `Updated 39 minutes ago`.
  - No insight-count pill in the header (insight count lives in the Insights tab instead).

## Body — left tabs panel
- Default width **460px** desktop / **340px** tablet landscape, resizable between **280–680px** by dragging the handle. On tablet portrait and mobile it becomes a full-width view (see "Narrow layouts" below) instead of a side-by-side panel.
- Tab bar at top of the panel, 2 tabs, underline style: active tab = 600 weight, color `#223056`, 2px bottom border `#223056`; inactive = 500 weight, color `#8993a3`, transparent border.
  - Notebook: **Sources · N** / **Notes · N**
  - Source: **Content** / **Insights · N**
- **Sources tab**: "+ Add Source" button (filled, background `#223056`, white text, 6px radius) then a card per source (1px border `#e1e5eb`, 8px radius, 14px padding; filename 600/12.5px + insight-count pill below).
- **Notes tab (empty state)**: centered — "No notes yet" (600/14px `#1a1f29`) + helper line + "+ Write Note" filled button.
- **Content tab**: source's extracted text, 13.5–14px/1.7 line-height, color `#2b3242`, scrollable.
- **Insights tab**:
  1. "Generate New Insight" label (600/12.5px).
  2. **"Select a transformation…" dropdown** — 1px border `#dde2e9`, 6px radius, 9–12px padding, placeholder color `#8993a3`, a ▾ caret at the right edge. (This dropdown was missing in an earlier pass — it must be present, stacked above the button.)
  3. Full-width "+ New" button below the dropdown (filled `#223056`, white text, 6px radius, centered).
  4. Insight card(s) below: 1px border `#e1e5eb` card, "DENSE SUMMARY" label chip (background `#eef1f5`, 10px 700 weight uppercase, tracked), summary text (12.5px/1.6, `#55607a`), "View Insight" outline button.

## Body — right chat panel (identical structure on both screens)
Top to bottom:
1. Header row: "Chat with Notebook" / "Chat with Source" (600/13px, `#1a1f29`) — **Sessions** button (outline pill with a clock glyph, right-aligned) — collapse chevron `›` (click to collapse the whole panel).
2. Message list — user bubbles right-aligned, filled `#223056`/white text; assistant bubbles left-aligned, background `#eef1f5`, text `#2b3242`. 13.5px/1.55, 10px radius, max-width 88%.
3. **Context bar** — background `#eef1f5`, 8px radius: "Context" label (600/12px `#55607a`) + token/char count (400/12px `#8993a3`). On the notebook chat, an outlined round "1" badge sits at the far right (context source count).
4. **Model row** — directly below Context, **left-aligned**, ABOVE the input box: "Model" label (500/11.5px `#8993a3`) + model-name chip (outline, `#1a1f29`, e.g. `gpt-4.1-mini`). *(Order matters: Context → Model → Input — Model must not be pushed below/right of the input row.)*
5. Input row — text field placeholder "Ask anything about your sources...", filled circular send button (`#223056`) to its right.

### Collapsed chat state
Clicking the `›` chevron collapses the chat panel to a **44px-wide rail**: a `‹` chevron + a vertical "Chat" label (rotated 90°, `writing-mode: vertical-rl`), centered, click to re-expand. The left tabs panel expands to fill the freed space. The resize handle disappears while collapsed.

### Resize handle
A 6–7px-wide strip between the two panels, background `#eef1f5`, with a short vertical grip pill (`#c7ccd6`, 3×28px) centered in it. `cursor: col-resize`. Drag left/right to resize the left panel between 280–680px; the chat panel takes remaining space (`flex:1`).

## Narrow layouts (tablet portrait & mobile)
Side-by-side panels don't fit below ~760px wide. Replace the resizable split with a **top-level segmented control** directly under the header pills: two equal-width pill buttons, **"Chat"** and **"Sources & Notes"** / **"Content & Insights"**. Active = filled `#223056`/white; inactive = `#eef1f5`/`#55607a`. Selecting a segment swaps the ENTIRE body between:
- **Chat view** — same chat panel as desktop (header, messages, Context, Model, Input), taking the full width/height. This must stay the default so the input/send button are never covered by anything else.
- **Panel view** — the same tabs panel content (Sources/Notes or Content/Insights) full width/height.

Do not use a floating action button + bottom sheet for this — it visually collided with the chat input in an earlier pass.

## Breakpoints to implement
- **Desktop**: ~1180px+ main content width. Full sidebar, two side-by-side panels as described.
- **Tablet landscape** (~1024px): same two-panel layout; app sidebar collapses to a 56px icon-only rail to save width; left tabs panel default width narrows to ~340px.
- **Tablet portrait** (~760–834px) and **Mobile** (~375px): segmented "Chat / Panel" full-screen switch as described above. Header pills and info wrap/truncate as needed (e.g. filename gets `text-overflow: ellipsis`).

## Design tokens
- Ink / primary text: `#1a1f29`
- Secondary text: `#55607a`
- Tertiary / muted text: `#8993a3`
- Page background: `#f7f8fa`
- Panel/pill background: `#eef1f5`
- Borders: `#e1e5eb` (cards), `#dde2e9` (inputs/buttons)
- Primary accent (buttons, active tab, user bubble): `#223056`
- Active-nav tint: `#e7edf9`
- Resize-handle grip: `#c7ccd6`
- Radii: 6px (buttons/chips-square), 8px (cards/inputs), 10px (chat bubbles), 20px (pills)
- Headings font: `"Source Serif 4", Georgia, serif`, 700 weight
- UI font: system-ui / -apple-system stack
- Type scale used: 11–11.5px (chips/meta) · 12–13px (labels/tabs) · 13.5–14px (body/messages) · 18–24px (titles)

## Interactions & state
- Tab switching (Sources↔Notes, Content↔Insights): simple local UI state, no page reload.
- Left-panel resize: pointer-drag on the handle, clamp width 280–680px.
- Chat collapse/expand: boolean toggle; persists per screen while navigating within it (does not need to persist across sessions unless desired).
- Mobile/tablet-portrait segmented view: boolean/enum toggle (`chat` | `panel`), defaults to `chat`.

## Files
- `reference.html` — the interactive HTML mockup (all breakpoints/states as separate labeled sections you can click through: `2a`–`2n`). Open it in a browser to see and interact with every state described above.
