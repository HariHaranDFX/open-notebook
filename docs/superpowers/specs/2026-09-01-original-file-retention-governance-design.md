# Original File Retention Governance Design

**Status:** Approved for planning on 2026-09-01; implementation has not started.

## Problem

Open Notebook currently represents retention with the admin-only `auto_delete_files` yes/no setting, while upload requests also carry a `delete_source` boolean. The UI hard-codes that request to false, the graph may delete a file immediately after extraction, and the source API exposes the server's `asset.file_path`. Those behaviors create four problems:

1. the administrator and source owner do not have a clear, authoritative policy;
2. deletion can happen before the complete processing command succeeds;
3. an existing setting change has ambiguous retroactive consequences; and
4. users see an internal server path instead of useful original-file metadata.

## Goals

- Give an administrator one explicit installation-wide original-file policy.
- Optionally let each source owner choose whether a new upload is retained.
- Snapshot the effective decision on every upload so later settings changes do not rewrite history.
- Delete a requested original only after source processing has completed successfully and `full_text` has been saved.
- Let an administrator clean up eligible retained originals for every user, including the administrator.
- Optionally let source owners clean up their own eligible retained originals.
- Keep internal storage paths private while preserving exact-original download when the file is retained.
- Migrate existing installations safely, without activating deletion from the legacy default.

## Non-goals

- Retrospectively deleting files when an administrator changes policy.
- Deleting extracted text, embeddings, insights, source records, or notebook links.
- Letting editors or viewers delete another owner's retained original.
- Moving uploads to object storage or adding file versioning in this task.
- A scheduled retention-age job. Bulk cleanup is explicit in the first release.

## Product Model

### Administrator policy

The administrator selects exactly one mode:

| Mode | New-upload behavior | Source-owner choice |
|---|---|---|
| `always_delete` | Delete after successful processing | Hidden and ignored |
| `user_choice` | Use the owner's selection; if omitted, use the admin default | Available |
| `always_keep` | Retain the original | Hidden and ignored |

When mode is `user_choice`, the administrator also selects an installation default: `keep` or `delete_after_processing`. The administrator separately controls whether source owners can manually clean up originals they own.

### Per-upload snapshot

At upload acceptance, the backend resolves the current policy and stores one effective action on the source asset:

- `keep`
- `delete_after_processing`

This snapshot is immutable for that processing attempt. Changing the administrator policy affects only later uploads. It never changes an existing source's action and never starts an automatic cleanup.

### Stored metadata

For uploaded sources, the domain asset stores:

```python
file_path: str | None                   # internal only; never serialized publicly
original_filename: str
original_size_bytes: int
original_file_action: Literal["keep", "delete_after_processing"]
original_deletion_started_at: datetime | None
original_deleted_at: datetime | None
original_deleted_reason: Literal[
    "retention_policy", "source_owner", "admin_cleanup"
] | None
```

The public API derives an `original_file_status`:

- `retained`: a safe, readable original exists;
- `deleted`: the application recorded a successful deletion;
- `missing`: metadata says the original should exist but the safe path is absent;
- `not_applicable`: URL and pasted-text sources.

The source record, extracted `full_text`, insights, embeddings, and notebook relationships remain after original deletion.

## Lifecycle

```text
upload accepted
  -> validate and save under the configured uploads root
  -> resolve administrator policy + permitted owner choice
  -> persist source and effective action snapshot
  -> queue processing
  -> extract and persist full_text
  -> apply transformations / queue embedding as today
  -> command reaches successful completion boundary
       -> action=keep: retain file
       -> action=delete_after_processing: safely delete file and record audit metadata

processing failure or retry
  -> retain the original
  -> do not set deletion metadata
  -> retry continues to have the input file
```

Deletion uses a recoverable two-phase marker: persist `original_deletion_started_at` and the intended reason, unlink the contained file, then persist `original_deleted_at` and clear `file_path`. A retry with a start marker and an existing file resumes unlinking; a retry with a start marker and an absent file finalizes the recorded deletion. A missing file without the marker is reported as `missing`, not falsely recorded as policy-deleted. This closes the unlink/database-save crash window without a new transaction system.

## Authorization

| Operation | Admin | Source owner | Editor | Viewer |
|---|---:|---:|---:|---:|
| Set installation policy | Yes | No | No | No |
| Choose action on own new upload in `user_choice` mode | Yes | Yes | No | No |
| Download a retained original when source is viewable | Yes | Yes | Yes | Yes |
| Delete one retained original | Yes | Only when owner cleanup is enabled | No | No |
| Preview/clean all eligible originals | Yes | No | No | No |
| Preview/clean own eligible originals | Yes | Only when owner cleanup is enabled | No | No |

Existing source visibility still governs downloads. Cleanup authorization is stricter than edit access and is based on `source.user_id`, not inherited notebook roles.

When authentication is disabled, the installation continues to behave as the single local administrator. The API must use the existing auth dependency conventions rather than introduce a second mode check.

## API Contract

### Settings

The admin settings response/update replaces the UI-facing legacy toggle with:

```json
{
  "original_file_policy": "always_keep | user_choice | always_delete",
  "original_file_user_default": "keep | delete_after_processing",
  "allow_source_owner_cleanup": false
}
```

