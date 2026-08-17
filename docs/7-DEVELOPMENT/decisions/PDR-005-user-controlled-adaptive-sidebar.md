# PDR-005: User-controlled adaptive sidebar

- **Status**: Accepted
- **Date**: 2026-08-09
- **Supersedes**: [PDR-004](PDR-004-wp3-adaptive-research-shell.md)
- **Related**: [DESIGN.md](../../../DESIGN.md), [WP3 roadmap](../../superpowers/plans/2026-08-07-wp3-redesign-roadmap.md)

## Context

The first WP3 shell made desktop navigation width entirely viewport-driven. Product review showed that this hid a basic workspace control: users could not reclaim content space on a wide display or reveal labels on a laptop display. The light theme also retained a dark navigation canvas, which made the theme change appear incomplete.

## Decision

Open Notebook keeps one navigation hierarchy and adds a dedicated desktop expand/collapse control plus `Ctrl+B` / `Cmd+B`. In the absence of a saved choice, the sidebar defaults to expanded at `1440px` and wider and collapsed from `1024px` through `1439px`. Once the user changes it, that preference is stored locally and takes precedence over the viewport default. Below `1024px`, navigation remains a drawer and does not use the desktop preference.

The expanded header keeps the brand and collapse control separate. The collapsed `64px` rail uses one centered 44px brand slot as the expand control: the logo is visible at rest, the expand icon replaces it on pointer hover or keyboard focus, and coarse pointers see the icon persistently. The shortcut does not intercept editable fields, content-editable regions, or active dialogs, preserving the platform Bold command while users write.

Sidebar colors are theme tokens. Light mode uses a light navigation canvas and dark mode uses a dark navigation canvas; active, inactive, border, and focus roles retain their semantic meaning in each theme.

## Alternatives considered

- **Keep width entirely viewport-driven** — rejected because it prevents users from adapting the workspace to their current task.
- **Show the collapsed logo and expand icon side by side** — rejected because both controls become cramped and visually noisy inside the narrow rail.
- **Make the collapsed brand slot hover-only** — rejected because keyboard, touch, and assistive-technology users require equivalent access. The accepted slot is a labeled button with focus, coarse-pointer, tooltip, and shortcut paths.
- **Create a second navigation component or state library** — rejected because `AppShell` can own the small persisted preference while the existing sidebar and drawer keep one hierarchy.

## Consequences

- The control exposes a localized accessible name, `aria-expanded`, `aria-keyshortcuts`, a visible logo or icon appropriate to the input method, and a tooltip containing the platform shortcut.
- The desktop preference is presentation-only and does not affect routes, permissions, data, or backend behavior.
- Responsive and theme verification must cover both sidebar states as well as the mobile drawer.
