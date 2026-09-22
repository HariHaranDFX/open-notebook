# WP5 SharePoint connector implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a delegated, per-user SharePoint connector that browses and bulk-imports external documents through the existing source pipeline.

**Architecture:** Connector OAuth, Graph browsing, and batch state live in connector-only modules and tables. The bulk command downloads external bytes, passes the managed copy to `OriginalFileStore`, and queues the unchanged source-processing command; it never mutates the external document.

**Tech Stack:** Python 3.12, FastAPI, httpx, SurrealDB migrations, surreal-commands, Next.js/React Query, React Hook Form, Vitest, Microsoft Graph v1.0.

**Spec:** `docs/superpowers/specs/2026-09-22-wp5-sharepoint-connector-design.md`

## Global Constraints

- The original-file storage provider plan must be complete first.
- Apply ponytail full mode and karpathy-guidelines; use existing httpx/encryption/PKCE utilities and no new dependency.
- Connector Graph calls are delegated; storage and group-sync Graph calls remain app-only and separate.
- Connector code has no Graph write/delete operation for external drive items.
- Every record and endpoint is scoped to the authenticated owner and existing notebook ACL rules.
- Tokens, storage keys, physical paths, and raw Graph bodies are never serialized or logged.

---

### Task 1: Per-user connection persistence and delegated OAuth

**Files:**
- Create: `open_notebook/database/migrations/32.surrealql`
- Create: `open_notebook/database/migrations/32_down.surrealql`
- Modify: `open_notebook/database/async_migrate.py`
- Create: `open_notebook/connectors/__init__.py`
- Create: `open_notebook/connectors/models.py`
- Create: `open_notebook/connectors/sharepoint_auth.py`
- Create: `api/routers/connectors.py`
- Modify: `api/routers/__init__.py`
- Modify: `api/main.py`
- Test: `tests/test_sharepoint_connector_auth.py`
- Test: `tests/test_migration_32_connectors.py`

**Interfaces:**
- Produces: owner-scoped `ConnectorConnection`, `ConnectorOAuthState`, `ConnectorBatch`, and `ConnectorBatchDocument` models/tables.
- Produces: `acquire_delegated_token(user_id: str) -> str`.
- Produces: `GET /api/connectors/sharepoint/status`, `POST /connectors/sharepoint/connect`, and `GET /connectors/sharepoint/callback`.

- [ ] **Step 1: Write failing migration and encryption tests**

Assert migration 32 creates the four schemafull tables and ownership indexes. Connect a user through a mocked OAuth callback and assert the plaintext refresh token is absent from repository parameters after encryption, API responses, and logs. Assert missing encryption configuration fails with 422 rather than storing a token.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_migration_32_connectors.py tests/test_sharepoint_connector_auth.py -q`

- [ ] **Step 3: Implement state-bound PKCE and connection persistence**

Reuse the existing PKCE and encryption helpers. OAuth state stores a SHA-256 state hash, current user record, encrypted verifier, and ten-minute expiry; callback consumes it once and requires the current session user to match. Request exactly `openid profile offline_access Sites.Read.All` through the existing Entra client with `SHAREPOINT_CONNECTOR_REDIRECT_URI`.

- [ ] **Step 4: Implement refresh rotation/revocation tests and code**

Mock a refresh response that rotates the token and assert the encrypted value changes. Mock `invalid_grant` and assert the connection becomes disconnected and the route returns an actionable 401 without the upstream body.

- [ ] **Step 5: Verify GREEN**

Run: `uv run pytest tests/test_migration_32_connectors.py tests/test_sharepoint_connector_auth.py -q`

- [ ] **Step 6: Commit**

Commit message: `feat(connectors): add delegated SharePoint connection`

---

### Task 2: SharePoint browsing API

**Files:**
- Create: `open_notebook/connectors/base.py`
- Create: `open_notebook/connectors/sharepoint.py`
- Modify: `api/routers/connectors.py`
- Test: `tests/test_sharepoint_connector_browse.py`

**Interfaces:**
- Produces: `SourceConnector` protocol with `list_sites`, `list_drives`, `list_children`, `iter_documents`, and `download`.
- Produces: owner-scoped sites, drives, and children endpoints returning normalized IDs/names/kinds/support flags.

- [ ] **Step 1: Write a failing connector contract/paging test**

With `httpx.MockTransport`, assert `SharePointConnector` sends the delegated bearer token, maps Graph sites/drives/items to normalized models, follows `@odata.nextLink`, rejects a next link outside HTTPS `graph.microsoft.com`, and never imports/calls `api.graph_client.acquire_graph_token`.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_sharepoint_connector_browse.py -q`

