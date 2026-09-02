# Original File Retention Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `ponytail`, `karpathy-guidelines`, `test-driven-development`, and `verification-before-completion` throughout. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous upload auto-delete behavior with an administrator-governed, per-upload retention decision; safe post-success deletion; exact-original download; and permission-aware cleanup without exposing server paths.

**Architecture:** Keep internal file paths on the domain asset, but map every public source response through a safe asset model. Resolve and snapshot the effective retention action when an upload is accepted. Centralize containment, eligibility, deletion, and cleanup in one focused source-file service. The source-processing command invokes deletion only after the graph has saved the source successfully. Admin and owner cleanup share the same service and execute through the existing command worker.

**Tech Stack:** FastAPI, Pydantic, SurrealDB repository helpers, surreal-commands, Next.js, TypeScript, React, TanStack Query, Vitest, Testing Library, i18next.

**Approved design:** [Original File Retention Governance Design](../specs/2026-09-01-original-file-retention-governance-design.md)

## Global Constraints

- This task governs original uploaded files only. Never delete `full_text`, embeddings, insights, sources, notes, or notebook relationships.
- Policy changes affect future uploads only. No settings update may trigger cleanup or rewrite existing source snapshots.
- `asset.file_path` remains an internal domain field and must not cross an API response boundary.
- Deletion must resolve a stored path inside `UPLOADS_FOLDER` immediately before unlinking; requests never supply cleanup paths.
- Only successful source processing may satisfy automatic deletion. Failures and retries retain the input file.
- Admin cleanup includes all users and admin-owned sources. Owner cleanup is opt-in and never extends to editors/viewers.
- The destructive cleanup command is internal-only. The generic command-submission route must reject its command name.
- Use existing dependencies, design tokens, auth dependencies, command polling, sheets, confirmation patterns, and locale structure.
- Preserve compatibility for existing assets with only `file_path`, and for one release of legacy request parsing; never derive deletion from the old `auto_delete_files=yes` default.

---

### Task 1: Define the policy, snapshot, and public contracts

**Files:**
- Create: `open_notebook/domain/original_file_policy.py`
- Modify: `open_notebook/domain/content_settings.py`
- Modify: `open_notebook/domain/notebook.py`
- Modify: `api/models.py`
- Create: `tests/test_original_file_policy.py`
- Modify: `tests/characterization/test_source_ingestion_characterization.py`

**Interfaces:**
- Produces `OriginalFilePolicy`, `OriginalFileAction`, `OriginalFileDeletionReason`, and `resolve_original_file_action()`.
- Extends `ContentSettings` with admin policy fields whose missing-record defaults are safe.
- Extends the internal `Asset` with original-file metadata.
- Replaces public `AssetModel.file_path` with non-sensitive original-file fields.

- [ ] **Step 1: Write failing policy-resolution tests**

Cover the full resolution matrix in `tests/test_original_file_policy.py`:

```python
@pytest.mark.parametrize(
    ("policy", "default", "requested", "expected"),
    [
        ("always_keep", "delete_after_processing", "delete_after_processing", "keep"),
        ("always_delete", "keep", "keep", "delete_after_processing"),
        ("user_choice", "keep", None, "keep"),
        ("user_choice", "delete_after_processing", None, "delete_after_processing"),
        ("user_choice", "keep", "delete_after_processing", "delete_after_processing"),
    ],
)
def test_resolve_original_file_action(policy, default, requested, expected):
    assert resolve_original_file_action(policy, default, requested) == expected


def test_missing_new_settings_fields_default_to_keep():
    settings = ContentSettings.model_validate({"auto_delete_files": "yes"})
    assert settings.original_file_policy == "always_keep"
```

Also assert invalid strings fail Pydantic validation.

- [ ] **Step 2: Run the focused tests and confirm the types are absent**

Run: `uv run pytest tests/test_original_file_policy.py -q`

Expected: FAIL because the policy module and fields do not exist.

- [ ] **Step 3: Add the minimal typed domain model**

In `original_file_policy.py`, define literals and a pure resolver:

```python
OriginalFilePolicy = Literal["always_keep", "user_choice", "always_delete"]
OriginalFileAction = Literal["keep", "delete_after_processing"]
OriginalFileDeletionReason = Literal[
    "retention_policy", "source_owner", "admin_cleanup"
]


def resolve_original_file_action(
    policy: OriginalFilePolicy,
    default_action: OriginalFileAction,
    requested_action: OriginalFileAction | None,
) -> OriginalFileAction:
    if policy == "always_keep":
        return "keep"
    if policy == "always_delete":
        return "delete_after_processing"
    return requested_action or default_action
```

