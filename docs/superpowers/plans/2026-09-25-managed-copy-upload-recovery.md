# Managed-copy upload recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every managed copy, folder or SharePoint Embedded, has one `original_upload_operation` row that stays `stored` until a Source owns it, and a lease-timed run of the existing reconciler deletes only copies no Source references.

**Architecture:** `save_tracked_original` already writes the row for SharePoint Embedded and `finish_original_upload` already sets `stored`. Remove the filesystem early return so the folder uses that same hook. The reconciler selects `uploading` and `stored` rows whose `progress_at` lease expired, deletes an unreferenced managed copy, and never queues `process_source`. Attaching the Source and flipping the row to `attached` is one database transaction. `completed` is written only after `process_source` finishes retention. The API lifespan submits `reconcile_original_uploads` on a 15-minute timer, the same shape as Entra group sync. An admin setting shows the count of `uploading` plus `stored` rows and a button that submits that same command.

**Tech Stack:** FastAPI, SurrealDB migrations, surreal-commands worker, existing `OriginalFileStore`, Next.js settings panel, vitest, pytest.

## Global Constraints

- Do not add a second queue, a per-store sweeper, a user-facing list of folder paths or Graph item ids, or a provider lifecycle rule. The folder has no lifecycle rule. SharePoint Embedded does not offer one. The row is the mechanism.
- Do not change `process_source` retry (up to 15 attempts; a permanent failure such as a password-protected PDF stops and keeps the managed copy). The source-list Retry button stays the extraction retry for every intake and every store.
- Do not change the SharePoint batch Retry button. It repeats download and store only. Once a document is `queued`, extraction failure belongs to source Retry.
- Never delete an external library item. The reconciler receives only `original_upload_operation` rows. Alice's library item (`sp-42`) is never in that table.
- A live API process that fails after the copy exists still deletes that copy immediately. That path in `commands/connector_commands.py` (`_delete_unreferenced_copy`) stays.
- Do not start the timer (Task 4) until Tasks 1–3 are committed. A sweeper must not run while a row can mean "the store accepted the bytes" and "a Source owns them" at the same time.
- `finish_original_upload` in `open_notebook/storage/upload_operations.py` already sets `status = 'stored'`. Do not change that write back to `completed`.
- Grace period stays 900 seconds (`GRACE_SECONDS`). The clock is `progress_at`, not `created`.
- No new dependency. No GPL/AGPL. Migrations are hard-coded in `AsyncMigrationManager`. Next migration number is **36**.
- New UI strings go through `t()` and exist in all 16 locales under `frontend/src/lib/locales/`.
- Work on `codex/wp5-sharepoint` in the wp5-sharepoint worktree. Do not push, merge, or publish an image unless asked.

## File structure

- `open_notebook/database/migrations/36.surrealql` and `36_down.surrealql` — `progress_at` only. Status values stay a string; no schema enum.
- `open_notebook/database/async_migrate.py` — register migration 36.
- `open_notebook/storage/original_files.py` — filesystem `allocate_object_name`, `find_by_object_name`, and `save(..., object_name=)`.
- `open_notebook/storage/upload_operations.py` — track every store; lease touch; reconciler status rules.
- `open_notebook/storage/sharepoint_embedded.py` — call the progress hook once per accepted chunk.
- `api/source_ingestion_service.py` — one transaction sets `attached` with the Source and `process_source` command.
- `commands/source_commands.py` — set `completed` after retention.
- `commands/source_file_commands.py` — log the `attached` count. Command name stays `reconcile_original_uploads`.
- `api/main.py` — lifespan timer, after Tasks 1–3.
- `api/routers/commands.py` — reject generic submission of `reconcile_original_uploads`.
- `api/routers/source_files.py` — admin count and run endpoint.
- `frontend/src/lib/api/source-files.ts`, `frontend/src/lib/hooks/use-source-files.ts`, `frontend/src/app/(dashboard)/settings/components/SettingsForm.tsx` — count and button beside the existing cleanup panel.
- `docs/ORIGINAL_FILE_STORAGE.md` — replace the paragraph that says the worker queues a saved Source.
- Tests live next to the behavior they lock: `tests/test_original_upload_recovery.py`, `tests/test_source_storage_integration.py`, `frontend/src/app/(dashboard)/settings/components/SettingsForm.test.tsx`.

## Out of scope