- [ ] **Step 3: Implement the minimal read-only connector**

Use URL-encoded path segments and these Graph reads only:

```text
GET /sites?search={query}
GET /sites/{site_id}/drives
GET /drives/{drive_id}/root/children
GET /drives/{drive_id}/items/{item_id}/children
GET /drives/{drive_id}/items/{item_id}/content
```

Mark folders as browsable and files as importable only after existing extension/support checks. Cap each logical listing at 1,000 items and reject pagination cycles.

- [ ] **Step 4: Add route ownership/error tests and implementation**

Disconnected users receive 409; revoked consent receives 401; throttling receives 429; safe upstream errors receive 502. No endpoint accepts a connection/user ID from the browser.

- [ ] **Step 5: Verify GREEN**

Run: `uv run pytest tests/test_sharepoint_connector_browse.py tests/test_sharepoint_connector_auth.py -q`

- [ ] **Step 6: Commit**

Commit message: `feat(connectors): browse SharePoint documents`

---

### Task 3: Durable bulk import and existing source pipeline

**Files:**
- Create: `api/source_ingestion_service.py`
- Create: `commands/connector_commands.py`
- Modify: `commands/__init__.py`
- Modify: `api/routers/sources.py`
- Modify: `api/routers/connectors.py`
- Modify: `open_notebook/connectors/models.py`
- Test: `tests/test_sharepoint_connector_import.py`

**Interfaces:**
- Produces: `queue_managed_upload_source(...) -> QueuedSource` reused by multipart upload and connector import.
- Produces: `POST /api/connectors/sharepoint/import` returning a batch ID.
- Produces: `GET /api/connectors/sharepoint/batches/{batch_id}` returning aggregate and per-document status.
- Produces command: `open_notebook.import_sharepoint_batch`.

- [ ] **Step 1: Write a failing one-file vertical-slice test**

For an authenticated owner with an editable notebook and mocked Graph bytes, post one import. Execute the bulk command and assert it creates one owner-scoped Source, one correct source-to-notebook `reference` edge, one managed storage copy, and one existing `process_source` command payload.

- [ ] **Step 2: Verify RED**

Run: `uv run pytest tests/test_sharepoint_connector_import.py::test_import_one_file_queues_existing_source_pipeline -q`

- [ ] **Step 3: Extract and reuse the managed-upload ingestion service**

Move only source-record creation, notebook linking, and `process_source` submission out of the router. Keep request parsing/HTTP mapping in routes. The service accepts an already stored `StoredOriginal`, original filename, user, notebook IDs, transformations, embed flag, and retention action; it never knows SharePoint connector credentials.

- [ ] **Step 4: Implement batch creation and command**

The route verifies every target notebook with `assert_can_edit_notebook_or_403`, persists the owner-scoped batch, and submits the parent command. The command acquires one delegated token, enumerates selected files/folder descendants, stages downloads with the configured upload cap, calls `OriginalFileStore`, then calls the ingestion service.

- [ ] **Step 5: Write and pass partial-failure/idempotency tests**

Import two documents where one is unsupported or fails download. Assert the other queues, the batch is `partial`, per-document errors are safe, retries do not duplicate a batch/item/source, and a user cannot read another user's batch. Assert deleting the imported Source performs no connector Graph DELETE.

- [ ] **Step 6: Verify backend slice**

