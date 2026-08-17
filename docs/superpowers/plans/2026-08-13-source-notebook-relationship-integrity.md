# Source–Notebook Relationship Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make linking a source to a notebook idempotent at the API and database layers while preserving the supported ability to share one source across multiple notebooks.

**Architecture:** Keep the existing `source->reference->notebook` graph model and endpoints. Correct the edge-direction predicates, add a unique `(in, out)` database invariant after removing any existing duplicate pairs, and characterize link, unlink, sharing, and notebook-deletion behavior.

**Tech Stack:** FastAPI, SurrealDB graph relations, pytest.

## Global Constraints

- A source may belong to multiple different notebooks.
- The same source may have at most one `reference` edge to the same notebook.
- Repeating an identical link request must succeed without creating another edge.
- Preserve owner/editor/viewer authorization and source visibility checks.
- Do not change source processing, embeddings, or stored source content.

---

### Task 1: Characterize idempotent link and unlink behavior

**Files:**
- Create: `tests/test_notebook_source_relationships.py`
- Inspect: `api/routers/notebooks.py:386-468`

**Interfaces:**
- Consumes: `POST /api/notebooks/{notebook_id}/sources/{source_id}` and `DELETE /api/notebooks/{notebook_id}/sources/{source_id}`.
- Produces: regression coverage proving the edge direction is `in=source`, `out=notebook` and repeated linking leaves one edge.

- [ ] **Step 1: Write failing endpoint tests**

  Mock `Notebook.get`, `Source.get`, permission helpers, and `repo_query`. Assert the existing-edge query receives `source_id` for `in` and `notebook_id` for `out`; return an existing edge and assert no `RELATE` query is issued.

- [ ] **Step 2: Add the repeated-request characterization**

  Exercise the endpoint twice against a test database and assert:

  ```sql
  SELECT count() AS count
  FROM reference
  WHERE in = $source_id AND out = $notebook_id
  GROUP ALL;
  ```

  returns `count = 1`.

- [ ] **Step 3: Run the focused tests and confirm the direction test fails**

  Run: `uv run pytest tests/test_notebook_source_relationships.py -q`

  Expected before the fix: the endpoint queries `out = $source_id AND in = $notebook_id` and the direction assertion fails.

### Task 2: Correct the API predicates

**Files:**
- Modify: `api/routers/notebooks.py:386-468`
- Test: `tests/test_notebook_source_relationships.py`

**Interfaces:**
- Consumes: `source_id` and `notebook_id` path parameters.
- Produces: idempotent link and unlink operations over `reference.in=source`, `reference.out=notebook`.

- [ ] **Step 1: Correct the existing-edge lookup**

  Use:

  ```sql
  SELECT * FROM reference
  WHERE in = $source_id AND out = $notebook_id
  LIMIT 1;
  ```

- [ ] **Step 2: Correct the unlink predicate**

  Use:

  ```sql
  DELETE reference
  WHERE in = $source_id AND out = $notebook_id;
  ```

- [ ] **Step 3: Verify focused API behavior**

  Run: `uv run pytest tests/test_notebook_source_relationships.py tests/test_crud_404.py -q`

  Expected: all tests pass; the second link is a no-op and unlink removes only the requested source/notebook pair.

### Task 3: Enforce uniqueness in SurrealDB

**Files:**
- Create: `open_notebook/database/migrations/29.surrealql`
- Create: `open_notebook/database/migrations/29_down.surrealql`
- Modify: `open_notebook/database/async_migrate.py`
- Test: `tests/test_notebook_source_relationships.py`

**Interfaces:**
- Consumes: existing `reference` relation rows.
- Produces: `reference_pair_unique`, a unique index over `in, out`.

- [ ] **Step 1: Add a migration test with an existing duplicate pair**

  Seed two identical `source->reference->notebook` rows, run migration 29, assert one row remains, and assert a direct duplicate `RELATE` is rejected by the database.

- [ ] **Step 2: Add migration 29**

  Deduplicate existing rows by `(in, out)`, retaining one edge per pair, then define:

  ```sql
  DEFINE INDEX IF NOT EXISTS reference_pair_unique
  ON TABLE reference FIELDS in, out UNIQUE;
  ```

- [ ] **Step 3: Add the down migration and register both files**

  The down migration removes only `reference_pair_unique`. Append migration 29 to both hard-coded lists in `AsyncMigrationManager`.

- [ ] **Step 4: Verify migration and relationship suites**

  Run: `uv run pytest tests/test_notebook_source_relationships.py tests/test_ownership_notebooks.py -q`

### Task 4: Run final relationship verification

**Files:**
- Verify: `api/routers/notebooks.py`
- Verify: `open_notebook/database/migrations/29.surrealql`
- Verify: `tests/test_notebook_source_relationships.py`

- [ ] **Step 1: Run final verification**

  Run: `uv run pytest tests/test_notebook_source_relationships.py tests/test_crud_404.py tests/test_ownership_notebooks.py -q`

- [ ] **Step 2: Confirm the documentation correction is tracked separately**

  Verify that `docs/superpowers/plans/2026-08-13-notebook-source-documentation-truth.md` remains an open roadmap item until the stale core-concepts guide is corrected.

- [ ] **Step 3: Commit**

  ```bash
  git add api/routers/notebooks.py open_notebook/database/migrations/29.surrealql open_notebook/database/migrations/29_down.surrealql open_notebook/database/async_migrate.py tests/test_notebook_source_relationships.py
  git commit -m "fix: enforce source notebook relationship uniqueness"
  ```
