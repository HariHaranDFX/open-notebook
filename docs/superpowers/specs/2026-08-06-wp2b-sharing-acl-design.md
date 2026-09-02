# WP2b — Sharing, Groups & Admin Allocate — Design Spec

- **Status**: Approved (design sessions 2026-08-06); implementing on `wp-2b-sharing`
- **Date**: 2026-08-06
- **Related**: [PDR-003](../../7-DEVELOPMENT/decisions/PDR-003-per-user-ownership-and-sharing.md), [SHARING.md](../../SHARING.md), [TENANCY.md](../../TENANCY.md)

## Goal

Extend WP2 owner-only access with Drive-style grant rows and NotebookLM Viewer/Editor UX. Owners share; admins allocate. Schema ready for later Entra group sync. No public links; no Casbin/OPA.

## Locked decisions

| Topic | Choice |
|---|---|
| Roles | `viewer` \| `editor` (+ implicit `owner`) |
| Highest wins | Across user + group grants |
| Primary share | Notebook (cascades to linked sources, notes, chat, podcasts) |
| Secondary | Direct source grants |
| Podcasts | Inherit via `episode.notebook_id`; no separate podcast ACL |
| Editor delete | Notes + podcasts yes; **sources no**; notebook no |
| Viewer | Search, ask/chat, transforms→insights, play podcasts |
| Groups now | App-local; members = users who signed in ≥ once |
| Groups later | Entra sync (`source` + `entra_group_oid`) |
| Admin see-all | No — explicit allocate |
| Editor reshare | No |

See [SHARING.md](../../SHARING.md) for the operator-facing role matrix and API.