Run: `uv run pytest tests/test_sharepoint_connector_import.py tests/test_sharepoint_connector_browse.py tests/test_sharepoint_connector_auth.py tests/characterization/test_source_ingestion_characterization.py -q`

- [ ] **Step 7: Commit**

Commit message: `feat(connectors): import SharePoint batches`

---

### Task 4: Add Source SharePoint UX

**Files:**
- Create: `frontend/src/lib/api/sharepoint.ts`
- Create: `frontend/src/lib/hooks/use-sharepoint.ts`
- Create: `frontend/src/components/sources/steps/SharePointStep.tsx`
- Create: `frontend/src/components/sources/steps/SharePointStep.test.tsx`
- Modify: `frontend/src/components/sources/AddSourceDialog.tsx`
- Modify: `frontend/src/components/sources/AddSourceDialog.test.tsx`
- Modify: `frontend/src/components/sources/steps/SourceTypeStep.tsx`
- Modify: `frontend/src/components/sources/steps/SourceTypeStep.test.tsx`
- Modify: `frontend/src/lib/types/api.ts`
- Modify: all `frontend/src/lib/locales/*/index.ts`
- Modify: `frontend/src/lib/locales/index.test.ts`

**Interfaces:**
- Consumes: connector status/browse/import/batch endpoints from Tasks 1–3.
- Produces: separate SharePoint add-source flow with connect, browse, select, and progress states.

- [ ] **Step 1: Write a failing source-type test**

Assert the Add Source UI offers SharePoint separately from link/upload/text and selecting it renders a connector-status state without changing the existing upload fields.

- [ ] **Step 2: Verify RED**

Run from `frontend`: `npm test -- SourceTypeStep.test.tsx SharePointStep.test.tsx AddSourceDialog.test.tsx`

- [ ] **Step 3: Add typed API/hooks and connection/browse UI**

Use only `apiClient` and TanStack Query. Implement unavailable, connect/reconnect, site, drive, breadcrumb folder navigation, supported-file selection, and select-all states. Native buttons/checkboxes must remain keyboard accessible and labelled.

- [ ] **Step 4: Write and pass import/progress tests**

Assert single and multi-selection request bodies preserve selected notebook IDs. Poll the batch until `completed`, `partial`, or `failed`; show per-document state and safe errors; invalidate broad source and selected-notebook queries on terminal status.

- [ ] **Step 5: Add locale-parity keys**

Add the same connector keys to every locale file, preserving interpolation placeholders. Run the locale parity/unused-key test.

- [ ] **Step 6: Verify frontend slice**

Run from `frontend`: `npm test -- SourceTypeStep.test.tsx SharePointStep.test.tsx AddSourceDialog.test.tsx src/lib/locales/index.test.ts`

Run from `frontend`: `npm run lint`

- [ ] **Step 7: Commit**

Commit message: `feat(frontend): add SharePoint source import flow`

---

### Task 5: Connector documentation and complete verification

**Files:**
- Create: `docs/CONNECTORS.md`
- Modify: `.env.example`
- Modify: `docs/7-DEVELOPMENT/architecture.md`
- Modify: `docs/superpowers/plans/STATUS.md`

- [ ] **Step 1: Document deployment and extension contract**

Document delegated Entra scopes/consent, connector callback URI, encryption-key requirement, connect/disconnect/re-consent behaviour, one-shot import ownership, external deletion semantics, batch troubleshooting, and the exact `SourceConnector` methods needed for a future connector. Link separately to `docs/ORIGINAL_FILE_STORAGE.md` and state that credentials are not shared.

- [ ] **Step 2: Run backend verification**

Run: `uv run pytest tests/`

Run: `ruff check .`

Run: `uv run python -m mypy .`

Run: `uv run python scripts/check_licenses.py`

- [ ] **Step 3: Run frontend verification**

Run from `frontend`: `npm test`

Run from `frontend`: `npm run lint`

Run from `frontend`: `npm run build`

- [ ] **Step 4: Record verified status and commit**

Update `docs/superpowers/plans/STATUS.md` with exact passing totals and commit as `docs(connectors): document SharePoint setup`.
