# Original-file storage providers design

**Status:** Approved for implementation by the user on 2026-09-22.

## Goal

Store Open Notebook-owned uploaded originals in a configured backend while
preserving the existing source-processing, download, retry, and retention
behaviour. The current filesystem remains supported; SharePoint Embedded is
the first remote backend.

## Boundary

This subsystem owns only files uploaded to Open Notebook. It is not a source
connector and never uses a user's delegated SharePoint token. SharePoint
connector imports may save their Open Notebook-owned copy through this API,
but connector browsing and external document ownership remain outside it.

## Provider contract

`open_notebook.storage.original_files` exposes an opaque `StoredOriginal` and
an `OriginalFileStore` protocol with five operations:

- save a staged local file;
- materialize a stored object as a temporary/local path for `content-core`;
- stream bytes for authenticated download;
- test existence;
- delete an Open Notebook-owned object idempotently.

Assets persist `original_file_store`, `original_file_key`, and an optional
`original_file_etag`. Existing `file_path` values remain readable as legacy
filesystem references. Storage keys and physical paths are server-only.

The configured default is selected by `OPEN_NOTEBOOK_ORIGINAL_FILE_STORE`:

- `filesystem` (default): current uploads directory;
- `sharepoint_embedded`: a pre-provisioned SharePoint Embedded container.

Every asset records its provider, so changing the default affects only new
uploads and does not strand older originals.

## SharePoint Embedded identity

Storage uses a dedicated confidential-client identity configured with
`SHAREPOINT_STORAGE_TENANT_ID`, `SHAREPOINT_STORAGE_CLIENT_ID`, a credential,
and `SHAREPOINT_STORAGE_CONTAINER_ID`. It requests the application `.default`
scope and requires `FileStorageContainer.Selected` plus the container-type
permissions needed to read, write, and delete content. It never reads
`connector_connection` and never uses the signed-in user's token.

The current API upload limit is 100 MiB, below Graph's 250 MiB simple-upload
limit, so the first implementation uses one PUT without adding an upload-
session dependency. Uploads are staged and streamed from disk; they are not
read wholly into Python memory. A future increase above 250 MiB requires an
upload-session implementation.

## Lifecycle

1. The API streams an incoming `UploadFile` to a private temporary file.
2. Existing file-support checks run against that path.
3. The selected store persists it and returns an opaque reference.
4. The Source asset is saved before the existing processing command is queued.
5. The worker materializes remote originals only for the duration of the
   existing `source_graph` invocation.
6. Downloads stream through the API after existing ACL checks.
7. Retention and source deletion call the store; only managed copies are
   deleted. SharePoint recycle-bin/compliance behaviour remains authoritative.

Storage and SurrealDB cannot share a transaction. Failed source creation
therefore performs a compensating store delete. Deletion keeps the existing
two-phase intent/finalization markers and is safe to retry.

## Compatibility and security

- Legacy JSON `file_path` ingestion stays filesystem-only and containment
  checked.
- No public response, log, or error contains a path, storage key, Graph token,
  upload URL, or raw Graph response body.
- Generated object names use a random identifier plus a sanitized extension;
  the user filename is metadata only.
- `Source.delete`, explicit original deletion, retention cleanup, retry, HEAD,
  and download all use the provider boundary.
- Provider failures are typed as configuration, authentication, network, or
  external-service errors and do not silently discard the database record.

## Acceptance criteria

1. Filesystem uploads retain current user-visible behaviour.
2. SharePoint Embedded uploads process, retry, download, and delete through the
   same public source APIs.
3. The worker never persists a temporary materialization path.
4. Changing the configured default does not affect existing assets.
5. External SharePoint connector documents are never deleted by this subsystem;
   only its managed imported copy may be deleted.
6. Contract, route, processing, retention, and failure-compensation tests pass.