Add these safe defaults to `ContentSettings`:

```python
original_file_policy: OriginalFilePolicy = "always_keep"
original_file_user_default: OriginalFileAction = "keep"
allow_source_owner_cleanup: bool = False
```

Retain `auto_delete_files` as a deprecated domain-only field during the compatibility window. Do not use it in the resolver.

Extend internal `Asset` with all approved metadata, including the recoverable `original_deletion_started_at` marker. Extend public `AssetModel` with only the safe filename, size, action, final deletion metadata, and derived status. Remove `file_path` from `AssetModel`; do not remove it from the internal `Asset`.

- [ ] **Step 4: Lock the compatibility behavior in characterization tests**

Update the existing characterization assertions so an existing source containing only `asset.file_path` is interpreted as retained and an old `auto_delete_files=yes` record does not select automatic deletion. Explain the intentional contract change in the test docstring, as required for characterization changes.

- [ ] **Step 5: Run policy and domain regressions**

Run:

```bash
uv run pytest tests/test_original_file_policy.py tests/test_domain.py tests/characterization/test_source_ingestion_characterization.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit the contract foundation**

```bash
git add open_notebook/domain/original_file_policy.py open_notebook/domain/content_settings.py open_notebook/domain/notebook.py api/models.py tests/test_original_file_policy.py tests/characterization/test_source_ingestion_characterization.py
git commit -m "feat(sources): define original file retention policy"
```

---

### Task 2: Resolve and persist the effective action at upload time

**Files:**
- Create: `api/source_file_service.py`
- Modify: `api/routers/sources.py`
- Modify: `api/models.py`
- Modify: `tests/test_sources_api.py`
- Modify: `tests/characterization/test_source_ingestion_characterization.py`

**Interfaces:**
- Consumes admin `ContentSettings` and optional request `original_file_action`.
- Persists original filename, byte size, effective action, and internal path on the new source asset.
- Keeps forced administrator modes authoritative over request values.

- [ ] **Step 1: Write failing multipart and JSON upload tests**

Add tests for:

1. `always_keep` ignores a requested delete action;
2. `always_delete` ignores a requested keep action;
3. `user_choice` honors a valid owner request;
4. `user_choice` applies the admin default when omitted;
5. stored metadata uses the client filename and actual saved byte count;
6. URL and pasted-text sources receive no original-file metadata;
7. the command input receives the snapshotted action, not a fresh settings lookup.

Example assertion:

```python
assert saved_source.asset.original_filename == "paper.pdf"
assert saved_source.asset.original_size_bytes == len(upload_bytes)
assert saved_source.asset.original_file_action == "delete_after_processing"
assert submitted[2]["content_state"]["original_file_action"] == "delete_after_processing"
```

- [ ] **Step 2: Run source API tests and confirm the request is unsupported**

Run: `uv run pytest tests/test_sources_api.py tests/characterization/test_source_ingestion_characterization.py -q`

Expected: FAIL on the new metadata and resolution assertions.

- [ ] **Step 3: Add request parsing and a single policy-resolution seam**

Add optional `original_file_action` to `SourceCreate`. Parse it in both JSON and multipart flows. In `api/source_file_service.py`, add an async function that loads `ContentSettings` once and calls the pure resolver. Do not read settings inside graph nodes or the worker later.

When saving an uploaded source, use the `UploadFile.filename` captured before storage and `Path(saved_path).stat().st_size`. For backward-compatible JSON requests referencing an already-saved path, use the safe basename and size only after existing root containment validation.

Keep `delete_source` request parsing temporarily. Translate it to the new action only when `original_file_action` is absent and policy mode is `user_choice`. Forced modes still win. Add a deprecation comment with the removal condition; do not expose `delete_source` in new UI types.

- [ ] **Step 4: Pass the snapshot through processing**

Put `original_file_action` in `content_state` from the saved asset. Never recalculate it in `process_source_command`. Existing upload cleanup on request-validation failure remains unchanged because no durable source exists yet.

- [ ] **Step 5: Run upload, containment, and race tests**

Run:

```bash
uv run pytest tests/test_sources_api.py tests/characterization/test_source_ingestion_characterization.py tests/test_source_path_containment.py tests/test_upload_toctou_race.py tests/test_upload_type_mitigations.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit upload snapshotting**