Batch Retry, source Retry, extraction, retention keep-or-delete policy, and deleting external SharePoint documents. Failed processing does not appear in the admin count: those copies have a Source, and deleting them would remove the file source Retry needs.

---

### Task 1: Status contract and lease

**Files:**
- Create: `open_notebook/database/migrations/36.surrealql`
- Create: `open_notebook/database/migrations/36_down.surrealql`
- Modify: `open_notebook/database/async_migrate.py` (register after `35.surrealql` / `35_down.surrealql`)
- Modify: `open_notebook/storage/upload_operations.py`
- Modify: `commands/source_file_commands.py` (`ReconcileOriginalUploadsOutput` and the DONE log)
- Test: `tests/test_original_upload_recovery.py`

**Interfaces:**
- Consumes: `begin_original_upload`, `finish_original_upload`, `reconcile_operation`, `reconcile_due_uploads`.
- Produces: `touch_original_upload(operation_id: str) -> None`. Status strings `uploading`, `stored`, `attached`, `completed`, `abandoned`. `reconcile_due_uploads` counts include `attached`. `reconcile_operation` returns `deleted`, `abandoned`, `attached`, or `skipped`. It does not return `queued`.

`stored` means the store accepted the bytes and a Source may still be missing. `attached` means a Source points at the copy and `process_source` was queued. `completed` means processing finished and retention has run. `abandoned` means the sweeper found nothing stored, or deleted an unreferenced copy. The reconciler does not call `queue`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_original_upload_recovery.py`:

```python
def test_progress_lease_migration_is_registered():
    manager = AsyncMigrationManager()
    assert "progress_at" in manager.up_migrations[35].sql
    assert "REMOVE FIELD progress_at" in manager.down_migrations[35].sql


@pytest.mark.asyncio
async def test_referenced_copy_is_attached_and_not_queued():
    source = SimpleNamespace(id="source:1", command=None, asset=None)
    operation = _operation(item_key="item-1", etag="etag-1", status="stored")
    store, deleted, queued, source_for, referenced, queue, persist = _harness(
        operation, referenced_ids=["source:1"], source=source
    )

    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "attached"
    )
    assert queued == []
    assert deleted == []
    assert operation["status"] == "attached"
    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "skipped"
    )


@pytest.mark.asyncio
async def test_missing_object_is_abandoned_not_completed():
    operation = _operation(status="uploading")
    store, deleted, _, source_for, referenced, queue, persist = _harness(operation)

    assert (
        await reconcile_operation(
            operation, store=store, source_for=source_for, referenced=referenced,
            queue=queue, persist=persist,
        )
        == "abandoned"
    )
    assert deleted == []
    assert operation["status"] == "abandoned"
```

Change `test_orphan_after_remote_save_is_deleted_once` so the first call still returns `"deleted"`, and the persisted status is `"abandoned"` (the second call stays `"skipped"`). Delete `test_source_without_a_queued_command_is_queued_once`; `test_referenced_copy_is_attached_and_not_queued` replaces it. Change `test_another_source_referencing_the_object_is_retained` to expect `"attached"` and `operation["status"] == "attached"`.

```python
@pytest.mark.asyncio
async def test_due_query_uses_the_progress_lease(monkeypatch):
    from open_notebook.storage import upload_operations

    seen = []

    async def query(sql, params=None):
        seen.append((sql, params))
        return []

    monkeypatch.setattr(upload_operations, "repo_query", query)
    await upload_operations.reconcile_due_uploads(900)
    sql, params = seen[0]
    assert "progress_at < $cutoff" in sql
    assert "status IN ['uploading', 'stored']" in sql
    assert "created <" not in sql
    assert "cutoff" in params
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_original_upload_recovery.py -q`

Expected: FAIL. Migration 36 is missing. `reconcile_operation` still returns `queued` / persists `completed`. The due query still filters `created`.

- [ ] **Step 3: Write the migration and the status rules**

`open_notebook/database/migrations/36.surrealql`:

```surrealql
DEFINE FIELD IF NOT EXISTS progress_at ON TABLE original_upload_operation TYPE datetime DEFAULT time::now();
UPDATE original_upload_operation SET progress_at = created WHERE progress_at = NONE;
```

`36_down.surrealql`:

```surrealql
REMOVE FIELD progress_at ON TABLE original_upload_operation;
```

Register both in `AsyncMigrationManager` immediately after migration 35. Index 35 is file 36.

In `begin_original_upload`, set `"progress_at": datetime.now(timezone.utc)` on the created row. Add:

```python
async def touch_original_upload(operation_id: str) -> None:
    await repo_query(
        "UPDATE original_upload_operation SET progress_at = time::now() "
        "WHERE operation_id = $operation_id AND status IN ['uploading', 'stored']",
        {"operation_id": operation_id},
    )
