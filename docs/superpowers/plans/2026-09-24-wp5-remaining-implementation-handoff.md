# WP5 Remaining Release Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the separately bounded original-file storage, connector UI, deployment packaging, and release verification for the existing WP5 SharePoint connector.

**Architecture:** The connector uses an owner's delegated Graph read token to copy external files into reusable Sources. The original-file store uses an independent app-only identity for Open Notebook-owned copies. A Source's persisted storage reference, not the current storage default, determines where its original is read or deleted.

**Tech Stack:** Python 3.12, FastAPI, SurrealDB v2, MSAL Python 1.39, httpx, Next.js, React Query, Docker Compose, pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-wp5-sharepoint-connector-design.md`, `docs/superpowers/specs/2026-09-22-original-file-storage-providers-design.md`, and the approved tracker `docs/superpowers/plans/2026-09-24-wp5-release-hardening.md`.

## Start here

1. Work only in `C:\Users\haribabu.DATAFABRICX\.codex\worktrees\wp5-sharepoint\open-notebook-commercial` on `codex/wp5-sharepoint`. At handoff creation HEAD is `8de8f6d`. Verify `git branch --show-current`, `git status --short`, and HEAD before changes. The worktree's untracked `.remember/` is a handoff note, not code; do not commit it.
2. Tasks 1 and 2 are done and checked in the tracker. They added migrations 33 and 34, so the next additive migration is 35. Their final focused backend run was 84 passed, 2 existing dependency warnings; Ruff, MyPy (232 files), and license checks passed. This is **not** a full-branch or live-tenant pass.
3. Read root `AGENTS.md` and `open_notebook/AGENTS.md` for backend tasks or `frontend/AGENTS.md` for Task 5. Use Ponytail full, Karpathy, TDD, and verification-before-completion. Run each task's focused RED test before implementation and GREEN after; commit each accepted task separately. Do not edit unrelated changes or undo the connector's claim/transaction logic in `api/source_ingestion_service.py`.
4. The old storage spec says a single PUT is sufficient up to 100 MiB. The user-approved release requirements **supersede it**: certificate app auth, immutable profile/container references, conditional delete, upload sessions above 10 MiB, and durable reconciliation are release requirements, not optional documentation follow-ups. Amend that spec in Task 3 before coding.
5. No merge, branch removal, image push, or broad legacy-token cleanup is authorized. Keep `.env` ignored and preserve its existing values. The user will roll out `main`'s `.env` only after an approved merge.

## Component map and ownership

| Task | Boundary and implementation files | Test and documentation files |
| --- | --- | --- |
| 3 | `open_notebook/storage/original_files.py`, `sharepoint_embedded.py`, `open_notebook/domain/notebook.py`, `api/source_file_service.py`; update `api/source_ingestion_service.py`, `api/routers/sources.py`, and `commands/source_commands.py` only where the persisted reference must be propagated | `tests/test_original_file_store.py`, `test_sharepoint_embedded_store.py`, `test_source_storage_deletion.py`, `docs/ORIGINAL_FILE_STORAGE.md`, storage spec |
| 4 | `open_notebook/storage/sharepoint_embedded.py`, source ingestion/deletion services, one small reconciliation command and migration 35 for the recovery record | `tests/test_sharepoint_embedded_store.py`, `test_source_storage_integration.py`, storage docs |
| 5 | `frontend/src/components/sources/steps/SharePointStep.tsx`, `AddSourceDialog.tsx`, `frontend/src/lib/api/sharepoint.ts`, `hooks/use-sharepoint.ts`, `types/api.ts`; one owner-scoped recent-batches API route in `api/routers/connectors.py` | SharePoint component/API tests, connector API tests, all 16 `frontend/src/lib/locales/*/index.ts`, connector docs |
| 6 | root and active example Compose files, `examples/easypanel/meta.yaml`, `Makefile`, `.env.example`, ignored branch `.env`, active image workflows/release-test scripts | Compose/config checks, `docs/1-INSTALLATION/` and relevant operator docs |
| 7 | No feature code unless a test or review finds a defect; evidence and operator instructions belong in `docs/superpowers/plans/STATUS.md` and existing connector/storage docs | full automated runs, local stack, live tenant/registry matrix, independent whole-branch review |

## Task 3 — Storage identity, credentials, and conditional deletion

**Contract to produce:** Append optional `profile_id` and `container_id` to `StoredOriginal` and `OriginalFileRef` without changing any existing positional fields. Add `Asset.original_file_profile_id` and `Asset.original_file_container_id`; `reference_from_asset()` copies them. Extend `get_original_file_store(provider=None, profile_id=None)` and route **every** read, retry, HEAD, download, cleanup, and delete through the recorded profile. The `source.asset` field is already `FLEXIBLE` in migration 1; confirm no migration is needed for these two nested fields before adding one.

**Profile configuration decision:** Keep existing single-profile `SHAREPOINT_STORAGE_*` variables as fixed profile `default` for compatibility. Add `SHAREPOINT_STORAGE_PROFILE_ID` (default `default`) and optional `SHAREPOINT_STORAGE_PROFILES_FILE`, a JSON object keyed by immutable profile ID. Each named profile records `tenant_id`, `client_id`, and `container_id`, plus either `certificate_pfx_path` and `certificate_passphrase_env`, or `client_secret_env` for local/test. The file contains env-var *names*, not inline key material. Production uses an MSAL confidential client with a mounted PFX certificate; legacy client-secret auth remains for local/test. `SHAREPOINT_STORAGE_CERTIFICATE_PFX_PATH` and optional `SHAREPOINT_STORAGE_CERTIFICATE_PASSPHRASE` provide the default profile's certificate path. A pre-release SPE Asset with no profile resolves **only** the fixed legacy `default`, never the new active selector; keep that legacy configuration until such Assets are retired or explicitly backfilled. Never fall back to the current default when a recorded profile is missing; raise a safe configuration error. If the configured container differs from the Asset's recorded container, fail closed rather than read/delete in a different container. Retain old named profiles for old Assets when rotating the default.

```json
{
  "spe-2026": {
    "tenant_id": "tenant-guid",
    "client_id": "app-guid",
    "container_id": "container-id",
    "certificate_pfx_path": "/run/secrets/spe-2026.pfx",
    "certificate_passphrase_env": "SPE_2026_PFX_PASSPHRASE"
  }
}
```

- [x] **Step 1: Update the storage spec and write RED tests.** Pin certificate token acquisition, old-profile read after changing the default, missing-profile/container mismatch, legacy filesystem lookup, 404 delete, and 412 delete without reference clearing. Use the existing mocked `httpx.AsyncClient` pattern. The tests must assert no connector `ENTRA_*` credential is read by storage.

```python
old_ref = reference_from_asset(asset_saved_with_profile_a)
monkeypatch.setenv("SHAREPOINT_STORAGE_PROFILE_ID", "profile-b")
assert await get_original_file_store(old_ref.provider, old_ref.profile_id).exists(old_ref)
assert old_ref.container_id == "container-a"
```

- [x] **Step 2: Run the new tests to RED, then implement only the contract above.** Prefer installed MSAL's `ConfidentialClientApplication.acquire_token_for_client` for PFX app auth; do not add another OAuth dependency. Keep file/profile parsing server-side and errors free of certificate paths or token bodies. Update each `get_original_file_store(ref.provider)` callsite found by `rg` to pass the recorded profile. Store the profile/container fields when creating an Asset for ordinary upload **and** connector-managed copy.
- [x] **Step 3: Use the Asset's saved eTag as Graph `If-Match` on DELETE.** A 404 is idempotent success. A 412 raises a typed conflict and leaves `original_file_store`, key, profile, container, and eTag intact for recovery; never delete the external connector document. Assert the header and reference-preservation in tests.
- [x] **Step 4: Run focused and static checks, review, commit.**

```text
uv run pytest -q tests/test_original_file_store.py tests/test_sharepoint_embedded_store.py tests/test_source_storage_deletion.py tests/test_source_storage_integration.py
uv run ruff check open_notebook/storage api/source_file_service.py api/source_ingestion_service.py commands/source_commands.py
uv run python -m mypy .
uv run python scripts/check_licenses.py
```

**Acceptance:** Existing filesystem and old-profile originals still read; new originals record immutable provider/profile/container; a missing old profile fails visibly; certificate credentials work without delegated connector secrets; stale eTag cannot clear an Asset. Do not claim production certificate success until a real tenant run in Task 7.

## Task 4 — Upload sessions and durable recovery

**Contract to produce:** Keep the 100 MiB request cap unless the operator explicitly changes it. Use simple Graph PUT only through 10 MiB; larger allowed uploads use `createUploadSession` and sequential chunks of a multiple of 320 KiB (5 MiB is a suitable default). Treat the returned upload URL as preauthorized: validate HTTPS/allowed Microsoft host, never send the Graph bearer token to it, and follow `nextExpectedRanges` after 202 or interrupted transport. Bound 429/5xx attempts and `Retry-After`; stop safely on expired sessions and non-retryable 4xx.

**Recovery decision:** Add one `original_upload_operation` record before storage starts, with a stable operation ID/object name, owner, provider/profile/container, target Source ID, status, timestamps, and stored key/eTag when known. The deterministic object name must let reconciliation locate an object even if the process dies after the remote commit but before its item ID is saved. Reconcile after a grace period: if a Source references the object, retain it; if the Source exists but `process_source` is not queued, queue once; if no Source references the object, delete only that managed copy through its recorded provider. Connector imports already have their own claim/transaction; preserve that path and integrate recovery without weakening its fencing. An interrupted upload session may be resumed from its server-reported range while it remains valid.

- [ ] **Step 1: Write RED storage tests** for a 10 MiB boundary, an 11 MiB session, aligned `Content-Range`, a 202 `nextExpectedRanges` response, interrupted resume, throttling/exhaustion, expired session, unsafe upload URL, and absence of `Authorization` on the session URL.

```python
assert upload_request.headers["content-range"] == "bytes 0-5242879/11534336"
assert "authorization" not in upload_request.headers
assert resumed_start == server_next_expected_start
```

- [ ] **Step 2: Implement the smallest session uploader in `sharepoint_embedded.py`; run those tests GREEN.** Stream staged file chunks, do not read the entire upload into memory. Close responses and temporary files on every exit path.
- [ ] **Step 3: Write RED recovery tests** for database failure after remote save, queue failure after Source save, crash/restart before item ID is recorded, two runs of reconciliation, and another Source referencing the same object. Implement the operation record and one idempotent reconciliation command; add migration 35/up+down for `original_upload_operation` and register it in `AsyncMigrationManager`.
- [ ] **Step 4: Run focused integration/static checks, review, commit.**

```text
uv run pytest -q tests/test_sharepoint_embedded_store.py tests/test_source_storage_integration.py tests/test_source_storage_deletion.py tests/test_sharepoint_connector_import.py
uv run ruff check open_notebook/storage api/source_ingestion_service.py api/source_file_service.py commands
uv run python -m mypy .
uv run python scripts/check_licenses.py
```

**Acceptance:** Large uploads finish/resume without token leakage; a stored object cannot be silently orphaned by database/queue failure; reconciliation never deletes a referenced original; worker retries remain idempotent. A real SharePoint Embedded upload/restart test remains a Task 7 gate.

## Task 5 — Connector UI in the existing theme

**Backend/UI contract to consume:** `/status` already returns `available`, `connected`, and `status` (`connected`, `reauth_required`, `disconnected`) but the frontend type lacks `status`. `/disconnect` and `/batches/{id}/retry` exist but the frontend API/hooks do not use them. A page refresh loses the dialog's in-memory `sharePointBatchId`, so add `GET /connectors/sharepoint/batches?limit=20` returning only the current owner's recent batches, then let the UI reopen/resume a selected in-progress or partial batch. Do not put access tokens or storage settings in browser state. Batch IDs may be in URL/state only if owner checks remain enforced.

- [ ] **Step 1: Write RED API and component tests.** Verify owner A cannot list owner B's batch; unavailable/connected/reauth-required/disconnected render distinct actions; Disconnect confirms before mutation; failed-item retry calls the owner endpoint; a remount/page refresh reloads an active batch from the owner-scoped list; 1,000-item folder error is shown explicitly; file/folder and zero/multiple editable-notebook selections still work.

```tsx
expect(screen.getByRole('button', { name: /reconnect/i })).toBeVisible()
expect(screen.getByRole('button', { name: /retry failed/i })).toBeEnabled()
expect(screen.getByRole('status')).toHaveTextContent('1,000')
```

- [ ] **Step 2: Add the thin owner-scoped batches route and API/hooks.** Update `SharePointStatus` with its status literal, add `disconnect`, `retryBatch`, and `recentBatches` methods, and invalidate `SHAREPOINT_QUERY_KEYS.status`, batch, Sources, and selected notebook queries after mutations. Keep polling only while a batch is non-terminal.
- [ ] **Step 3: Update only the existing Add Source wizard and SharePoint step.** Reuse `Sheet`, `Button`, `Input`, Lucide icons, and semantic theme tokens. Show per-document safe errors and progress, with no second connector page. Add translation keys to **all 16** locale directories (the frontend AGENTS.md count of 14 is stale); run locale parity. Keep keyboard focus, dark mode, and narrow layout usable.
- [ ] **Step 4: Run tests/static/build and browser checks, review, commit.**

```text
uv run pytest -q tests/test_sharepoint_connector_auth.py tests/test_sharepoint_connector_import.py
cd frontend
npm run test -- src/components/sources/steps/SharePointStep.test.tsx src/components/sources/AddSourceDialog.test.tsx src/lib/locales/index.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

**Acceptance:** A user can connect/reconnect/disconnect, browse and import, revisit progress after refresh, see an actionable limit/error, and retry only failed items. The UI uses the current design language in light/dark and never exposes connector/storage secrets. If Windows Turbopack fails on this worktree's external `node_modules` junction, record that failure and run the project's documented webpack fallback; do not call the default build passed unless it did.

## Task 6 — Local Compose, our registry, and env parity

**Packaging decision:** Add a root `docker-compose.local.yml` that builds this checkout with `image: datafabricx/open-notebook-commercial:local` and no pull. Make root `docker-compose.yml` the pull deployment with required `OPEN_NOTEBOOK_IMAGE_REF` set to `datafabricx/open-notebook-commercial@sha256:<digest>` for release-candidate verification (a digest is immutable; a mutable `v1-latest` tag is not). Build-only example files use `context: ..` from `examples/` and the branch's `.env`; pull-based examples use the same required image ref. Do not invent a GHCR namespace: remove/disable active `ghcr.io/lfnovo/...` publication until the owner supplies one. Keep historical upstream credit and source links as attribution, but no active service image, release destination, or installation command may pull `lfnovo`.

- [ ] **Step 1: Add RED configuration checks** for root deployment with missing image digest/encryption key, local build context, connector callback missing in Entra connector mode, selected SPE provider missing its profile/certificate/container, and forbidden active upstream image refs. The checks must not print `.env` values.
- [ ] **Step 2: Change root/local/example Compose, `examples/easypanel/meta.yaml`, `Makefile`, both image workflows, `scripts/release-test/`, and active install docs.** Pass connector `ENTRA_*` and `SHAREPOINT_CONNECTOR_REDIRECT_URI` separately from `SHAREPOINT_STORAGE_*`; the callback example must use the public frontend origin (`http://localhost:3000/api/connectors/sharepoint/callback` locally), not API port 5055. Root Compose must use `${OPEN_NOTEBOOK_ENCRYPTION_KEY:?set encryption key}` instead of its hardcoded sample. Document separate local build and digest-pinned pull commands. Keep explicit image-push targets available only for later operator-approved use; do not run them.
- [ ] **Step 3: Update `.env.example` and the ignored branch `.env` without exposing values.** Add all new profile/certificate/image variables as commented examples. Compare key **names**, including commented keys, and add missing optional `.env.example` names to `.env` as comments; preserve every existing active value. Never stage or commit `.env`, a certificate, profiles file with secrets, or the untracked `.remember/`.
- [ ] **Step 4: GREEN configuration/build checks, review, commit.** Use `docker compose --env-file .env -f docker-compose.local.yml config --quiet` and equivalent commands for each supported example. Use a throwaway nonsecret `OPEN_NOTEBOOK_IMAGE_REF` digest-shaped value for pull-config validation; do not substitute a published image unless authorized. Attempt local `docker compose ... build` and API/worker health if Docker is available; record unavailable daemon separately. Search active paths for `lfnovo/open_notebook` and `ghcr.io/lfnovo` without deleting historical attribution text.

**Acceptance:** Local mode builds this branch, pull mode cannot silently pull upstream or use a floating release tag, required secrets fail closed, connector and storage env settings reach API and worker, and `.env` key-name parity is proven without exposing values. **Do not push** to Docker Hub in this task.

## Task 7 — Release gate and handoff

- [ ] **Step 1: Run and record fresh final-HEAD automation** in `docs/superpowers/plans/STATUS.md`, including exact command, exit status, pass/skip/warning counts, and commit SHA.

```text
uv run pytest -q tests/
uv run ruff check .
uv run python -m mypy .
uv run python scripts/check_licenses.py
# Run the following with working directory frontend/:
npm run test
npx tsc --noEmit
npm run lint
npm run build
docker compose --env-file .env -f docker-compose.local.yml config --quiet
```

- [ ] **Step 2: Verify local stack and real integration.** Start SurrealDB, API (migrations), worker, and frontend in that order. On a real development tenant, test two users' consent/isolation/revocation; a folder over 1,000 and Graph 429; same eTag reuse and changed eTag snapshot; batch retry after worker restart; one/bulk Sources linked to zero/multiple notebooks; chat/ask from imported Sources; filesystem and SPE small/large upload, download, retry, retention/delete, eTag 412, old-profile read, and orphan/queue reconciliation. Validate actual SurrealDB claim/transaction SQL and worker consumption of the connector's `process_source` command row. Verify an approved digest-pinned `datafabricx/open-notebook-commercial` pull **only after** an image exists and publication has been separately approved.
- [ ] **Step 3: Obtain independent whole-branch review and fix Important/Critical findings with RED→GREEN tests.** Check connector/storage credential separation, owner ACLs, no external Graph DELETE, secret/log exposure, data-loss paths, all active image refs, and 16-locale parity. Re-run affected and final tests after fixes.
- [ ] **Step 4: Give the user branch testing steps and wait for sign-off.** If tenant credentials, Docker daemon, or published image are absent, mark that gate **UNVERIFIED/BLOCKED** with the exact missing prerequisite in `STATUS.md`; do not check the release gate or claim production readiness. Never merge, delete the branch, or publish without a new explicit user instruction.

## Self-review before resuming implementation

- [ ] Each Task 3–7 acceptance criterion has a named test or a clearly labeled live gate above.
- [ ] New storage references retain provider/profile/container independently of the current default; legacy filesystem records still resolve.
- [ ] Task 4 recovery covers both remote-success/DB-failure and Source-success/queue-failure without deleting a referenced object.
- [ ] Task 5 reads the backend's actual three-state status and can recover progress after refresh with owner-only data.
- [ ] Task 6 touches active image destinations, not historical attribution, and does not assume an unprovided GHCR namespace.
- [ ] The final result is described as code-complete separately from live-tenant/registry-verified; user approval still controls merge/publication.

## Primary references for changing Microsoft contracts

- [MSAL Python certificate credentials](https://learn.microsoft.com/en-us/entra/msal/python/advanced/client-credentials) and [confidential client PFX support](https://learn.microsoft.com/en-us/python/api/msal/msal.application.confidentialclientapplication?view=msal-py-latest).
- [SharePoint Embedded app-only permissions](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/plan/authentication-permissions).
- [Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0) and [driveItem conditional deletion](https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0). Verify their current limits and response semantics again before coding Task 4.
