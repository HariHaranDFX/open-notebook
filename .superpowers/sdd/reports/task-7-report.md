# Task 7 Report — Ownership filters on notebooks and sources

## Status
Complete.

## What changed
- `api/auth/deps.py`: `current_user_optional()`, `auth_enforces_ownership()`.
- `api/ownership.py` (new): `ownership_where()` (SurrealQL WHERE fragment for
  lists) and `assert_owner_or_404()` (single-record check, 404 never 403).
- `notebooks.py` / `sources.py`: create stamps `user_id`/`client_id` when a
  user is present; list queries filter by owner (also excludes NULL
  `user_id` rows, i.e. pre-migration orphans, for free); get/update/delete/
  add-remove-source/delete-preview/recently-viewed enforce ownership.
- `notes.py`: notebook-scoped list/create enforce the parent notebook's
  ownership. `insights.py`: get/delete/save-as-note enforce the parent
  source's ownership.
- All no-ops when auth is disabled (today's global behaviour, matches
  `tests/conftest.py`'s `OPEN_NOTEBOOK_PASSWORD=""`).
- Fixed Task 2's P3: `Notebook`/`Source._prepare_save_data()` now coerce
  `user_id` to a `RecordID` at the save boundary (mirrors the existing
  `Source.command` pattern), so the DB gets a real `record<user>` link, not a
  bare string, while `.user_id` stays a plain `str` on the model.

## Known gaps (out of scope, flagged for WP2b/follow-up)
- `search.py` (global text/vector search) isn't scoped by owner — would
  require changing the `fn::text_search`/`fn::vector_search` SurrealDB
  functions, not a router-level change.
- `podcasts.py` and note/insight endpoints addressed by id alone (no
  notebook/source context) aren't ownership-checked — notes have no owner
  column (spec: access via parent only).
- `SourceInsight.save_as_note(notebook_id)` doesn't verify the target
  notebook is owned by the caller (a scoped write, not a data leak).

## Tests
`tests/test_ownership_notebooks.py` (new, 18 tests): create-stamping,
list-filtering (query/bind-var assertions), get/update/delete 404-for-non-owner
vs 200-for-owner, and auth-disabled preserves global behaviour, for both
notebooks and sources.

Fixed 2 pre-existing unit tests whose target function signature legitimately
changed (`_resolve_source_file` now takes `request`) —
`tests/test_source_path_containment.py`. Not a characterization test; this is
the intended new signature.

Full suite: `uv run pytest tests/ -q` → 843 passed, 9 failed (all
`test_models_api.py::TestModelsProviderAvailability`, pre-existing on `main`
before this task — mock `side_effect` arity, unrelated to auth/ownership).
`ruff check` and `mypy` clean on all touched files.

## Verification
`uv run pytest tests/test_ownership_notebooks.py tests/test_source_path_containment.py tests/characterization/ tests/test_crud_404.py tests/test_migration_24_auth_schema.py -q`
→ 117 passed.
