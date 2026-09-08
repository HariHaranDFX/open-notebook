# Orphan Command Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclaim commands stuck in `status='running'` from a crashed worker so the frontend stops polling forever and the user sees a real "worker restarted" error with a working Retry button.

**Architecture:** One SurrealQL `UPDATE` at worker-import time marks every currently-running command as `failed` with a fixed error message. Runs exactly once per worker startup because it lives in the command-modules import path the worker executes before it starts its LIVE-query loop. Reuses the existing `processing_info.error` → `SourceLibraryRow` inline-message chain — no frontend changes.

**Tech Stack:** SurrealDB, surreal-commands, loguru, pytest, unittest.mock.

## Global Constraints

- Assumes single-worker deployment (`surreal-commands-worker --max-tasks 5` is one process with N concurrent tasks). Multi-worker requires a heartbeat-based upgrade (see spec / follow-up section) and is out of scope here.
- No schema migrations. No changes to the surreal-commands library.
- Reconciliation must be idempotent — a second call finds nothing.
- Reconciliation must NOT fire on API-only reloads that leave the worker running — it lives in the worker's import path, not the API's lifespan.
- Error text is shared with the `_rewrite_extraction_error` / `_preflight_upload` family: user-actionable, single sentence, no server internals.
- Follow `ponytail` (smallest change that works), `karpathy-guidelines` (state assumptions, verify, surgical), `test-driven-development` (RED-GREEN-VERIFY), `verification-before-completion` (run tests + lint + typecheck before claiming done).

---

### Task 1: Reconciliation helper

**Files:**
- Create: `open_notebook/database/reconcile.py`
- Create: `tests/test_reconcile_orphans.py`

**Interfaces:**
- Consumes: `open_notebook.database.repository.repo_query` (existing async function).
- Produces:
  - `async def reconcile_orphan_commands() -> int` — returns the count of commands marked failed. Never raises: DB errors are logged and swallowed (a reconciliation failure must not prevent worker startup).
  - Module-level constant `ORPHAN_ERROR_MESSAGE: str` for reuse by tests and any future caller.

- [ ] **Step 1: Write the failing test — happy path (2 orphans reconciled)**

Create `tests/test_reconcile_orphans.py`:

```python
"""Tests for the orphan-command reconciliation on worker startup.

surreal-commands has no lease or heartbeat. When a worker crashes mid-run
its commands stay stuck at status='running' forever, and the frontend
polls them indefinitely. On worker startup we know no one owns those
commands (single-worker deploy), so a batch UPDATE marks them failed.
"""

from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.database.reconcile import (
    ORPHAN_ERROR_MESSAGE,
    reconcile_orphan_commands,
)


class TestReconcileOrphanCommands:
    @pytest.mark.asyncio
    @patch("open_notebook.database.reconcile.repo_query", new_callable=AsyncMock)
    async def test_reconciles_running_commands_and_returns_count(self, mock_query):
        mock_query.return_value = [
            {"id": "command:a", "status": "failed"},
            {"id": "command:b", "status": "failed"},
        ]

        count = await reconcile_orphan_commands()

        assert count == 2
        # Query targets status='running' and writes the shared error message.
        called_sql = mock_query.await_args.args[0]
        called_params = mock_query.await_args.args[1]
        assert "status = 'running'" in called_sql
        assert "UPDATE command" in called_sql
        assert called_params["msg"] == ORPHAN_ERROR_MESSAGE

    @pytest.mark.asyncio
    @patch("open_notebook.database.reconcile.repo_query", new_callable=AsyncMock)
    async def test_no_orphans_returns_zero(self, mock_query):
        mock_query.return_value = []
        assert await reconcile_orphan_commands() == 0

    @pytest.mark.asyncio
    @patch("open_notebook.database.reconcile.repo_query", new_callable=AsyncMock)
    async def test_repo_errors_are_swallowed_and_return_zero(self, mock_query):
        """A reconciliation failure must NOT block worker startup -- the worker
        should log and continue so it can still pick up 'new' commands."""
        mock_query.side_effect = RuntimeError("DB unreachable")
        assert await reconcile_orphan_commands() == 0

    def test_error_message_is_user_actionable(self):
        """Shared with _preflight_upload / _rewrite_extraction_error family:
        single sentence, no server internals, tells the user what to do."""
        assert "retry" in ORPHAN_ERROR_MESSAGE.lower()
        assert "worker" in ORPHAN_ERROR_MESSAGE.lower()
        # No traceback fragments or file paths.
        assert "\n" not in ORPHAN_ERROR_MESSAGE
        assert "/" not in ORPHAN_ERROR_MESSAGE
        assert "\\" not in ORPHAN_ERROR_MESSAGE
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_reconcile_orphans.py -q`

