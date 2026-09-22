# Original-file storage providers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve uploaded originals through a provider-neutral API and add SharePoint Embedded as a configurable backend without changing the source-processing contract.

**Architecture:** A storage module owns opaque references and provider selection. Incoming bytes are staged once, providers persist them, and workers materialize them only around the existing content-core graph. Connector code may call the storage API but cannot access provider credentials.

**Tech Stack:** Python 3.12, FastAPI/Starlette UploadFile, httpx, Pydantic, pytest, Microsoft Graph v1.0.

**Spec:** `docs/superpowers/specs/2026-09-22-original-file-storage-providers-design.md`

## Global Constraints

- Apply ponytail full mode and karpathy-guidelines: smallest surgical diff, existing dependencies only.
- Preserve legacy `asset.file_path` reads and filesystem behaviour.
- Never expose physical paths, opaque keys, credentials, or raw Graph bodies.
- Storage identity and configuration must not import connector modules.
- Write one failing public-behaviour test before each implementation slice.

---

### Task 1: Provider contract and filesystem implementation

**Files:**
- Create: `open_notebook/storage/__init__.py`
- Create: `open_notebook/storage/original_files.py`
- Test: `tests/test_original_file_store.py`

**Interfaces:**
- Produces: `StoredOriginal(provider, key, size_bytes, etag=None, file_path=None)`.
- Produces: `OriginalFileRef(provider, key, etag=None, legacy_file_path=None)`.
- Produces: `get_original_file_store(provider: str | None = None) -> OriginalFileStore`.
- Produces: `reference_from_asset(asset: Asset) -> OriginalFileRef | None`.

- [ ] **Step 1: Write a failing filesystem contract test**

Create a temporary uploads root, save a staged file through `FilesystemOriginalFileStore`, materialize it, stream it, test existence, delete it twice, and assert the stored key is relative and cannot escape the configured root.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_original_file_store.py -q`

Expected: collection failure because `open_notebook.storage.original_files` does not exist.

- [ ] **Step 3: Implement the minimum contract**

Use a `Protocol` with these async methods:

```python
async def save(self, staged_path: Path, filename: str) -> StoredOriginal: ...
@asynccontextmanager
async def materialize(self, ref: OriginalFileRef) -> AsyncIterator[Path]: ...
async def iter_bytes(self, ref: OriginalFileRef) -> AsyncIterator[bytes]: ...
async def exists(self, ref: OriginalFileRef) -> bool: ...
async def delete(self, ref: OriginalFileRef) -> bool: ...
```

The filesystem provider reuses the existing safe unique-name behaviour, moves the staged file atomically when possible, resolves every key beneath `UPLOADS_FOLDER`, and treats absent delete targets as success.

- [ ] **Step 4: Verify GREEN**

Run: `uv run pytest tests/test_original_file_store.py -q`

- [ ] **Step 5: Commit**

Commit message: `feat(storage): add original file store contract`

---

### Task 2: SharePoint Embedded provider

**Files:**
- Create: `open_notebook/storage/sharepoint_embedded.py`
- Modify: `open_notebook/storage/original_files.py`
- Test: `tests/test_sharepoint_embedded_store.py`

**Interfaces:**
- Consumes: `OriginalFileStore`, `StoredOriginal`, and `OriginalFileRef` from Task 1.
- Produces: `SharePointEmbeddedOriginalFileStore` selected by `OPEN_NOTEBOOK_ORIGINAL_FILE_STORE=sharepoint_embedded`.

- [ ] **Step 1: Write a failing Graph transport test**

With `httpx.MockTransport`, assert the provider gets an app-only `.default` token from the storage-specific tenant/client settings, PUTs the staged bytes to `/drives/{container}/root:/{generated-name}:/content`, returns the item ID/eTag, follows the authenticated content redirect for download, and sends DELETE only for that configured drive/item.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_sharepoint_embedded_store.py -q`

Expected: import failure for the missing provider.

- [ ] **Step 3: Implement storage-specific Graph authentication and operations**

Use existing `httpx`; do not add the Graph SDK. Require:

```text
SHAREPOINT_STORAGE_TENANT_ID
SHAREPOINT_STORAGE_CLIENT_ID
SHAREPOINT_STORAGE_CLIENT_SECRET
SHAREPOINT_STORAGE_CONTAINER_ID
```

Cache the app token only until sixty seconds before expiry. Sanitize the extension and generate a UUID object name. Send a `Content-Length` header and stream from disk. Reject redirects except HTTPS Microsoft/SharePoint download hosts. Map 401/403 to `AuthenticationError`, missing config to `ConfigurationError`, and other non-transient Graph failures to `ExternalServiceError` without including the raw body.

- [ ] **Step 4: Add retry/throttling behaviour tests and implementation**

Test one `429` with `Retry-After: 0` followed by success, and a bounded `5xx` retry. Implement only those bounded retries; do not add a general retry framework.

- [ ] **Step 5: Verify GREEN**

