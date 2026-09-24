# WP5 Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing inbound SharePoint connector and managed original-file storage safe to release, with local builds and `datafabricx/open-notebook-commercial` deployment images.

**Architecture:** Connector authorization remains delegated and per user; the connector copies external documents into Sources without modifying SharePoint. Original-file storage remains a separate app-owned service using filesystem or SharePoint Embedded. Compose and release workflows select our image, never upstream's.

**Tech Stack:** Python 3.12, FastAPI, SurrealDB, MSAL Python, httpx, Next.js, React Query, Docker Compose, pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-wp5-sharepoint-connector-design.md` and `docs/superpowers/specs/2026-09-22-original-file-storage-providers-design.md`, amended by the user-approved release requirements of 2026-09-24.

**Continuation:** Tasks 1–2 are committed and checked below. For concrete file contracts, test cases, commands, sequencing, and release stop conditions for Tasks 3–7, read [the remaining-tasks implementation handoff](2026-09-24-wp5-remaining-implementation-handoff.md) before making changes. That document is part of this plan, not an optional follow-up.

## Global Constraints

- Apply Ponytail full and Karpathy guidelines: minimal changes, explicit assumptions, testable outcomes.
- The connector cannot use storage app credentials or call Graph delete on external items.
- SharePoint Embedded cannot use delegated connector credentials.
- Preserve existing Source and notebook access semantics and legacy filesystem references.
- Never commit `.env`, private keys, tokens, or real tenant identifiers.
- Never add GPL/AGPL dependencies; run `scripts/check_licenses.py` after adding MSAL.
- Keep the branch isolated; do not merge, publish an image, or delete the branch without explicit user approval.

## Review Focus

1. A second user requests another user's connection or batch: respond without data leakage.
2. A folder contains more than the import limit: report a limit error, never silently finish a partial enumeration.
3. Consent is revoked while a worker is importing: terminate safely and require reauthorization without losing completed documents.
4. Storage succeeds but database/queue fails: leave a durable recovery record or clean up the orphan.
5. Storage default, container, or credential profile changes: existing objects still resolve through their recorded profile.

---

### Task 1: Durable MSAL authorization and explicit lifecycle

**Files:** `open_notebook/connectors/sharepoint_auth.py`, `open_notebook/connectors/models.py`, `open_notebook/database/migrations/33.surrealql`, `open_notebook/database/async_migrate.py`, `api/routers/connectors.py`, `pyproject.toml`, `tests/test_sharepoint_connector_auth.py`, `docs/CONNECTORS.md`.

**Interfaces:** Preserve `begin_connection(user_id)`, `complete_connection(...)`, `acquire_delegated_token(user_id)`, `get_connection(user_id)`; add `disconnect_connection(user_id)` and `reauth_required` status. The encrypted per-owner MSAL cache replaces the raw refresh-token field; old branch-only test connections require reconnection.

- [x] Write tests for persistent silent acquisition, owner isolation, concurrent cache writes, logout-independent worker access, revoked consent, and idempotent disconnect; run each to RED.
- [x] Add the migration and minimal MSAL cache serialization/CAS update. Keep PKCE, single-use state, and HTTPS consent. Run focused tests to GREEN.
- [x] Add owner-only disconnect API and status mapping. Run auth and migration tests and license check. A fresh complete backend suite is deferred to Task 7 after the reviewed transport fix.

### Task 2: Safe and complete Graph imports

**Files:** `open_notebook/connectors/sharepoint.py`, `open_notebook/connectors/models.py`, a new additive migration if needed, `commands/connector_commands.py`, `api/routers/connectors.py`, `tests/test_sharepoint_connector_browse.py`, `tests/test_sharepoint_connector_import.py`, `docs/CONNECTORS.md`.

**Interfaces:** Keep the existing `SourceConnector` read contract and `import_sharepoint_batch` command. Add owner-scoped retry endpoint and persisted external-version identity `(connection, drive, item, eTag)`.

- [x] Write failing tests for >1,000 items, a rejected over-limit batch, `Retry-After`, fallback backoff, redirect host safety, cross-batch same-version reuse, changed-version snapshot, and retrying failed items only.
- [x] Replace silent truncation with complete pagination to the explicit limit and safe failure beyond it. Implement bounded retries and no-token redirects. Run browse tests to GREEN.
- [x] Persist stable version identity and idempotent reuse; add batch retry/status behavior. Import, concurrency, cancellation, and ownership tests are GREEN. A fresh complete backend suite and live SurrealDB/worker checks are deferred to Task 7.

### Task 3: Provider identity, immutable references, and safe deletion

**Files:** `open_notebook/storage/original_files.py`, `open_notebook/storage/sharepoint_embedded.py`, `open_notebook/domain/notebook.py`, `api/source_file_service.py`, additive migration if needed, `tests/test_original_file_store.py`, `tests/test_source_storage_deletion.py`, `tests/test_sharepoint_embedded_store.py`, `docs/ORIGINAL_FILE_STORAGE.md`.

**Interfaces:** Every managed Asset retains provider and immutable profile/container identity. Production SharePoint Embedded authentication accepts a certificate; client secret remains a documented local/test option. `delete(ref)` must use the recorded eTag where available.

- [x] Write failing tests for certificate authentication, old-profile reads after default change, 404 idempotency, and 412 eTag conflict preserving the reference.
- [x] Implement minimal profile lookup and credential validation without connector imports. Add conditional delete and actionable status. Run storage/deletion tests to GREEN, then full backend suite.

### Task 4: Resumable uploads and recovery

**Files:** `open_notebook/storage/sharepoint_embedded.py`, `api/source_ingestion_service.py`, `api/source_file_service.py`, worker command/reconciliation module and migration as required, `tests/test_sharepoint_embedded_store.py`, `tests/test_source_storage_integration.py`.

**Interfaces:** Simple PUT is limited to small uploads; larger allowed uploads use Graph upload sessions and sequential bounded chunks. Failed store/database/queue operations have one durable recovery path; temporary files always clean up.

- [ ] Write failing tests for interrupted upload-session resume, `nextExpectedRanges`, preauthorized URL without Graph token, retry limits, database failure after store, queue failure, and orphan reconciliation.
- [ ] Implement the smallest session uploader and recovery record/worker path satisfying those tests. Run focused tests to GREEN, then full backend suite.

### Task 5: Existing-theme connector UI

**Files:** `frontend/src/components/sources/steps/SharePointStep.tsx`, `frontend/src/components/sources/AddSourceDialog.tsx`, `frontend/src/lib/api/sharepoint.ts`, `frontend/src/lib/hooks/use-sharepoint.ts`, `frontend/src/lib/locales/*/index.ts`, relevant Vitest files.

**Interfaces:** Add Connect/Reconnect/Disconnect, resumable batch progress, failed-item retry, explicit over-limit message. Reuse Sheet, Button, semantic theme tokens, and notebook selection.

- [ ] Write failing component tests for authorization states, retry/resume, error recovery, and locale parity.
- [ ] Implement minimal UI/API hooks and translations; run focused Vitest to GREEN, then full frontend tests, TypeScript, lint, and build.
- [ ] Verify light/dark, keyboard, and narrow-screen behavior in a live browser.

### Task 6: Local and Docker Hub packaging with env parity

**Files:** `docker-compose.yml`, `examples/docker-compose-dev.yml`, `examples/docker-compose-single.yml`, `examples/docker-compose-ollama.yml`, `examples/docker-compose-speaches.yml`, `examples/docker-compose-full-local.yml`, `Makefile`, `.env.example`, ignored branch `.env`, `.github/workflows/build-dev.yml`, `.github/workflows/build-and-release.yml`, release-test scripts, installation docs.

**Interfaces:** Local Compose builds this checkout. Pull-based Compose requires `datafabricx/open-notebook-commercial` with an immutable tag. `.env` supplies connector, storage, encryption, and image configuration; no active deployment points at `lfnovo/open_notebook`.

- [ ] Add configuration checks that fail with upstream image, missing encryption key, absent connector callback, or unconfigured selected storage provider.
- [ ] Update Compose/Makefile/workflows/docs minimally; preserve existing secret values and add missing optional `.env.example` key names to ignored `.env` as commented entries.
- [ ] Run `docker compose config --quiet` for each supported variant, local image build/start, and image-name checks without printing secrets. Do not push an image without separate approval.

### Task 7: Release verification and handoff

**Files:** `docs/superpowers/plans/STATUS.md`, connector and storage operator docs, test evidence in this branch.

- [ ] Run all backend/frontend suites, Ruff, MyPy, TypeScript, lint, build, and license guard; record exact results.
- [ ] Run live development-tenant matrix: two users, consent/revocation, browse/import/chat, >limit and throttling, filesystem and Embedded upload/download/retention/recovery, local Compose and our immutable pulled image.
- [ ] Obtain independent whole-branch review and fix important findings with RED→GREEN tests.
- [ ] Give the user the branch test steps and wait for their sign-off. Do not merge or remove the branch.
