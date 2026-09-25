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

Assets persist `original_file_store`, `original_file_key`, an optional
`original_file_etag`, and the immutable profile and container used for remote
originals. Existing `file_path` values remain readable as legacy filesystem
references. Storage keys, profile ids, container ids, and physical paths are
server-only.

The configured default is selected by `OPEN_NOTEBOOK_ORIGINAL_FILE_STORE`:

- `filesystem` (default): current uploads directory;
- `sharepoint_embedded`: a pre-provisioned SharePoint Embedded container.

Every asset records its provider, so changing the default affects only new
uploads and does not strand older originals.

## SharePoint Embedded identity

Storage uses a dedicated confidential-client identity, separate from the
connector's delegated `ENTRA_*` credentials. It requests the application
`.default` scope and requires `FileStorageContainer.Selected` plus the
container-type permissions needed to read, write, and delete content. It never
reads `connector_connection` and never uses the signed-in user's token.

The existing `SHAREPOINT_STORAGE_TENANT_ID`, `SHAREPOINT_STORAGE_CLIENT_ID`,
`SHAREPOINT_STORAGE_CONTAINER_ID`, and either
`SHAREPOINT_STORAGE_CLIENT_SECRET` (local/test) or
`SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH` plus optional
`SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE` are the fixed profile `default`.
`SHAREPOINT_STORAGE_PROFILE_ID` (default `default`) selects the profile used
for new uploads. Optional `SHAREPOINT_STORAGE_PROFILES_FILE` is a JSON object
keyed by immutable profile id. Each named profile records `tenant_id`,
`client_id`, and `container_id`, plus either `certificate_pfx_path` and
`certificate_passphrase_env`, or `client_secret_env`. The file stores
environment-variable names, not key material. Production authentication is an
MSAL confidential client with a mounted PFX certificate.

Every Asset records `original_file_store`, `original_file_key`, optional
`original_file_etag`, and, for new originals, `original_file_profile_id` and
`original_file_container_id`. `source.asset` is already `FLEXIBLE`, so these
nested fields need no migration. Reads, retries, HEAD, downloads, cleanup, and
deletes use the recorded profile. A pre-release SharePoint Embedded Asset with
no profile resolves only the fixed legacy `default` profile, never the active
selector. A missing recorded profile or a container that differs from the
Asset's recorded container fails closed. Old named profiles stay configured
when the default is rotated.

Delete sends the Asset eTag as Graph `If-Match` when one is stored. HTTP 404
is idempotent success. HTTP 412 is a conflict: the stored reference, profile,
container, and eTag stay in place for recovery. This subsystem never deletes
an external connector document.

The API upload cap stays 100 MiB unless an operator raises it. Simple Graph
PUT is used only through 10 MiB. Larger allowed uploads use a Graph upload
session and sequential chunks that are a multiple of 320 KiB. The session URL
is preauthorized: it must be HTTPS on an allowed Microsoft host, and the Graph
bearer token is never sent to it. An `original_upload_operation` record is
written before storage starts so reconciliation can finish or remove an
unreferenced managed copy after a crash. Reconciliation never deletes an
object that a Source still references.

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