```bash
git add api/source_file_service.py api/routers/sources.py api/models.py tests/test_sources_api.py tests/characterization/test_source_ingestion_characterization.py
git commit -m "feat(sources): snapshot original file action on upload"
```

---

### Task 3: Move automatic deletion to the successful command boundary

**Files:**
- Modify: `api/source_file_service.py`
- Modify: `open_notebook/graphs/source.py`
- Modify: `commands/source_commands.py`
- Modify: `tests/test_graphs.py`
- Create: `tests/test_source_original_file_lifecycle.py`

**Interfaces:**
- Produces `delete_original_file(source, reason)` with idempotent, contained deletion.
- `process_source_command` invokes it only after source graph success and durable `full_text`.
- Removes extraction-stage deletion from `source_graph`.

- [ ] **Step 1: Write failing lifecycle tests before moving behavior**

Cover these cases with temporary files beneath a temporary uploads root:

- extraction succeeds but a later transformation fails: file remains;
- command succeeds with action `keep`: file remains;
- command succeeds with action `delete_after_processing`: file is removed, `file_path` is cleared, and deletion time/reason are persisted;
- retry after a start marker with the file still present resumes deletion;
- retry after a start marker with the file absent finalizes deletion metadata;
- a missing file without a start marker is reported as missing and is not called deleted;
- path outside the upload root is rejected and remains untouched;
- unlink failure retains `file_path` and the start marker for retry, without setting `original_deleted_at`;
- `full_text` absent at the completion boundary prevents deletion.

- [ ] **Step 2: Run lifecycle tests and show the current premature delete**

Run: `uv run pytest tests/test_source_original_file_lifecycle.py tests/test_graphs.py::TestContentProcessDeleteSource -q`

Expected: FAIL because the graph currently unlinks immediately after extraction.

- [ ] **Step 3: Implement the contained, idempotent deletion helper**

In `source_file_service.py`, accept a loaded `Source`, not a request path. Resolve the stored path and upload root, require containment and a regular file, then use a recoverable two-phase sequence:

```python
asset.original_deletion_started_at = datetime.now(timezone.utc)
asset.original_deleted_reason = reason
await source.save()

safe_path.unlink()

asset.file_path = None
asset.original_deleted_at = datetime.now(timezone.utc)
await source.save()
```

If `original_deleted_at` is already present and `file_path` is absent, return an idempotent success. If a retry finds `original_deletion_started_at` and the path is now absent, finalize `original_deleted_at` and clear the internal path. Without a start marker, an absent file is `missing`, not a successful application deletion.

- [ ] **Step 4: Delete only after command success**

Remove the deletion block from `open_notebook/graphs/source.py`. In `process_source_command`, after the graph returns, reload/validate the processed source, require persisted `full_text is not None`, and call the helper only when the snapshotted action is `delete_after_processing`. Use reason `retention_policy`.

Ensure an automatic-deletion failure fails the command and is retryable. On retry, the source remains processable until deletion succeeds; after a recorded deletion, the helper is idempotent.

- [ ] **Step 5: Update the intentional graph characterization**

Replace `TestContentProcessDeleteSource` assertions that expect extraction-stage unlinking with assertions that the graph never unlinks. The command-lifecycle test now owns deletion behavior. State that this is an intentional safety-boundary change.

- [ ] **Step 6: Run lifecycle and processing regressions**

Run:

```bash
uv run pytest tests/test_source_original_file_lifecycle.py tests/test_graphs.py tests/test_add_insight_failure_propagation.py tests/test_sources_api.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit safe post-success deletion**

```bash
git add api/source_file_service.py open_notebook/graphs/source.py commands/source_commands.py tests/test_graphs.py tests/test_source_original_file_lifecycle.py
git commit -m "fix(sources): delete originals only after processing succeeds"
```

---

### Task 4: Hide server paths and preserve exact-original download

**Files:**
- Modify: `api/source_file_service.py`
- Modify: `api/routers/sources.py`
- Modify: `api/models.py`
- Modify: `tests/test_sources_api.py`
- Modify: `tests/test_source_path_containment.py`
- Modify: `tests/test_upload_type_mitigations.py`
- Modify: `frontend/src/lib/types/api.ts`
- Modify: `frontend/src/components/common/ResourceTypeIcon.tsx`
- Modify: `frontend/src/components/sources/SourceCard.tsx`
- Modify: `frontend/src/components/sources/SourceLibraryRow.tsx`
- Modify: `frontend/src/components/sources/AddExistingSourceDialog.tsx`
- Modify: `frontend/src/components/sources/SourceContentPane.tsx`
- Modify: `frontend/src/components/sources/SourceDetailContent.tsx`
- Modify: affected `*.test.tsx` files beside those components

**Interfaces:**
- Produces one safe public-asset mapper used by source list/detail/status responses.
- Frontend identifies uploads and file extensions from `original_filename`.
- Download uses the internal stored path but sends the original filename.

- [ ] **Step 1: Write failing path-redaction and download tests**

Backend assertions:

```python
payload = response.json()
assert "file_path" not in payload["asset"]
assert payload["asset"]["original_filename"] == "paper.pdf"
assert payload["asset"]["original_file_status"] == "retained"
assert response_download.content == original_bytes
assert 'filename="paper.pdf"' in response_download.headers["content-disposition"]
```

Cover list, detail, deleted, missing, URL, and text source responses. Assert deleted/missing download errors contain no absolute path.

- [ ] **Step 2: Run affected API tests and confirm paths are public**

Run: `uv run pytest tests/test_sources_api.py tests/test_source_path_containment.py tests/test_upload_type_mitigations.py -q`

Expected: FAIL because current responses serialize `file_path`.

- [ ] **Step 3: Centralize safe public mapping**

Add a mapper in `source_file_service.py` that accepts the internal asset and derives safe metadata. For legacy assets lacking `original_filename`, derive `Path(file_path).name` only after containment checks. Compute availability/status without returning a path. Use this mapper from every manual source response construction in `api/routers/sources.py`, including the optimized list query.

Update download to use `original_filename` for `Content-Disposition`. The internal path remains the stream target after the existing canonical containment and content-type checks.

- [ ] **Step 4: Write failing frontend upload-kind tests**

Change fixtures from `{ file_path: '/uploads/evidence.pdf' }` to:

```ts
{
  original_filename: 'evidence.pdf',
  original_file_status: 'retained',
  original_size_bytes: 2048,
}
```

Assert resource icons, source cards, rows, menu availability, and download behavior still identify the source as an uploaded PDF without a server path.

- [ ] **Step 5: Migrate frontend checks to original metadata**

Update the source asset type and `getSourceResourceKind()` to use `original_filename`. Replace every `asset.file_path` presence check in the listed components. Download filename fallback becomes `asset.original_filename || source-${id}`. Do not introduce a second source-kind helper; keep the existing shared resource utility as the single seam.

- [ ] **Step 6: Run backend and frontend regressions**

Run:

```bash
uv run pytest tests/test_sources_api.py tests/test_source_path_containment.py tests/test_upload_type_mitigations.py -q
cd frontend
npm run test -- src/components/common/ResourceTypeIcon.test.tsx src/components/sources/SourceCard.test.tsx src/components/sources/SourceLibraryRow.test.tsx src/components/sources/SourceDetailContent.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit path privacy and download preservation**

```bash
git add api/source_file_service.py api/routers/sources.py api/models.py tests/test_sources_api.py tests/test_source_path_containment.py tests/test_upload_type_mitigations.py frontend/src/lib/types/api.ts frontend/src/components/common/ResourceTypeIcon.tsx frontend/src/components/sources
git commit -m "fix(sources): keep upload paths private"
```

---

### Task 5: Add permission-aware preview and cleanup APIs

**Files:**
- Modify: `api/source_file_service.py`
- Create: `api/routers/source_files.py`
- Modify: `api/main.py`
- Modify: `api/routers/commands.py`
- Modify: `api/models.py`
- Create: `commands/source_file_commands.py`
- Modify: `commands/__init__.py`
- Create: `tests/test_source_file_cleanup.py`
- Modify: `tests/test_auth_admin_gates.py`

**Interfaces:**
- Produces `GET /source-files/policy`.
- Produces `GET /source-files/cleanup-preview?scope=mine|all`.
- Produces `POST /source-files/cleanup` returning a command id.
- Produces `DELETE /sources/{source_id}/original-file` for a single confirmed deletion.

- [ ] **Step 1: Write failing authorization and eligibility tests**

Build a matrix for admin, owner, editor, viewer, and anonymous/auth-disabled behavior. Assert:

- only admin can use `scope=all`;
- owner `scope=mine` and single delete require `allow_source_owner_cleanup=true`;
- editor/viewer access never grants cleanup;
- admin `all` includes admin-owned and other-user sources;
- mine never includes another user's sources;
- queued/running/retrying/failed sources, absent `full_text`, deleted files, missing files, and unsafe paths are excluded;
- preview returns counts/bytes only and no titles, filenames, owners, or paths;
- execution rechecks eligibility after preview;
- the generic `/commands/jobs` endpoint rejects direct submission of `cleanup_original_files`;
- the worker revalidates the requesting admin role or current owner-cleanup permission;
- partial failures return deleted/skipped/failed totals and continue safely.

- [ ] **Step 2: Run cleanup tests and confirm endpoints are absent**

Run: `uv run pytest tests/test_source_file_cleanup.py tests/test_auth_admin_gates.py -q`

Expected: FAIL with missing routes and command.

- [ ] **Step 3: Implement reusable eligibility queries and authorization**

Keep the router thin. Put candidate selection, successful-command/full-text checks, byte aggregation, and delete calls in `source_file_service.py`. Query only the fields required for eligibility. Reuse `require_admin`, `require_user`, and the source owner comparison conventions from `api/ownership.py`.

The policy-summary endpoint returns the safe mode/default and booleans needed by the current user. It must not expose unrelated settings.

- [ ] **Step 4: Implement bounded background cleanup**

Create a `cleanup_original_files` surreal command with input `scope` and requesting user id. Process stable pages/batches, reloading and revalidating each source just before deletion. The worker must revalidate that an `all` requester is still an administrator and that a `mine` requester is still allowed to clean owned originals. Use `admin_cleanup` for admin-all execution and `source_owner` for owner-mine execution. Return aggregate counts and bytes; do not return paths.

Register the command in `commands/__init__.py`. Add `cleanup_original_files` to an explicit internal-only set in `api/routers/commands.py` so generic command submission returns 403 for it; the authorized source-files route submits it through `CommandService` directly. Return the command id for existing polling infrastructure.

- [ ] **Step 5: Implement single-source deletion**

Load the source by id, conceal inaccessible resources with existing ownership conventions, then require admin or owner-cleanup permission. Reuse the same eligibility/deletion helper. Return safe updated metadata, not a path.

- [ ] **Step 6: Run cleanup, auth, and command regressions**

Run:

```bash
uv run pytest tests/test_source_file_cleanup.py tests/test_auth_admin_gates.py tests/test_typed_exceptions_reach_handlers.py tests/test_source_path_containment.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit cleanup APIs**

```bash
git add api/source_file_service.py api/routers/source_files.py api/routers/commands.py api/main.py api/models.py commands/source_file_commands.py commands/__init__.py tests/test_source_file_cleanup.py tests/test_auth_admin_gates.py
git commit -m "feat(sources): add governed original file cleanup"
```

---

### Task 6: Replace the admin toggle and add upload choice

**Files:**
- Modify: `api/routers/settings.py`
- Modify: `api/models.py`
- Modify: `tests/test_auth_admin_gates.py`
- Modify: `frontend/src/lib/types/api.ts`
- Modify: `frontend/src/lib/api/settings.ts`
- Modify: `frontend/src/lib/api/sources.ts`
- Modify: `frontend/src/lib/hooks/` source/settings hook files that own these requests
- Modify: `frontend/src/app/(dashboard)/settings/components/SettingsForm.tsx`
- Modify: `frontend/src/app/(dashboard)/settings/components/SettingsForm.test.tsx`
- Modify: `frontend/src/components/sources/AddSourceDialog.tsx`
- Modify: `frontend/src/components/sources/AddSourceDialog.test.tsx`
- Modify: `frontend/src/lib/locales/*/index.ts`

**Interfaces:**
- Admin settings reads/writes the three new policy fields.
- Upload sheet reads safe policy summary and submits owner choice only when allowed.
- Legacy `auto_delete_files` and `delete_source` disappear from active frontend contracts.

- [ ] **Step 1: Write failing settings API tests**

Assert the admin GET/PUT contract includes the three policy fields, rejects invalid enum values, and never updates existing source asset snapshots. Assert `auto_delete_files` is absent from responses and a PUT containing that legacy field returns 422, forcing old clients to adopt the explicit policy instead of assuming deletion occurred.

- [ ] **Step 2: Implement the minimal settings contract**

Update `SettingsResponse`, `SettingsUpdate`, and `api/routers/settings.py`. Set `SettingsUpdate.model_config = ConfigDict(extra="forbid")`, assign typed Pydantic values directly, and remove repeated local casts for the new fields. Saving settings must call only `settings.update()` and must not submit cleanup work.

- [ ] **Step 3: Write failing UI state tests**

Settings tests cover all three modes, conditional default control, owner-cleanup switch, and the “future uploads only” explanation. Upload tests cover:

- choice control shown and initialized from default in `user_choice`;
- a changed selection submitted as `original_file_action`;
- forced keep/delete shown as explanatory text without a fake disabled control;
- batch and single upload requests use the same resolved form value.

- [ ] **Step 4: Build the theme-aware, localized controls**

Use existing field, radio/select, alert/help-text, and sheet patterns. Add no custom color literals. Remove the old auto-delete switch. Fetch the safe policy summary through the existing `apiClient` and TanStack Query conventions. Omit `original_file_action` from forced-mode requests because the backend remains authoritative.

Add every new string to all locale files and keep `en-US` as the reference shape.

- [ ] **Step 5: Run settings/upload and locale tests**

Run:

```bash
uv run pytest tests/test_auth_admin_gates.py tests/test_original_file_policy.py -q
cd frontend
npm run test -- src/app/\(dashboard\)/settings/components/SettingsForm.test.tsx src/components/sources/AddSourceDialog.test.tsx src/lib/locales/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit policy UI**

```bash
git add api/routers/settings.py api/models.py tests/test_auth_admin_gates.py frontend/src/lib/types/api.ts frontend/src/lib/api frontend/src/lib/hooks frontend/src/app/\(dashboard\)/settings/components/SettingsForm.tsx frontend/src/app/\(dashboard\)/settings/components/SettingsForm.test.tsx frontend/src/components/sources/AddSourceDialog.tsx frontend/src/components/sources/AddSourceDialog.test.tsx frontend/src/lib/locales
git commit -m "feat(settings): govern original file retention"
```

---

### Task 7: Add cleanup controls and useful Source Details metadata

**Files:**
- Create: `frontend/src/lib/api/source-files.ts`
- Create: `frontend/src/lib/hooks/use-source-files.ts`
- Modify: `frontend/src/app/(dashboard)/settings/components/SettingsForm.tsx`
- Modify: `frontend/src/app/(dashboard)/settings/components/SettingsForm.test.tsx`
- Modify: `frontend/src/components/sources/SourceContentPane.tsx`
- Modify: `frontend/src/components/sources/SourceDetailContent.tsx`
- Modify: `frontend/src/components/sources/SourceDetailContent.test.tsx`
- Modify: `frontend/src/lib/locales/*/index.ts`

**Interfaces:**
- Admin settings can preview and start all-user cleanup.
- Source Details shows original filename, size, action result, and availability without a path.
- Authorized admin/owner can delete one retained original after confirmation.

- [ ] **Step 1: Write failing Source Details state tests**

Cover retained, policy-deleted, owner-deleted, admin-deleted, missing, and non-upload states. Assert:

- no path-shaped text is rendered;
- filename and formatted size render for uploaded sources;
- status uses an existing theme-aware badge;
- download appears only for retained/available files;
- delete-original appears only when capability metadata authorizes it;
- confirmation explains that extracted content and the source record remain;
- successful deletion invalidates source list/detail queries and updates the visible state.

- [ ] **Step 2: Write failing admin cleanup UI tests**

Assert settings shows preview count/bytes, disables cleanup at zero eligible files, requires confirmation, starts the command, polls with the existing job-status API, reports aggregate completion, and refreshes preview/source queries. Verify the all-user scope wording explicitly includes the administrator's files.

- [ ] **Step 3: Implement typed API hooks with existing infrastructure**

Use `apiClient`, `QUERY_KEYS`, TanStack Query mutations, and the existing command status endpoint. Keep policy summary, preview, start-cleanup, and single-delete in one small source-files API module. Do not add a polling package.

- [ ] **Step 4: Implement Source Details metadata and confirmation**

Replace the current server-path row in `SourceContentPane`. Use `Intl.NumberFormat` or existing formatting utilities for bytes. Reuse sheet/dialog footer and destructive-action styles. Keep actions keyboard accessible and screen-reader named.

- [ ] **Step 5: Implement admin cleanup preview and confirmation**

Place cleanup below policy controls as a separate destructive maintenance subsection. Preview is read-only. Confirmation repeats scope and eligible storage. Starting cleanup must not optimistically claim files were deleted; show worker completion results.

- [ ] **Step 6: Add localized strings and verify both themes**

Add keys to every locale, run locale parity, then inspect settings and Source Details at 375, 768, 1024, and 1440px in light/dark modes. Confirm long filenames ellipsize with an accessible full-value title and no horizontal overflow.

- [ ] **Step 7: Run focused frontend verification**

Run from `frontend/`:

```bash
npm run test -- src/app/\(dashboard\)/settings/components/SettingsForm.test.tsx src/components/sources/SourceDetailContent.test.tsx src/lib/locales/index.test.ts
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit cleanup and details UI**