```

Call `touch_original_upload(operation_id)` at the end of `finish_original_upload` after the `stored` update (or set `progress_at = time::now()` in that same UPDATE).

Replace the skip and the due query:

```python
if operation.get("status") in {"attached", "completed", "abandoned"}:
    return "skipped"
```

```python
rows = await repo_query(
    "SELECT * FROM original_upload_operation WHERE status IN ['uploading', 'stored'] "
    "AND progress_at < $cutoff",
    {"cutoff": cutoff},
)
```

In `reconcile_operation`, when `referenced(key)` is non-empty, persist `status="attached"` and return `"attached"`. Do not call `queue`. When `find_by_object_name` returns `None`, persist `status="abandoned"` and return `"abandoned"`. When the copy is deleted, persist `status="abandoned"` and return `"deleted"`. Leave `queue` in the function signature so existing test harnesses still pass it; do not call it.

`reconcile_due_uploads` counts: `deleted`, `abandoned`, `attached`, `skipped`. Remove `queued` and `retained`.

`ReconcileOriginalUploadsOutput` replaces `queued` and `retained` with `attached: int`. Update the command's DONE log to print `Attached` and `Abandoned`. Update `test_reconcile_command_logs_each_operation` if it asserts `output.deleted` only; keep that assertion. Fix any constructor call that still passes `queued=` or `retained=`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_original_upload_recovery.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add open_notebook/database/migrations/36.surrealql open_notebook/database/migrations/36_down.surrealql open_notebook/database/async_migrate.py open_notebook/storage/upload_operations.py commands/source_file_commands.py tests/test_original_upload_recovery.py
git commit -m "fix(storage): reconcile stored copies by lease, not as completed"
```

---

### Task 2: Folder rows

**Files:**
- Modify: `open_notebook/storage/original_files.py` (`FilesystemOriginalFileStore`)
- Modify: `open_notebook/storage/upload_operations.py` (`save_tracked_original`)
- Test: `tests/test_original_upload_recovery.py`

**Interfaces:**
- Consumes: `begin_original_upload`, `finish_original_upload` from Task 1.
- Produces: `FilesystemOriginalFileStore.allocate_object_name(filename: str) -> str`, `find_by_object_name(object_name: str) -> tuple[str, None] | None`. `save_tracked_original` records a row for `provider == "filesystem"` and for `sharepoint_embedded`.

The folder name is opaque (`{uuid}{suffix}`), chosen before any file exists, so the row can be written first. `original_filename` on the Asset stays the display name. Do not scan the uploads folder for files that have no row.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_folder_save_records_the_name_before_the_file(monkeypatch, tmp_path):
    from open_notebook.storage.original_files import FilesystemOriginalFileStore
    from open_notebook.storage import upload_operations

    order = []

    async def create(table, data):
        order.append(("record", data["provider"], data["object_name"], data["status"]))
        assert table == "original_upload_operation"
        return {"id": "original_upload_operation:1"}

    async def finish(sql, params):
        order.append(("finish", params.get("status") or "stored", params.get("item_key")))
        return []

    monkeypatch.setattr(upload_operations, "repo_create", create)
    monkeypatch.setattr(upload_operations, "repo_query", finish)
    store = FilesystemOriginalFileStore(tmp_path)
    staged = tmp_path / "staged.bin"
    staged.write_bytes(b"abcd")

    stored = await save_tracked_original(store, staged, "report.pdf", user_id="user:1")

    assert stored.provider == "filesystem"
    assert stored.key == order[0][2]
    assert order[0][1] == "filesystem"
    assert order[0][3] == "uploading"
    assert (tmp_path / stored.key).read_bytes() == b"abcd"
    assert order[-1][0] == "finish"
```

Also assert `store.find_by_object_name(stored.key) == (stored.key, None)` and `await store.find_by_object_name("missing.bin") is None`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_original_upload_recovery.py::test_folder_save_records_the_name_before_the_file -q`

Expected: FAIL. `save_tracked_original` returns before any row when `provider != "sharepoint_embedded"`. `allocate_object_name` does not exist.

- [ ] **Step 3: Implement the folder surface and remove the early return**

