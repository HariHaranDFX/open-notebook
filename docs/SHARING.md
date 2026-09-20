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

- **App-local groups (`user_group.source = 'local'`):** admins create groups
  and add members from users who have **signed in at least once** (rows in
  the `user` table). The picker does not list the full Entra directory —
  that is WBS 4.21.
- **Entra-linked groups (`user_group.source = 'entra'`, WBS 4.20):** admins
  link a Microsoft Entra security group by picking it from a Graph
  typeahead in **Settings → Groups → Link Entra group**. Membership is
  populated by a background `sync_entra_groups` command; the admin cannot
  add or remove members locally (`PATCH`/member endpoints refuse with 409
  `apiErrors.entraGroupManaged`). Direct-member expansion only. Opt in via
  `ENTRA_GROUP_SYNC_ENABLED=true` and add the `GroupMember.Read.All`
  Application permission on the Entra app registration; see
  [AUTH.md § Entra group sync](AUTH.md#entra-group-sync-wbs-420).

## Deferred follow-ons (not WP2b)

Tracked in the commercialization WBS workbook and `scripts/wbs_tasks.py`:

| WBS | Item | Status | Notes |
|---|---|---|---|
| **4.20** | **Entra ID group sync** | ✅ Done | Ships behind `ENTRA_GROUP_SYNC_ENABLED`. See [AUTH.md § Entra group sync](AUTH.md#entra-group-sync-wbs-420). Direct members only; unknown Entra members auto-attach at first login. |
| **4.21** | **Full org directory user picker (Graph) + JIT-stub Entra group members** | Pending (High) | Today: only users who signed in ≥ once (`GET /api/users`); WBS 4.20 sync also skips Entra group members with no local user row. Later: Graph directory search + JIT-stub `user` rows (during sync and on first grant) carrying `entra_oid`/`email`/`display_name`, upserted on first Entra login. |
| **4.22** | **Public links, editor reshare, ownership transfer** | Pending (Medium) | Explicitly out of WP2b. Public/link share off by default forever unless product re-opens; editor reshare and ownership transfer need separate design. |
| **4.23** | **Entra ID group-membership webhooks (Graph change notifications)** | Pending (Medium) | Live push-based membership updates via `POST /api/graph/webhook`; replaces the 15-minute polling loop for near-real-time propagation. Needs publicly-reachable HTTPS callback, `clientState` HMAC validation, subscription lifecycle + ~3-day auto-renewal, replay-dedupe. Deliberately split from 4.20 so subscription lifecycle gets its own security review. Falls back to the polling loop when the subscription is missing/invalid. |

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