```bash
git add frontend/src/lib/api/source-files.ts frontend/src/lib/hooks/use-source-files.ts frontend/src/app/\(dashboard\)/settings/components/SettingsForm.tsx frontend/src/app/\(dashboard\)/settings/components/SettingsForm.test.tsx frontend/src/components/sources/SourceContentPane.tsx frontend/src/components/sources/SourceDetailContent.tsx frontend/src/components/sources/SourceDetailContent.test.tsx frontend/src/lib/locales
git commit -m "feat(sources): manage retained originals in the UI"
```

---

### Task 8: Document, audit, and verify the complete behavior

**Files:**
- Modify: `docs/7-DEVELOPMENT/content-processing.md`
- Modify: `docs/7-DEVELOPMENT/architecture.md`
- Modify: `docs/index.md` or the existing operator-settings document selected by the documentation index
- Modify: `docs/superpowers/plans/2026-09-01-original-file-retention-governance.md`
- Modify: `.remember/remember.md`

- [ ] **Step 1: Document operator and developer behavior**

Document the three admin modes, future-upload-only semantics, successful-processing deletion boundary, exact-original download, cleanup permissions, worker requirement, internal storage location, and the fact that deleting an original preserves extracted content. Include the safe-upgrade behavior from legacy settings.

- [ ] **Step 2: Run a server-path exposure audit**

Run:

```bash
rg -n "file_path" api/models.py api/routers frontend/src
```

Inspect every match. Accept internal request/domain handling only. No public response type, response mapper, client type, component, toast, or API error may expose a stored server path.

- [ ] **Step 3: Run the full backend quality gate**

```bash
uv run pytest tests/
ruff check .
uv run python -m mypy .
uv run python scripts/check_licenses.py
```

Expected: PASS. If a known environment-only failure matches `docs/DEV_SETUP.md`, record its exact command/output and run the documented equivalent verification; do not label a new product failure as environmental.

- [ ] **Step 4: Run the full frontend quality gate**

From `frontend/`:

```bash
npm run test
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 5: Perform manual product verification**

With database, API, worker, and frontend running, verify:

1. all three policies with a newly uploaded file;
2. a processing failure retains the original;
3. changing policy does not affect an earlier source;
4. admin cleanup includes admin and another user's eligible originals;
5. owner cleanup follows its permission switch;
6. editor/viewer cleanup is absent and forbidden by API;
7. retained download bytes hash-match the uploaded file;
8. Source Details never shows the server path;
9. deleted sources retain extracted content and insights;
10. light/dark, keyboard, focus order, 200% zoom, and the four required widths remain usable.

- [ ] **Step 6: Update task state only after evidence exists**

Check completed plan boxes, mark the roadmap follow-up complete, and update Remember with the exact passing test totals and any separately tracked deferred compatibility removal. Do not mark complete from implementation alone.

- [ ] **Step 7: Commit documentation and verification record**

```bash
git add docs .remember/remember.md
git commit -m "docs: record original file retention governance"
```

## Definition of Done

- All ten acceptance criteria in the approved design are demonstrated by automated or manual evidence.
- Legacy installations default to keeping originals until an admin explicitly saves a new policy.
- Automatic deletion cannot run before successful processing.
- Cleanup authorization and upload policy are enforced by the backend, regardless of frontend state.
- The exact retained file downloads with the client-visible original filename.
- No public server path remains.
- Full backend/frontend test, lint, type, build, and license checks pass.
- The roadmap, this plan, operator docs, and Remember agree on final status.