On `FilesystemOriginalFileStore`:

```python
def allocate_object_name(self, filename: str) -> str:
    suffix = Path(os.path.basename(filename)).suffix
    if suffix != Path(suffix).name or ".." in suffix:
        suffix = ""
    return f"{uuid.uuid4().hex}{suffix}"

async def find_by_object_name(self, object_name: str) -> tuple[str, None] | None:
    ref = OriginalFileRef(self.provider, object_name)
    try:
        path = self._path_for_ref(ref)
    except ValueError:
        return None
    if await asyncio.to_thread(path.is_file):
        return object_name, None
    return None
```

Change `_save` to accept `object_name: str | None`. When `object_name` is set, destination is `self.uploads_folder / object_name` after the same `relative_to(self.uploads_folder)` check `_path_for_ref` uses. Do not call `_reserve_path` in that branch. When `object_name` is `None`, keep `_reserve_path` for any caller that still saves without tracking. `save` passes `object_name` through; delete the `del object_name` line.

Replace the early return in `save_tracked_original`:

```python
async def save_tracked_original(...) -> StoredOriginal:
    object_name = store.allocate_object_name(filename)
    operation_id = await begin_original_upload(
        user_id=user_id,
        provider=store.provider,
        profile_id=getattr(store, "profile_id", None),
        container_id=getattr(store, "container_id", None),
        source_id=source_id,
        object_name=object_name,
    )
    try:
        stored = await store.save(staged_path, filename, object_name=object_name)
    except Exception:
        await touch_original_upload(operation_id)
        raise
    await finish_original_upload(operation_id, stored.key, stored.etag)
    return stored
```

`SharePointEmbeddedOriginalFileStore.allocate_object_name` already exists. The existing test `test_tracked_save_records_the_name_before_the_remote_call` must still pass: order stays record, save, finish. If `finish` now also calls `touch_original_upload`, the monkeypatched `repo_query` records both calls; assert the finish call that carries `item_key` is still present, and allow a second query.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_original_upload_recovery.py tests/test_source_storage_integration.py -q`

Expected: PASS. Filesystem uploads still land in the uploads folder. SharePoint tracking order is unchanged.

- [ ] **Step 5: Commit**

```bash
git add open_notebook/storage/original_files.py open_notebook/storage/upload_operations.py tests/test_original_upload_recovery.py
git commit -m "fix(storage): track folder copies with the same upload row"
```

---

### Task 3: Attach and complete in the existing transitions

**Files:**
- Modify: `api/source_ingestion_service.py` (`queue_managed_upload_source`)
- Modify: `commands/source_commands.py` (after both `_maybe_delete_original_after_success` returns)
- Modify: `open_notebook/storage/sharepoint_embedded.py` (`_save_session` chunk loop)
- Modify: `open_notebook/storage/upload_operations.py` if `save` needs an optional progress callback
- Test: `tests/test_sharepoint_connector_import.py`, `tests/test_original_upload_recovery.py`

**Interfaces:**
- Consumes: `touch_original_upload`, status `stored` from Task 1, folder rows from Task 2.
- Produces: `mark_original_attached(item_key: str, source_id: str)` used inside the existing SurrealDB transaction. `mark_original_completed(item_key: str)` sets `completed` only from `attached`.

A crash leaves either `stored` (no Source; Task 4's sweeper deletes the copy) or `attached` (Source Retry continues). There is no third outcome.

- [ ] **Step 1: Write the failing tests**

Connector claim transaction (`tests/test_sharepoint_connector_import.py`, beside the existing claim SQL assertions): the SQL string passed to `repo_query` for the claim commit contains `UPDATE original_upload_operation SET status = 'attached'` and `CREATE $source_id` in the same `BEGIN TRANSACTION` / `COMMIT TRANSACTION` string.

Computer-upload path: call `queue_managed_upload_source` with a `StoredOriginal` and no `version_id`. The single `repo_query` transaction string contains `CREATE`, `process_source`, and `status = 'attached'`. It is not two separate `source.save()` then `submit_command_job` calls for a managed upload.

`mark_original_completed`: a direct call with `item_key="item-1"` issues SQL containing `status = 'completed'` and `status = 'attached'` in the WHERE clause.

Progress: a fake store save that invokes an `on_progress` callback records a `touch_original_upload` call. In `sharepoint_embedded._save_session`, after each accepted chunk advances `offset`, call `on_progress` when it was passed. Folder `save` calls it once after the file is in place. `save_tracked_original` passes `lambda: touch_original_upload(operation_id)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_sharepoint_connector_import.py tests/test_original_upload_recovery.py -q -k "attached or completed or progress"`

Expected: FAIL. The claim transaction does not update `original_upload_operation`. The computer path still uses `queue_source`.

- [ ] **Step 3: Implement the two writes**

Add to `upload_operations.py`:

```python
def attached_update_sql() -> str:
    return (
        "UPDATE original_upload_operation SET status = 'attached', "
        "source_id = $source_id OR source_id, progress_at = time::now() "
        "WHERE item_key = $item_key AND status IN ['uploading', 'stored'];"
    )