Expected: FAIL with `ImportError: cannot import name 'reconcile_orphan_commands' from 'open_notebook.database.reconcile'` (module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `open_notebook/database/reconcile.py`:

```python
"""Startup reconciliation for orphaned surreal-commands.

surreal-commands has no lease/heartbeat mechanism: if a worker crashes
mid-execution, its in-flight commands stay stuck at ``status='running'``
forever and the source-card frontend polls them indefinitely. The
worker's own startup only picks up ``status='new'`` commands
(surreal_commands/core/worker.py:111), so those orphans are invisible
to it.

Reconciliation strategy: on worker startup we know no one owns the
running commands (single-worker deploy assumption), so a single
SurrealQL UPDATE marks them all as ``failed`` with a user-actionable
error. The existing message-forwarding chain (Source.get_processing_
progress -> /api/sources[/status] -> SourceLibraryRow inline render)
surfaces the message without any frontend change; user clicks Retry
and the flow picks up cleanly.

Multi-worker deploys need a heartbeat-based upgrade -- see the
follow-up section in the plan doc.
"""

from typing import Optional

from loguru import logger

from open_notebook.database.repository import repo_query

ORPHAN_ERROR_MESSAGE = (
    "Worker restarted while this source was processing. "
    "Click Retry to try again."
)


async def reconcile_orphan_commands() -> int:
    """Mark every ``status='running'`` command as ``failed``.

    Returns the count of reconciled commands (0 if none, or if the query
    failed). Never raises: a reconciliation failure at startup must not
    prevent the worker from picking up new commands. See module docstring
    for the single-worker assumption.
    """
    try:
        result = await repo_query(
            "UPDATE command "
            "SET status = 'failed', error_message = $msg "
            "WHERE status = 'running'",
            {"msg": ORPHAN_ERROR_MESSAGE},
        )
    except Exception as e:
        logger.opt(exception=True).warning(
            f"Orphan-command reconciliation query failed; skipping. Error: {e}"
        )
        return 0

    count = _row_count(result)
    if count > 0:
        logger.warning(
            f"Reconciled {count} orphan 'running' command(s) as failed "
            f"(worker crashed while they were in-flight)."
        )
    return count


def _row_count(result: Optional[object]) -> int:
    """UPDATE ... returns the affected rows in a SurrealDB result list.

    Kept separate so tests can assert the shape without depending on the
    live driver's exact return type across versions.
    """
    if isinstance(result, list):
        return len(result)
    return 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_reconcile_orphans.py -q`

Expected: `4 passed`.

- [ ] **Step 5: Ruff + mypy**

Run:

```bash
ruff check open_notebook/database/reconcile.py tests/test_reconcile_orphans.py
uv run python -m mypy open_notebook/database/reconcile.py
```

Expected: `All checks passed!` and `Success: no issues found in 1 source file`.

- [ ] **Step 6: Commit**

```bash
git add open_notebook/database/reconcile.py tests/test_reconcile_orphans.py
git commit -m "$(cat <<'EOF'
feat(worker): add orphan-command reconciliation helper

surreal-commands has no lease or heartbeat: when the worker crashes
mid-run, its in-flight commands stay stuck at status='running' forever
and the frontend polls them indefinitely. Add a small SurrealQL UPDATE
helper that marks all currently-running commands as failed with a
user-actionable message. Wired in at worker import in the next commit.

Never raises: a reconciliation failure at startup must not block the
worker from picking up new commands. Assumes single-worker deploy
(--max-tasks controls in-process concurrency, not process count);
multi-worker would need a heartbeat upgrade.
EOF
)"
```

---

### Task 2: Wire reconciliation into the worker import path

**Files:**
- Modify: `commands/source_commands.py` (add a bottom-of-file guarded call)

**Interfaces:**
- Consumes: `open_notebook.database.reconcile.reconcile_orphan_commands`.
- Produces: `commands.source_commands._reconciled_at_startup: bool` — module-level flag preventing double-run when both API and worker import the module in the same process (defence in depth; both processes calling reconcile is idempotent anyway).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_reconcile_orphans.py`:

```python
class TestWorkerImportHook:
    """The reconciliation must fire exactly once per worker process. We put
    it in commands/source_commands.py because that module is loaded when
    the worker's --import-modules commands runs at startup, before it
    enters its LIVE-query loop. Guard against double-import via a
    module-level flag so importing the module twice in one process
    (which happens: API also imports it, see api/main.py "Commands
    imported in API process") only reconciles once."""

    @pytest.mark.asyncio
    @patch("commands.source_commands.reconcile_orphan_commands", new_callable=AsyncMock)
    async def test_startup_hook_fires_reconciliation_once(self, mock_reconcile):
        """Directly invoke the private hook the module runs at import."""
        from commands.source_commands import _run_startup_reconciliation

        # Reset the guard so we can drive it deterministically.
        import commands.source_commands as sc
        sc._reconciled_at_startup = False

        await _run_startup_reconciliation()
        await _run_startup_reconciliation()

        assert mock_reconcile.await_count == 1
        assert sc._reconciled_at_startup is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_reconcile_orphans.py::TestWorkerImportHook -q`

Expected: FAIL with `ImportError: cannot import name '_run_startup_reconciliation'`.

- [ ] **Step 3: Add the guarded hook + fire it at module import**

Append to the bottom of `commands/source_commands.py` (after all existing definitions):

```python
# --- Startup reconciliation ---------------------------------------------------
# surreal-commands has no lease/heartbeat. When the worker crashes mid-run,
# its running commands stay stuck at status='running' forever and the
# frontend polls them indefinitely. This module is loaded by the worker
# at startup via --import-modules commands, BEFORE it enters its LIVE-query
# loop, so this is the correct seam to reconcile. See
# docs/superpowers/plans/2026-09-05-orphan-command-reconciliation.md and
# open_notebook/database/reconcile.py for the full rationale.

from open_notebook.database.reconcile import reconcile_orphan_commands

_reconciled_at_startup: bool = False


async def _run_startup_reconciliation() -> None:
    """Fire reconcile_orphan_commands() exactly once per Python process.

    Guarded by _reconciled_at_startup because api/main.py also imports
    this module (see the "Commands imported in API process" log line):
    both callers running the hook is idempotent at the DB level, but
    skipping the duplicate keeps the worker log clean.
    """
    global _reconciled_at_startup
    if _reconciled_at_startup:
        return
    _reconciled_at_startup = True
    await reconcile_orphan_commands()


try:
    import asyncio as _asyncio

    _asyncio.get_event_loop_policy().get_event_loop().create_task(
        _run_startup_reconciliation()
    )
except RuntimeError:
    # No running loop at import time (typical when the API imports us via
    # a sync path). The worker imports us inside its asyncio loop; the API
    # doesn't need to reconcile because it's not the owner of commands.
    pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_reconcile_orphans.py -q`

Expected: `5 passed`.

- [ ] **Step 5: Verify neighbors still pass**

Run:

```bash
uv run pytest tests/test_reconcile_orphans.py tests/characterization/test_source_ingestion_characterization.py tests/test_worker_preflight.py -q
```

Expected: All pass.

- [ ] **Step 6: Ruff + mypy on touched file**

Run:

```bash
ruff check commands/source_commands.py tests/test_reconcile_orphans.py
uv run python -m mypy commands/source_commands.py
```

Expected: `All checks passed!` and `Success: no issues found in 1 source file`.

- [ ] **Step 7: Commit**

```bash
git add commands/source_commands.py tests/test_reconcile_orphans.py
git commit -m "$(cat <<'EOF'
feat(worker): reconcile orphan commands on worker startup

Fire reconcile_orphan_commands() from commands/source_commands.py's
module load, guarded by a process-level flag so it runs exactly once
even though api/main.py also imports the same module. The worker
picks this module up via --import-modules commands before entering
its LIVE-query loop, which makes this the correct seam.

Manual verify: kill the worker mid-processing, restart it -- the
stuck 'Processing' card flips to 'Failed' with the "Worker restarted
while this source was processing. Click Retry to try again." message
within one status poll (~2s).
EOF
)"
```

---

### Task 3: Manual verification checklist and docs note

**Files:**
- Modify: `docs/DEV_SETUP.md` (add a short note under §10 or a new sub-section)

**Interfaces:**
- Documentation only.

- [ ] **Step 1: Add operator note**

Append to the FFmpeg section (or after it) in `docs/DEV_SETUP.md`:

```markdown
## 12. Orphan command reconciliation