An authenticated policy-summary endpoint exposes only what the upload and source UIs need:

```json
{
  "mode": "user_choice",
  "default_action": "keep",
  "can_choose_on_upload": true,
  "can_cleanup_own": true
}
```

### Upload

Multipart and JSON upload requests may include:

```json
{ "original_file_action": "keep | delete_after_processing" }
```

The field is honored only in `user_choice` mode and only for a source owner. Forced modes ignore it and apply the administrator policy. The API returns the effective action in source metadata so the outcome is inspectable.

### Public source asset

Source list and detail responses never include `file_path`. They return:

```json
{
  "asset": {
    "url": null,
    "original_filename": "research-paper.pdf",
    "original_size_bytes": 2481024,
    "original_file_action": "keep",
    "original_file_status": "retained",
    "original_deleted_at": null,
    "original_deleted_reason": null
  },
  "file_available": true
}
```

The existing download endpoint streams the exact retained bytes with the original filename in `Content-Disposition`. It returns a typed not-found/gone response when the original is deleted or missing and never includes the server path in an error.

### Cleanup

Cleanup has an explicit preview followed by execution. The preview reports aggregate counts and bytes only; it does not disclose other users' source names.

```json
{
  "scope": "mine | all",
  "eligible_files": 42,
  "eligible_bytes": 51904512,
  "skipped_running": 2,
  "skipped_failed": 1
}
```

Execution uses the existing background-command infrastructure for bounded batches. The cleanup command is internal-only: the generic command-submission endpoint must reject its name, while the authorized cleanup route submits it directly. The worker revalidates the requesting administrator or owner-cleanup setting before deleting. Admin `all` includes every owner and admin-owned source. Owner `mine` filters strictly to the current user's `source.user_id`. Each candidate is revalidated immediately before deletion, so preview is informative rather than authorization.

## Cleanup Eligibility and Safety

An original is eligible only when all are true:

- it belongs to an uploaded source;
- `full_text` has been saved and the processing command completed successfully;
- the source is not queued, running, retrying, or failed;
- the file resolves inside the configured uploads root;
- the file exists and is a regular file;
- no prior application deletion is recorded.

Every destructive helper receives a concrete source record and performs canonical containment checks immediately before `unlink`. It does not accept arbitrary paths from a request. It uses the two-phase deletion marker so a worker crash after `unlink` can be finalized safely on retry. A partial bulk-cleanup failure records only safe aggregate failure data, continues with other eligible items, and returns deleted/skipped/failed aggregates without leaking paths.

## User Interface

### Administrator settings

Replace the ambiguous auto-delete switch with an **Original uploaded files** section:

- three policy choices with concise consequences;
- the default-action control shown only for `user_choice`;
- an owner-cleanup permission switch;
- a cleanup preview showing eligible file count and storage size;
- a confirmation sheet before starting cleanup for all users.

The UI explicitly states: “Policy changes apply to future uploads only.”

### Upload sheet

In `user_choice` mode, show a compact **Original file after processing** choice. Use the administrator default initially. Forced modes show a read-only sentence explaining the effective behavior; they do not show a disabled fake choice.

### Source Details

For uploaded sources, replace the server path with:

- original filename;
- formatted original size;
- status pill (`Retained`, `Deleted after processing`, `Deleted by owner`, `Deleted by admin`, or `Missing`);
- download action only when retained and available;
- delete-original action only for an administrator or an allowed source owner.

The destructive action requires confirmation and clearly states that extracted content and the source record remain available.

## Migration and Compatibility

Existing settings records do not contain the new fields. Their model defaults must resolve to `always_keep`, irrespective of legacy `auto_delete_files=yes`. This prevents an old default from silently activating deletion after upgrade. The administrator must explicitly save a new policy before new automatic deletion can occur.

Keep `auto_delete_files` as a deprecated read-compatible domain field for one compatibility window, but stop returning or accepting it in the active settings contract after the new UI ships. Keep `delete_source` request parsing temporarily for old clients; translate it only when no new action is supplied and the administrator mode is `user_choice`. Forced policy always wins. Document both fields for later removal.

Existing uploaded sources may have only `asset.file_path`. Public response mapping derives the filename and size safely when the file exists, without returning the path. They are treated as effective action `keep` until explicitly cleaned up. No migration deletes or rewrites files.

## Acceptance Criteria

1. A fresh or upgraded installation retains originals until an administrator explicitly chooses otherwise.
2. New uploads snapshot one effective action; later settings changes do not modify it.
3. Requested deletion occurs only after successful processing with saved `full_text`; failed processing retains the file.
4. Admin cleanup covers eligible originals for all users, including the admin; owner cleanup is separately gated.
5. Editors and viewers cannot delete originals.
6. No source response, UI, log message exposed to clients, or error body reveals a server path.
7. Download returns the exact retained bytes and original filename.
8. Cleanup cannot unlink outside the configured uploads root and is safe under retries/races.
9. Source Details remains useful after deletion and accurately explains the file state.
10. Backend tests, frontend tests, lint, type checks, build, and locale parity pass.
