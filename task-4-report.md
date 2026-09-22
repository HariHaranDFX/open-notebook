# Task 4 report: retention, deletion, configuration, and operator docs

## Result

Original-file deletion now has one provider-neutral, two-phase path shared by
post-processing retention, explicit original deletion, cleanup jobs, and full
`Source.delete()`. A provider/configuration failure preserves the Source,
deletion-start marker, and storage reference for retry. Legacy outside-root
paths are refused, repeated deletion is idempotent, and SharePoint-backed
objects never pass through `Path.unlink`.

Cleanup preview/submission and worker execution now recognize both legacy
`file_path` assets and provider/key assets. Full deletion targets only Open
Notebook's managed storage key; an inbound connector URL/item ID is never sent
to the storage provider's delete operation.

## RED evidence

Command:

```text
uv run pytest tests/test_source_file_cleanup.py tests/test_source_storage_deletion.py -q
```

Result before implementation: **5 failed, 17 passed**.

Failing behaviors:

- `test_preview_includes_provider_backed_originals_without_file_path`
- `test_provider_boolean_results_are_handled[False-True-already_deleted-0]`
- `test_configuration_failure_retains_retry_marker_and_reference`
- `test_full_source_delete_removes_managed_copy_not_connector_item`
- `test_full_source_delete_stops_when_provider_delete_fails`

## GREEN and regression evidence

- Focused Task 4 tests: **23 passed, 2 warnings**.
- Required storage regression suite: **68 passed, 2 warnings**.
- Existing Source deletion domain slice after intentional expectation updates:
  **3 passed, 39 deselected, 1 warning**.
- Required Ruff command: **All checks passed**.
- Supplemental Ruff check for the two additional modified Python files
  (`commands/source_file_commands.py`, `tests/test_source_file_cleanup.py`):
  **All checks passed**.
- `git diff --check`: **passed**.

The warnings are pre-existing third-party deprecations from
`surreal_commands`/Pydantic and Starlette's TestClient compatibility layer.

## Files

- `api/source_file_service.py`: generalized the two-phase helper across recorded
  providers and defined false/exception outcomes without clearing retry state.
- `open_notebook/domain/notebook.py`: routed full Source deletion through the
  shared helper and stopped database deletion after unsafe/provider failure.
- `commands/source_file_commands.py`: accepted provider/key cleanup candidates.
- `api/routers/source_files.py`: selected provider/key cleanup candidates even
  when they have no legacy `file_path`.
- `tests/test_source_storage_deletion.py`: covered explicit, retention, cleanup,
  retry, idempotency, full Source deletion, and connector isolation boundaries.
- `tests/test_source_file_cleanup.py`: covered provider-backed preview selection.
- `tests/test_domain.py`: updated two Source deletion expectations to require a
  managed in-root path and retain the Source for unsafe paths.
- `.env.example`, `docker-compose.yml`: exposed storage selection and the four
  SharePoint Embedded storage credentials.
- `docs/ORIGINAL_FILE_STORAGE.md`: documented setup, permissions, limits,
  ownership, deletion, recycle-bin, and backup semantics.
- `docs/7-DEVELOPMENT/architecture.md`: documented the storage/materialization
  boundary in the source-processing architecture.

## Authorized plan variances

1. `commands/source_file_commands.py` was added because the cleanup worker's
   legacy `asset.file_path` gate skipped every provider-backed candidate.
2. `api/routers/source_files.py` was added because both cleanup preview and
   submission build candidates there; changing only the worker would leave
   provider-backed originals undiscoverable.
3. Two assertions in `tests/test_domain.py` were intentionally updated after a
   broader regression check found they required unsafe outside-root deletion and
   database deletion after cleanup failure, both contrary to Task 4's contract.

## Tradeoffs and concerns

- The helper calls `exists()` before `delete()`. This distinguishes an already
  absent object from a failed `delete()` result at the cost of one provider
  request; both operations remain idempotent.
- Provider exceptions are converted to the safe `"error"` outcome without
  logging credentials, opaque keys, paths, or raw Graph bodies.
- SharePoint Embedded continues to use simple upload because the default 100 MiB
  application cap is below the 250 MiB threshold. Raising the cap above that
  threshold requires upload-session support.
- Remote restore is intentionally delegated to Microsoft 365 recycle-bin,
  retention, compliance, and backup policy; Open Notebook does not implement a
  second remote backup mechanism.