async def mark_original_completed(item_key: str) -> None:
    await repo_query(
        "UPDATE original_upload_operation SET status = 'completed', progress_at = time::now() "
        "WHERE item_key = $item_key AND status = 'attached'",
        {"item_key": item_key},
    )
```

In the connector branch of `queue_managed_upload_source`, append `attached_update_sql()` inside the existing `BEGIN TRANSACTION` ... `COMMIT TRANSACTION` string, and pass `item_key=stored.key` in the params. Do not open a second transaction.

For the ordinary computer upload (`version_id` is None and `stored` was passed), stop calling `queue_source`. Build the same command payload `queue_source` builds, then one `repo_query`:

```python
await repo_query(
    "BEGIN TRANSACTION; "
    "CREATE source CONTENT $source_data; "
    "CREATE command CONTENT $command_data; "
    + attached_update_sql()
    + " COMMIT TRANSACTION;",
    {
        "source_data": source._prepare_save_data(),
        "command_data": {
            "app": "open_notebook",
            "name": "process_source",
            "args": args,
            "context": {},
            "status": "new",
        },
        "source_id": str(source.id) if source.id else None,
        "item_key": stored.key,
    },
)
```

SurrealDB assigns `source.id` on `CREATE source` only if the content includes an id. Ordinary uploads let the database generate the id today. Include the id only when `source_id` was passed (connector retry). For a new computer upload, `CREATE source CONTENT $source_data` without a preset id is the current behavior; the `attached` UPDATE matches `item_key`, which `finish_original_upload` already stored, so it does not need the new source id in the WHERE clause. Set `source_id` on the operation row when the create returned an id; if the transaction cannot return it, match on `item_key` only. Keep notebook `add_to_notebook` calls after the transaction, as the connector branch already does.

Do not wrap link or text sources. This transaction is only for a `StoredOriginal`.

In `commands/source_commands.py`, after each successful `_maybe_delete_original_after_success` call (the resume return and the normal success path), if `processed_source.asset` has `original_file_key`:

```python
from open_notebook.storage.upload_operations import mark_original_completed

key = processed_source.asset.original_file_key if processed_source.asset else None
if key:
    await mark_original_completed(key)
```

Use the source variable that is in scope on the resume path (`source`) the same way. A processing failure must not call `mark_original_completed`. The row stays `attached`, and source Retry runs `process_source` again.

Optional progress callback on `OriginalFileStore.save` is a keyword-only `on_progress: Callable[[], Awaitable[None]] | None = None`. SharePoint `_save_session` awaits it after `offset = nxt`. Filesystem `save` awaits it once after the replace. `save_tracked_original` passes the touch. Swallow nothing: a failed touch must not fail the upload; log and continue. The lease is an optimization, not the write path.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_sharepoint_connector_import.py tests/test_original_upload_recovery.py tests/test_source_storage_integration.py -q`

Expected: PASS. Connector claim fencing is unchanged. A failed computer upload while the process is alive still deletes the unreferenced copy.

- [ ] **Step 5: Commit**

```bash
git add api/source_ingestion_service.py commands/source_commands.py open_notebook/storage/upload_operations.py open_notebook/storage/sharepoint_embedded.py open_notebook/storage/original_files.py tests/test_sharepoint_connector_import.py tests/test_original_upload_recovery.py
git commit -m "fix(storage): attach the source and the upload row in one transaction"
```

---

### Task 4: Run the existing command on a timer

**Files:**
- Modify: `api/main.py` (lifespan, next to `_entra_group_sync_loop`)
- Modify: `api/routers/commands.py` (`_INTERNAL_COMMANDS`)
- Modify: `docs/ORIGINAL_FILE_STORAGE.md` (the `original_upload_operation` paragraph)
- Test: a new test in `tests/test_original_upload_recovery.py` or the existing main lifespan test if one covers the Entra loop

