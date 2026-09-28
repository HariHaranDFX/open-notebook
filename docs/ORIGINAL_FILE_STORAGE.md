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

Storage uses its own Entra app registration. It does not read `ENTRA_*`, and
it does not use the login app that signs users in or imports SharePoint files.
One owning application can own only one container type. If the login app
already owns a container type, register a second app for storage and leave
the login app on sign-in and the connector.

Put the values in the project-root `.env` (Compose reads that file). Restart
the API and the worker together after any change.

```env
OPEN_NOTEBOOK_ORIGINAL_FILE_STORE=sharepoint_embedded
SHAREPOINT_STORAGE_PROFILE_ID=default
SHAREPOINT_STORAGE_TENANT_ID=00000000-0000-0000-0000-000000000000
SHAREPOINT_STORAGE_CLIENT_ID=00000000-0000-0000-0000-000000000000
SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH=/run/secrets/storage.pfx
SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE=
SHAREPOINT_STORAGE_CONTAINER_ID=replace-with-the-container-id
# Local/test only. Ignored when a certificate path is set:
# SHAREPOINT_STORAGE_CLIENT_SECRET=replace-with-a-secret-value
```

`SHAREPOINT_STORAGE_PROFILE_ID=default` means "use the `SHAREPOINT_STORAGE_*`
variables in this environment." Leave it at `default` unless you are rotating
to another profile.

### Where each value comes from

1. [Entra admin center](https://entra.microsoft.com) → **App registrations →
   New registration**. This is the storage app, not the login app.
2. Open that registration → **Overview**:
   - **Directory (tenant) ID** → `SHAREPOINT_STORAGE_TENANT_ID`
   - **Application (client) ID** → `SHAREPOINT_STORAGE_CLIENT_ID`
3. **Certificates & secrets**:
   - Local test: **Client secrets → New client secret**. Copy the **Value**
     (not the Secret ID) into `SHAREPOINT_STORAGE_CLIENT_SECRET`. It is shown
     only once.
   - Production: mount a PFX and set
     `SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH`. Set
     `SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE` when the PFX has a password.
     When the certificate path is set, the client secret is not used.
4. Create the container type and one container (next section). Copy the
   container id that starts with `b!` into `SHAREPOINT_STORAGE_CONTAINER_ID`.

Store the certificate and any client secret in the deployment secret manager,
not in source control.

### Permissions

On the **storage** app, open **API permissions → Add a permission →
Microsoft Graph → Application permissions**, add both of these, then click
**Grant admin consent**:

| Permission | When it is required |
| --- | --- |
| `FileStorageContainerTypeReg.Selected` | Once, before this app can own a container type. SharePoint Online Management Shell and Graph use it while you register the type. Open Notebook does not call it at runtime. |
| `FileStorageContainer.Selected` | Creating the container, and every upload, download, and delete the running app performs. Also grant this app read, write, and delete on that container type. |

Both rows must show admin consent. `FileStorageContainerTypeReg.Selected`
does not replace `FileStorageContainer.Selected`. A token that can register a
type still cannot create or write containers until `FileStorageContainer.Selected`
is consented.

### Redirects

Storage has **no** sign-in redirect. Do not add a Web redirect URI on the
storage app. It authenticates with the client secret or certificate and the
application scope `https://graph.microsoft.com/.default`. There is no
`SHAREPOINT_STORAGE_REDIRECT_URI`.

Browser callbacks belong on the **login** app only:
`ENTRA_REDIRECT_URI` for sign-in and `SHAREPOINT_CONNECTOR_REDIRECT_URI` for
import. See [Authentication](AUTH.md) and [Connectors](CONNECTORS.md).

### Container type and container id

Open Notebook does not create container types or containers. Create them
before the API starts.

The SharePoint admin-center wizard creates a **DirectToCustomer** type. That
type asks for billing, and Microsoft does not allow it to be deleted or
converted. For a test with no billing, a SharePoint Embedded administrator
or Global administrator uses Windows PowerShell and the SharePoint Online
Management Shell:

```powershell
Install-Module -Name Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser
Connect-SPOService -Url https://<tenant>-admin.sharepoint.com
New-SPOContainerType -TrialContainerType -ContainerTypeName "Open Notebook test" -OwningApplicationId "<SHAREPOINT_STORAGE_CLIENT_ID>"
Get-SPOContainerType
```

`OwningApplicationId` is the storage app's Application (client) ID.
`Get-SPOContainerType` prints `ContainerTypeId`. That GUID is the container
**type**. In the SharePoint admin center it is the SharePoint Embedded app
id. It is not `SHAREPOINT_STORAGE_CLIENT_ID` and not
`SHAREPOINT_STORAGE_CONTAINER_ID`. A trial type can be removed with
`Remove-SPOContainerType`. A DirectToCustomer type cannot. One application
owns one type; a second type needs a new Entra app. Read the expiry and
limits from `Get-SPOContainerType` for the type you created.

Create one container in that type with Microsoft Graph
(`POST /storage/fileStorage/containers`, body field `containerTypeId` set to
the type GUID), then activate it
(`POST /storage/fileStorage/containers/{id}/activate`). An empty **204** from
activate means the container is active. The `id` in the create response
starts with `b!`. That value is the drive id. Copy it to
`SHAREPOINT_STORAGE_CONTAINER_ID`. The SharePoint admin **Active containers**
list does not show this id.

### Extra profiles

Additional immutable profiles live in `SHAREPOINT_STORAGE_PROFILES_FILE`, a
JSON object keyed by profile id. Each entry names `tenant_id`, `client_id`,
`container_id`, and either `certificate_pfx_path` plus
`certificate_passphrase_env` or `client_secret_env`. Those `*_env` values are
environment-variable names, not secrets. Keep old profiles configured when
rotating `SHAREPOINT_STORAGE_PROFILE_ID`; existing Assets keep using the
profile and container recorded on them. A missing profile, or a container that
does not match the Asset, fails closed. Assets created before profiles existed
use only this fixed `default` profile.

These settings are storage credentials. Storage never deletes an external
SharePoint document that the connector imported.

The source API defaults to a 100 MiB request limit
(`OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB=100`). Files through 10 MiB use one streamed
PUT. Larger allowed uploads use a Graph upload session in 5 MiB chunks. The
session URL is preauthorized, so the Graph token is not sent to it. Do not
raise the Open Notebook limit above 250 MiB.

SharePoint Embedded writes an `original_upload_operation` record before the
upload. The worker command `reconcile_original_uploads` retries that record
after 15 minutes: a Source that already references the object is kept, a saved
Source with no processing command is queued once, and an unreferenced managed
copy is deleted. It never deletes an external connector document.

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

The included Compose files pass the storage variables, the login variables, `AUTH_ADMIN_EMAILS`, `CORS_ORIGINS`, and `ENTRA_GROUP_SYNC_*` from `.env` into the app container. Keep the
`./notebook_data:/app/data` volume even with SharePoint Embedded because it also
contains other application data and temporary processing state. Put the values
in `.env`, then restart the app container after changing providers or
credentials. The worker runs in that same container.
