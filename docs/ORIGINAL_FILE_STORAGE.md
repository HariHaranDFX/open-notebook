# Original file storage

Open Notebook stores originals that users upload through the source API in one
configured backend. The default is the local filesystem; SharePoint Embedded is
available for deployments that need Microsoft 365-managed storage.

This subsystem owns only Open Notebook's managed copy. It is separate from the
inbound SharePoint connector: connector browsing and imported item ownership use
the connector connection, while original-file storage uses its own application
identity. Deleting a Source or its retained original never deletes the external
connector item.

## Filesystem (default)

```env
OPEN_NOTEBOOK_ORIGINAL_FILE_STORE=filesystem
```

Files are stored under `UPLOADS_FOLDER` (`/app/data/uploads` in the standard
container). Keep the `/app/data` volume durable and include it in backups along
with SurrealDB. A database backup alone does not contain uploaded originals.
Legacy absolute `file_path` records remain readable, but deletion is refused if
the resolved path is outside the configured uploads directory.

## SharePoint Embedded

Set the provider and the fixed `default` profile. Production uses a mounted
PFX certificate. A client secret remains available for local tests:

```env
OPEN_NOTEBOOK_ORIGINAL_FILE_STORE=sharepoint_embedded
SHAREPOINT_STORAGE_PROFILE_ID=default
SHAREPOINT_STORAGE_TENANT_ID=00000000-0000-0000-0000-000000000000
SHAREPOINT_STORAGE_CLIENT_ID=00000000-0000-0000-0000-000000000000
SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH=/run/secrets/storage.pfx
SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE=
SHAREPOINT_STORAGE_CONTAINER_ID=replace-with-the-container-id
# Local/test only, used when no certificate path is set:
# SHAREPOINT_STORAGE_CLIENT_SECRET=replace-with-a-secret-value
```

Additional immutable profiles live in `SHAREPOINT_STORAGE_PROFILES_FILE`, a
JSON object keyed by profile id. Each entry names `tenant_id`, `client_id`,
`container_id`, and either `certificate_pfx_path` plus
`certificate_passphrase_env` or `client_secret_env`. Those `*_env` values are
environment-variable names, not secrets. Keep old profiles configured when
rotating `SHAREPOINT_STORAGE_PROFILE_ID`; existing Assets keep using the
profile and container recorded on them. A missing profile, or a container that
does not match the Asset, fails closed. Assets created before profiles existed
use only this fixed `default` profile.

These settings are storage credentials. They are not the connector's
`ENTRA_*` delegated credentials, and storage never deletes an external
SharePoint document.

The application registration needs the Microsoft Graph application permission
`FileStorageContainer.Selected`, administrator consent, and authorization for
the selected container type/container with read, write, and delete access. The
container must be provisioned before Open Notebook starts; the application does
not create containers or container types. Store the certificate and any client
secret in your deployment secret manager rather than source control.

The source API defaults to a 100 MiB request limit
(`OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB=100`). Uploads are streamed from a temporary
disk file. Do not raise the Open Notebook limit above 250 MiB.

Each new Asset stores its provider, opaque object ID, profile id, and
container id. Changing the active profile affects new uploads only. Provider
keys, profile ids, container ids, local paths, Graph tokens, and raw Graph
responses are never public source metadata. Deletion sends the stored eTag as
`If-Match`. A missing object is already deleted. An eTag conflict leaves the
Asset reference in place.

## Deletion, recovery, and backup

Retention cleanup, explicit original deletion, and full Source deletion share
one two-phase operation:

1. persist the deletion-start marker and reason;
2. delete the managed object through its recorded provider and profile;
3. clear the storage reference and persist the completion timestamp.

If provider configuration, lookup, or deletion fails, the Source and its opaque
reference remain so the operation can be retried. Repeated deletion is safe, and
provider-backed objects are never passed to local filesystem deletion APIs.

For SharePoint Embedded, Microsoft 365 recycle-bin, retention, compliance, and
backup policies remain authoritative after Graph deletion. Configure and test
those policies in the tenant; Open Notebook does not provide a second remote
backup or restore deleted objects. For filesystem storage, use filesystem or
volume snapshots and restore the database and uploads from a consistent backup.

## Docker Compose

The included Compose file passes through all storage variables. Keep the
`./notebook_data:/app/data` volume even with SharePoint Embedded because it also
contains other application data and temporary processing state. Put the values
in `.env`, then restart the API and worker together after changing providers or
credentials.