**Interfaces:**
- Consumes: command name `reconcile_original_uploads`, input `grace_seconds` default 900, from `commands/source_file_commands.py`.
- Produces: lifespan task started unconditionally after migrations. Interval 900 seconds. `submit_command("open_notebook", "reconcile_original_uploads", {"grace_seconds": 900})` is synchronous; do not await it. Cancel the task on shutdown the same way `entra_sync_task` is cancelled.

This task is forbidden until Tasks 1–3 are on the branch. The timer is always on. It is not behind an env flag. One run handles the folder and the container because both are rows in the same table.

- [ ] **Step 1: Write the failing test**

Patch `submit_command` and drive one iteration of the new loop helper with a sleep mocked to raise `CancelledError` after the first submit. Assert the call is `("open_notebook", "reconcile_original_uploads", {"grace_seconds": 900})`. Assert `api.routers.commands` rejects command name `reconcile_original_uploads` with HTTP 403, same as `cleanup_original_files`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_original_upload_recovery.py -q -k "timer or internal"`

Expected: FAIL. No loop helper. Generic command route still accepts the name.

- [ ] **Step 3: Implement the loop**

In `api/main.py`, copy the Entra loop shape:

```python
_UPLOAD_RECONCILE_INTERVAL_SECONDS = 900


async def _original_upload_reconcile_loop() -> None:
    while True:
        try:
            submit_command(
                "open_notebook",
                "reconcile_original_uploads",
                {"grace_seconds": 900},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"original_upload_reconcile submit failed: {exc}")
        await asyncio.sleep(_UPLOAD_RECONCILE_INTERVAL_SECONDS)
```

After migrations succeed, `asyncio.create_task(_original_upload_reconcile_loop())` next to the Entra task. Cancel it in the shutdown block. Do not gate it on `ENTRA_GROUP_SYNC_ENABLED`.

Add `"reconcile_original_uploads"` to `_INTERNAL_COMMANDS` in `api/routers/commands.py`. The dedicated route is Task 5. Until that route exists, the timer is the only submitter, which is the intended production path.

Replace the paragraph in `docs/ORIGINAL_FILE_STORAGE.md` that starts "SharePoint Embedded writes an `original_upload_operation` record". State: both stores write the row before the copy; `stored` means the store accepted the bytes; `attached` means a Source owns them; the API submits `reconcile_original_uploads` every 15 minutes; it deletes a managed copy only when no Source references it; it does not queue extraction and does not delete an external connector document.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_original_upload_recovery.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/routers/commands.py docs/ORIGINAL_FILE_STORAGE.md tests/test_original_upload_recovery.py
git commit -m "feat(storage): reconcile unattached copies on a startup timer"
```

---

### Task 5: Admin count and Run cleanup

**Files:**
- Modify: `api/routers/source_files.py`
- Modify: `frontend/src/lib/api/source-files.ts`
- Modify: `frontend/src/lib/hooks/use-source-files.ts`
- Modify: `frontend/src/app/(dashboard)/settings/components/SettingsForm.tsx`
- Modify: `frontend/src/app/(dashboard)/settings/components/SettingsForm.test.tsx`
- Modify: all 16 `frontend/src/lib/locales/*/index.ts`
- Test: `tests/test_source_file_cleanup.py` and `SettingsForm.test.tsx`

**Interfaces:**
- Consumes: `submit_command` / `CommandService.submit_command_job` for `reconcile_original_uploads`. Count query over `original_upload_operation`.
- Produces: `GET /api/source-files/unattached-copies` → `{"count": int}` admin only. `POST /api/source-files/unattached-copies/reconcile` → the same job id shape as `POST /source-files/cleanup`, admin only. UI label "Unattached copies" and button "Run cleanup".

The count is `uploading` plus `stored` only. Do not list object names, paths, or Graph ids. Do not include `attached` or `completed`. The button submits the same command the timer submits. It does not delete from the request process.

- [ ] **Step 1: Write the failing tests**

Backend: non-admin `GET /api/source-files/unattached-copies` is 403. Admin GET with two mocked rows (`uploading`, `stored`) returns `{"count": 2}`. The SQL contains `status IN ['uploading', 'stored']`. Admin POST calls `submit_command_job` with `"reconcile_original_uploads"` and `grace_seconds` 900.

