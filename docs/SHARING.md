# Sharing, groups, and allocation (WP2b)

This document describes how multi-user access works after WP2 identity.
Identity and login remain in [AUTH.md](AUTH.md). Tenancy remains Model A
([TENANCY.md](TENANCY.md)): grants never cross deployments.

## Model

- Every notebook and source has an **owner** (`user_id` set at create).
- Access beyond the owner is granted via **`resource_grant`** rows:
  - resource: `notebook` or `source`
  - principal: `user` or `group`
  - role: `viewer` or `editor`
- **Highest role wins** across direct and group grants.
- **No public / link sharing** in this release.
- Podcasts are not shared separately: they inherit access from their
  `notebook_id` (plus the episode owner).

## Roles

| Role | Capabilities |
|---|---|
| **viewer** | Read sources/notes; search; ask/chat; run transformations → insights; play podcasts. Cannot add/delete sources, delete notes, generate/delete podcasts, or manage ACL. |
| **editor** | Everything a viewer can do, plus add/edit sources, delete notes, generate/delete podcasts, update notebook metadata, link/unlink sources. **Cannot** delete sources, delete the notebook, or manage ACL. |
| **owner** | Full control, including delete sources/notebook and manage grants. |
| **admin** | Manage groups; create/revoke grants on any resource (allocate). Does **not** implicitly see all content. |

## Groups

- **Now:** app-local groups (`user_group.source = local`). Admins create
  groups and add members from users who have **signed in at least once**
  (rows in the `user` table). The picker does not list the full Entra
  directory.
- **Schema ready for Entra:** `user_group.source` and `user_group.entra_group_oid`
  (migration 28). Sync itself is a tracked follow-on (WBS **4.20**).

## Deferred follow-ons (not WP2b)

Tracked in the commercialization WBS workbook and `scripts/wbs_tasks.py`:

| WBS | Item | Status | Notes |
|---|---|---|---|
| **4.20** | **Entra ID group sync** | Pending (High) | Main post-WP2b group goal. Graph permissions + membership sync into `user_group` / `user_group_member`. |
| **4.21** | **Full org directory user picker** | Pending (High) | Today: only users who signed in ≥ once (`GET /api/users`). Later: Graph directory search + pending grant / JIT stub. |
| **4.22** | **Public links, editor reshare, ownership transfer** | Pending (Medium) | Explicitly out of WP2b. Public/link share off by default forever unless product re-opens; editor reshare and ownership transfer need separate design. |

Do **not** mix these into WP3 white-label work.

## API

| Endpoint | Who |
|---|---|
| `GET /api/users` | Authenticated — share/group picker |
| `GET/POST/PATCH/DELETE /api/groups…` | Admin |
| `GET/POST/PATCH/DELETE /api/notebooks/{id}/grants` | Owner or admin |
| `GET/POST/PATCH/DELETE /api/sources/{id}/grants` | Owner or admin |

Notebook and source responses include `access_role`: `owner` \| `editor` \| `viewer`.

## Inheritance

Sharing a **notebook** grants the same effective role on linked sources,
notes, chat sessions, and podcasts for that notebook. A **source** may also
be granted directly without a notebook.

## Security notes

- No access → **404** (same as WP2; do not leak existence).
- Visible but insufficient role → **403** (e.g. viewer tries to edit).
- Auth disabled / open mode → helpers remain no-ops (global visibility).