Run: `uv run pytest tests/test_sharepoint_embedded_store.py tests/test_original_file_store.py -q`

- [ ] **Step 6: Commit**

Commit message: `feat(storage): add SharePoint Embedded originals`

---

### Task 3: Upload, processing, retry, and download integration

**Files:**
- Modify: `open_notebook/domain/notebook.py`
- Modify: `api/routers/sources.py`
- Modify: `commands/source_commands.py`
- Modify: `open_notebook/graphs/source.py`
- Modify: `api/source_file_service.py`
- Modify: `api/routers/source_files.py`
- Test: `tests/test_source_storage_integration.py`
- Modify: `tests/characterization/test_source_ingestion_characterization.py`

**Interfaces:**
- Consumes: provider contract from Task 1.
- Produces: Asset fields `original_file_store`, `original_file_key`, and `original_file_etag`.
- Produces: `stage_upload(upload: UploadFile) -> async context manager[Path]` and provider-neutral authenticated download.

- [ ] **Step 1: Write a failing upload integration test**

Post a multipart upload with a fake configured store. Assert chunks are staged without calling `UploadFile.read()` with an unbounded size, the Asset persists the opaque reference, the processing command receives provider/key metadata, and no storage key appears in `SourceResponse`.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_source_storage_integration.py -q`

- [ ] **Step 3: Implement staged upload and Asset persistence**

Extend internal `Asset`; keep the public `AssetModel` unchanged. Replace whole-file reads with 1 MiB reads into a private temporary path, preflight that path, call the configured store, and perform a compensating provider delete if source creation or command submission fails.

- [ ] **Step 4: Write and pass worker materialization tests**

Test that `process_source_command` materializes a remote ref, gives only the temporary `file_path` to `source_graph`, removes the temporary file afterward, and `save_source` preserves the stored provider/key rather than persisting the temporary path. Keep the old direct `file_path` path for legacy assets.

- [ ] **Step 5: Write and pass retry/download tests**

Retry must materialize and preflight the stored ref before queueing. HEAD/GET must check existence through the recorded provider, and GET must stream exact bytes with the preserved original filename. Existing ACL checks remain unchanged.

- [ ] **Step 6: Update intentional characterization expectations**

Keep legacy filesystem-path characterization intact; add a separate expectation for provider-backed content state rather than deleting the historical test.

- [ ] **Step 7: Verify integration slice**

Run: `uv run pytest tests/test_source_storage_integration.py tests/characterization/test_source_ingestion_characterization.py tests/test_source_path_containment.py tests/test_sources_api.py -q`

- [ ] **Step 8: Commit**

Commit message: `refactor(storage): route source originals through providers`

---

### Task 4: Retention, source deletion, configuration, and operator docs

**Files:**
- Modify: `api/source_file_service.py`
- Modify: `open_notebook/domain/notebook.py`
- Modify: `docs/7-DEVELOPMENT/architecture.md`
- Create: `docs/ORIGINAL_FILE_STORAGE.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Test: `tests/test_source_file_cleanup.py`
- Test: `tests/test_source_storage_deletion.py`

**Interfaces:**
- Consumes: `reference_from_asset`, store `exists/delete`.
- Produces: one deletion path shared by retention cleanup, explicit original deletion, and full Source deletion.

- [ ] **Step 1: Write failing deletion-boundary tests**

Cover provider-backed explicit deletion, retention deletion after successful processing, repeated deletion, provider failure retaining `delete_pending` metadata, and full Source deletion. Assert no test invokes `Path.unlink` for a provider-backed Asset and no external connector item ID is sent to Graph delete.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_source_file_cleanup.py tests/test_source_storage_deletion.py -q`

- [ ] **Step 3: Generalize the existing two-phase deletion helper**

Route `Source.delete()` through the same helper before database removal. Legacy unsafe/outside-root paths remain refused. On provider error keep the source and deletion-start marker so retry is possible.

- [ ] **Step 4: Document exact configuration and ownership semantics**

Document filesystem and SharePoint Embedded setup, `FileStorageContainer.Selected`, pre-provisioned container requirement, the 100 MiB/250 MiB threshold rationale, recycle-bin semantics, backup, and the distinction from the inbound SharePoint connector.

- [ ] **Step 5: Verify task and storage regression suite**

Run: `uv run pytest tests/test_original_file_store.py tests/test_sharepoint_embedded_store.py tests/test_source_storage_integration.py tests/test_source_file_cleanup.py tests/test_source_storage_deletion.py tests/test_source_path_containment.py -q`

Run: `ruff check open_notebook/storage api/source_file_service.py api/routers/sources.py api/routers/source_files.py commands/source_commands.py open_notebook/domain/notebook.py open_notebook/graphs/source.py tests/test_original_file_store.py tests/test_sharepoint_embedded_store.py tests/test_source_storage_integration.py tests/test_source_storage_deletion.py`

- [ ] **Step 6: Commit**

Commit message: `docs(storage): document configurable original storage`