Frontend: render the settings form as admin. The panel shows `settings.unattachedCopies` and the count from the mocked hook. The button text is `settings.runCleanup`. Clicking it calls the reconcile mutation. The panel does not render a file path.

en-US keys, inside `settings`:

```ts
unattachedCopies: "Unattached copies",
unattachedCopiesDesc: "Managed copies with no Source. Cleanup removes only those. Files that already have a Source stay for Retry.",
unattachedCopiesCount: "{{count}} unattached",
runCleanup: "Run cleanup",
```

Add the same four keys to `ar-SA`, `bn-IN`, `ca-ES`, `de-DE`, `es-ES`, `fr-FR`, `it-IT`, `ja-JP`, `pl-PL`, `pt-BR`, `ru-RU`, `th-TH`, `tr-TR`, `zh-CN`, and `zh-TW`. Translate the four strings. The parity test fails if a key is missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/ -q -k unattached`

And from `frontend/`: `npx vitest run src/app/(dashboard)/settings/components/SettingsForm.test.tsx`

Expected: FAIL. Route and panel do not exist.

- [ ] **Step 3: Implement the count and the button**

In `api/routers/source_files.py`, follow `submit_cleanup`: `require_admin` for both routes.

```python
rows = await repo_query(
    "SELECT count() AS count FROM original_upload_operation "
    "WHERE status IN ['uploading', 'stored'] GROUP ALL"
)
count = int(rows[0]["count"]) if rows else 0
```

POST submits `open_notebook` / `reconcile_original_uploads` / `{"grace_seconds": 900}` through `CommandService.submit_command_job` and returns the job id. Do not delete objects in the request.

Frontend: add `getUnattachedCopies` and `reconcileUnattachedCopies` on `sourceFilesApi`. Hooks `useUnattachedCopies` and `useReconcileUnattachedCopies` match `useCleanupPreview` / `useSubmitCleanup` (toast on success, invalidate the count query). In `SettingsForm.tsx`, render a sibling of `CleanupOriginalsPanel` in the same section:

```tsx
function UnattachedCopiesPanel() {
  const { t } = useTranslation()
  const { data, isLoading } = useUnattachedCopies()
  const submit = useReconcileUnattachedCopies()
  const count = data?.count ?? 0
  return (
    <div className="mt-6 space-y-3 rounded-md border border-border/60 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">{t('settings.unattachedCopies')}</h4>
        <p className="text-xs text-muted-foreground">{t('settings.unattachedCopiesDesc')}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {isLoading ? t('common.loading') : t('settings.unattachedCopiesCount', { count })}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={submit.isPending || isLoading} onClick={() => submit.mutate()}>
          {submit.isPending ? t('common.processing') : t('settings.runCleanup')}
        </Button>
      </div>
    </div>
  )
}
```

The button stays enabled at count 0 so an admin can run the command without a terminal. It does not claim Microsoft revocation and it does not list files.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/ -q -k "unattached or source_file"`

And from `frontend/`: `npx vitest run "src/app/(dashboard)/settings/components/SettingsForm.test.tsx" src/lib/locales/index.test.ts`

Expected: PASS. Locale parity passes.

- [ ] **Step 5: Commit**

```bash
git add api/routers/source_files.py frontend/src/lib/api/source-files.ts frontend/src/lib/hooks/use-source-files.ts frontend/src/app/(dashboard)/settings/components/SettingsForm.tsx frontend/src/app/(dashboard)/settings/components/SettingsForm.test.tsx frontend/src/lib/locales tests/test_source_file_cleanup.py
git commit -m "feat(settings): show unattached copies and run the same cleanup"
```

---

## Self-review

- Spec coverage: folder orphan (Task 2), SharePoint `stored` before a Source (Task 1, already `stored` on finish), lease not `created` (Task 1), in-progress chunk refresh (Task 3), one transaction (Task 3), timer after the status fix (Task 4), admin count without a file list (Task 5), external library items never deleted (constraint; reconciler never receives a library item id), source Retry and batch Retry unchanged (constraint).
- Sweeper-before-status: Task 4 is ordered after Tasks 1–3 and the plan forbids starting it early.
- Placeholder scan: no TBD. Migration number 36 is the next file after `35.surrealql`.
- Type consistency: status strings and `touch_original_upload`, `mark_original_completed`, `attached_update_sql`, command name `reconcile_original_uploads`, and `grace_seconds` 900 are the same in every task.
