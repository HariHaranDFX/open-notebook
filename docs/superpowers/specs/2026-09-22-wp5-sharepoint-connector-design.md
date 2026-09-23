# WP5 SharePoint connector design

**Status:** Approved for implementation by the user on 2026-09-22; authorization lifecycle amended by the user-approved 2026-09-24 release design.

## Goal

Allow an authenticated user to connect SharePoint with delegated Microsoft
Graph consent, browse locations, import one or many supported documents into
the reusable Sources library, and associate each imported source with zero or
more editable notebooks.

## Boundary

The connector reads external content. It never writes, renames, or deletes the
external SharePoint document. Deleting an Open Notebook source deletes only
the Open Notebook-owned copy created through `OriginalFileStore`.

The connector has its own delegated OAuth records and Graph client. It does not
use the app-only group-sync Graph client and does not use the SharePoint
Embedded storage identity. The storage provider does not read connector tokens.

## Authentication

The existing Entra application is used for incremental delegated consent with
`openid profile offline_access Sites.Read.All`. The redirect URI is the public
frontend origin at `/api/connectors/sharepoint/callback`; its frontend proxy
forwards the callback to the API, and the relative redirect returns to the app.
Connector OAuth state is single-use, expires after ten minutes, and binds the
callback to the current Open Notebook user. MSAL verifies PKCE and state before
its cache is stored.

`connector_connection` stores exactly one SharePoint connection per user. Its
serialized MSAL cache is encrypted with the existing encryption utility;
connection creation fails closed when encryption is not configured. Cache and
tokens are never returned to browsers or logged. Workers acquire tokens silently
from the owner's durable cache, independent of the login session, and persist
cache changes with compare-and-swap/reload to avoid losing concurrent refreshes.
Revoked consent marks the connection `reauth_required`; the user reconnects.
The owner can Disconnect idempotently, clearing local cache without claiming
Microsoft server-side revocation. Existing branch-only raw-token connections
require reconnect after the migration.

## Browsing and import

Authenticated endpoints expose connection status, sites, document libraries,
and folder children. All Graph paging follows only HTTPS next links on the
`graph.microsoft.com` host. Opaque IDs are encoded as path segments, and every
request acquires a delegated token for the current user's connection.

An import request contains a drive, selected file IDs or a folder root, target
notebook IDs, and the existing transformation/embed options. The API verifies
notebook edit access, creates a durable batch, and queues a bulk-import command.

The command enumerates folder descendants when requested. For each supported
file it:

1. streams Graph content to a bounded temporary file;
2. verifies size and file support;
3. saves an Open Notebook-owned copy through `OriginalFileStore`;
4. creates an owned Source and notebook reference edges;
5. queues the existing `process_source` command without duplicating extraction.

One document failure is recorded and does not abort other documents. A token-
or connection-wide authorization failure ends the batch. Import records keep
remote IDs, display names, eTags, source IDs, command IDs, status, and a safe
error message; they never expose tokens or raw Graph errors.

## Data model

- `connector_connection`: user, provider, encrypted MSAL cache, granted
  scopes, external tenant/account metadata, `connected`/`reauth_required`/
  `disconnected` status and timestamps.
- `connector_oauth_state`: hash/state, user, encrypted MSAL auth flow, expiry; consumed
  atomically.
- `connector_batch`: user, connection, location, requested options, aggregate
  status/counters.
- `connector_batch_document`: batch, remote drive/item identity, source/command
  references, per-document status and safe error.

All records are owner scoped. A user cannot browse, import with, or inspect
another user's connection or batch.

## Frontend

The Add Source dialog receives a separate SharePoint type. Its step owns four
states: deployment unavailable, connect/reconnect, folder/file selection, and
batch progress. It calls connector-specific API/hooks rather than the existing
single-upload mutation. The existing notebook selection remains reusable.

Batch progress shows each document independently and treats `partial` as a
terminal result. Existing Source rows continue to show the downstream source
processing state after each item has been queued.

## Acceptance criteria

1. A user can connect and browse only content Microsoft Graph authorizes for
   that delegated identity.
2. A user can import one file, selected files, or all supported files under a
   selected folder and link them to one or more editable notebooks.
3. Every imported document uses the existing source-processing and embedding
   pipeline through the configured original-file store.
4. Per-document progress and partial failure are durable and owner scoped.
5. Deleting an imported Source never calls Graph delete on the external item.
6. MSAL caches are encrypted per user and excluded from responses/logs;
   silent refresh, revocation, concurrent cache updates, and Disconnect are tested.
7. Connector and storage configurations, clients, records, and docs remain
   separate.