The worker reconciles orphan `status='running'` commands at startup: if
the worker crashed mid-run last time, those commands are marked `failed`
with a "Worker restarted..." message the moment the worker imports the
`commands` module.

This is a **single-worker** design (matches `surreal-commands-worker
--max-tasks 5`, one process with N concurrent tasks). If you deploy
multiple worker processes, this reconciliation would race against
live jobs on other workers -- upgrade to per-worker heartbeat-based
reconciliation before scaling out.

Verify manually:

1. Upload a large source; watch the card go to Processing.
2. Kill the worker with Ctrl+C mid-run.
3. Restart the worker (`uv run --env-file .env surreal-commands-worker --import-modules commands --max-tasks 5`).
4. Within ~2 seconds the card flips to Failed with the reconciliation message.
5. Click Retry; a fresh command is submitted and processing continues.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEV_SETUP.md
git commit -m "docs(dev): document orphan-command reconciliation on worker startup"
```

---

## Follow-up (out of scope, tracked for the next branch)

**Multi-worker heartbeat-based reconciliation** — needed when we grow past a single `surreal-commands-worker` process. Approach:

1. Add `heartbeat_at: datetime | null` field to the command record via a new SurrealDB migration.
2. Worker writes `heartbeat_at = time::now()` every 10 s on each in-flight command (either via a small wrapper around `CommandService.execute_command`, or a per-command loop).
3. Startup reconciliation upgrades: `UPDATE command SET status='failed' WHERE status='running' AND heartbeat_at < time::now() - 60s`. Live jobs on other workers keep their heartbeats fresh and survive.
4. Alternative: fork surreal-commands to add native lease semantics (rejected here — big blast radius; upstream gap doesn't warrant a fork yet).

Branch: `feat/worker-heartbeat-reconciliation` (not started).
