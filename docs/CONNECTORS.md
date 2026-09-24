# External source connectors

Connectors bring external content **into** Open Notebook as Sources. They do not
store Open Notebook's managed originals in the external system. For that
independent choice, see [Original file storage](ORIGINAL_FILE_STORAGE.md).

## SharePoint connector

The first connector is an on-demand SharePoint document import. One signed-in
user authorizes delegated Microsoft Graph read access, browses sites and document
libraries in **Add Source → SharePoint**, and selects one file, multiple files,
or a folder. The import creates reusable Sources in the library. The user can
associate the new Sources with zero, one, or multiple editable notebooks; normal
source processing, transformations, and embeddings then run in the existing
worker pipeline. A folder import traverses its supported descendants.

This is a **copy**, not a live sync. Editing or deleting the SharePoint item does
not edit or delete the imported Source, and deleting the Source or its retained
original does not delete the SharePoint item. An import gets the content available
at the time the batch runs. Subsequent imports use the connector's recorded
item identity to avoid duplicate Sources for the same owner.

### Configure

1. Use Entra sign-in (`AUTH_PROVIDER=entra`) and set `ENTRA_TENANT_ID`,
   `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET`. The connector reuses this Entra
   app registration but keeps its OAuth state and encrypted MSAL cache separate from
   the login session. It does **not** use the SharePoint Embedded storage app.
2. Grant the app Microsoft Graph **delegated** `Sites.Read.All` permission and
   obtain tenant consent where required. The connector requests
   `openid profile offline_access Sites.Read.All` when the user connects; it
   never requests app-only site access or write permission.
3. Register a second **Web** redirect URI in the Entra app, pointing to the
   public **frontend** origin plus `/api/connectors/sharepoint/callback`. Set
   `SHAREPOINT_CONNECTOR_REDIRECT_URI` to that exact URI. For local development:

   ```env
   SHAREPOINT_CONNECTOR_REDIRECT_URI=http://localhost:3000/api/connectors/sharepoint/callback
   ```

   Keep the existing `ENTRA_REDIRECT_URI` for sign-in; the two callbacks are
   different. In a deployed environment use the externally reachable HTTPS
   frontend URL, not a container hostname. The frontend API proxy forwards the
   callback to FastAPI so its relative redirect returns to the app.
4. Set a stable `OPEN_NOTEBOOK_ENCRYPTION_KEY`. Per-user serialized MSAL caches
   are encrypted at rest. Losing or changing this key requires users to reconnect.
5. Start the API and the surreal-commands worker. Without the worker, accepted
   import batches remain queued. The API's schema migrations run at startup.

When configuration is missing, Add Source shows the connector as unavailable.
After consent the callback returns to the application home page; reopen Add
Source to browse. Workers use the durable per-user MSAL cache after the login
session ends. If consent expires or is revoked, silent acquisition marks the
connection `reauth_required`; the user reconnects. The owner can call
`POST /api/connectors/sharepoint/disconnect` to clear local credentials
idempotently. This does not revoke consent on Microsoft's servers; revoke it in
Entra if server-side revocation is needed. Existing branch-only connections
created with raw refresh tokens must reconnect.

### Import status and troubleshooting

The import endpoint returns a batch ID immediately. The dialog polls the batch
while it is pending or running and shows each document's queued, failed, or
skipped result. A completed batch means the existing Source-processing jobs were
queued; extraction and embeddings may still be running. A partial batch keeps
successful Sources and reports failed documents. The owner can retry failed
documents with `POST /api/connectors/sharepoint/batches/{batch_id}/retry`;
already queued documents stay untouched. A folder retry uses the documents
recorded in that batch and does not add files discovered after the first run.
The same remote eTag reuses its managed
Source across batches and adds newly selected notebook links. A changed eTag
creates a new Source snapshot. Files without an eTag are treated as distinct
imports. Folder listings beyond 1,000 items fail visibly instead of reporting
completion. The source
library and selected notebooks refresh when the batch reaches a terminal state.

- **Unavailable:** check Entra auth mode, all four connector configuration values
  (including redirect URI), and the encryption key. Inspect API startup logs.
- **Consent/callback failure:** verify the callback matches the Entra Web redirect
  URI exactly and that the signed-in user still has a session. Check delegated
  `Sites.Read.All` consent; this is separate from application permissions used
  by other features.
- **Reauthorization required / connector 409:** reconnect and re-consent. Revoked
  consent cannot be repaired by restarting the worker.
- **Browse or download 429/502:** Graph may throttle or be unavailable. Retry
  after the upstream recovers; the connector uses bounded retries for import
  downloads and does not create duplicate Sources on job recovery.
- **Batch stays pending:** check that the surreal-commands worker is running and
  its logs. The API alone only queues the command. An interrupted remote-version
  claim is recoverable after its 15-minute lease expires; retry the failed batch.
- **A document is skipped or fails:** check whether it is a supported source
  type and within the configured upload-size limit. Other documents in the
  batch continue; the dialog reports per-document safe errors.

Do not place client secrets, cache contents, or tokens in support tickets or logs.

## Adding another connector

`open_notebook/connectors/base.py` defines the normalized `SourceConnector`
read contract: `get_document(drive_id, item_id)`, `list_sites(query)`,
`list_drives(site_id)`, `list_children(drive_id, item_id)`,
`iter_documents(drive_id, item_id)`, and `download(drive_id, item_id)`.
Implement these methods with the new provider's own consent, ownership, paging,
and safe-error mapping. The existing batch ingestion path should then copy bytes
through `OriginalFileStore` and queue the normal Source processor. Do not put
connector tokens into `Asset`, reuse the storage provider's app credentials, or
make Source deletion call the external provider's delete API.
