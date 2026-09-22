# WP5 SharePoint connector design

**Status:** Approved for implementation by the user on 2026-09-22.

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
`openid profile offline_access Sites.Read.All`. Connector OAuth state is
single-use, expires after ten minutes, and binds the callback to the current
Open Notebook user. The callback verifies PKCE and state before storing a
refresh token.

`connector_connection` stores exactly one SharePoint connection per user. Its
refresh token is encrypted with the existing encryption utility; connection
creation fails closed when encryption is not configured. Tokens are never
serialized or logged. Refresh-token rotation replaces the encrypted value;
`invalid_grant` marks the connection disconnected and asks the user to connect
again.

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

- `connector_connection`: user, provider, encrypted refresh token, granted
  scopes, external tenant/account metadata, connection timestamps/status.
- `connector_oauth_state`: hash/state, user, PKCE verifier, expiry; consumed
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
6. Tokens are encrypted per user, excluded from responses/logs, and refresh
   rotation/revocation are tested.
7. Connector and storage configurations, clients, records, and docs remain
   separate.
