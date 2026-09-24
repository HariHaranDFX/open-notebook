# Handoff

## State
I am implementing approved WP5 release hardening on branch `codex/wp5-sharepoint` in this worktree; `main` is untouched. HEAD `3d45efe`. Tracker: `docs/superpowers/plans/2026-09-24-wp5-release-hardening.md` (Tasks 1–2 checked). Detailed committed next-model instructions: `docs/superpowers/plans/2026-09-24-wp5-remaining-implementation-handoff.md`.
Task 1 (MSAL cache/lifecycle) and Task 2 (safe/idempotent imports and claim fencing) are committed and scoped reviews approved. Fresh focused backend suite: 84 passed, 2 dependency warnings; Ruff, MyPy (232 files), license guard pass. This is not final release verification.

## Next
1. Read the detailed handoff, then start Task 3's storage spec amendment and RED tests. I analyzed Task 3 but made no storage code change yet; Task 4 upload sessions/recovery follows.
2. Implement Task 5 existing-theme UI/16 locales and Task 6 Compose/env/image updates using `datafabricx/open-notebook-commercial`, local builds, immutable pull tag, no active `lfnovo`.
3. Task 7 complete backend/frontend/static/Compose tests, live SurrealDB+worker/Microsoft tenant checks, whole-branch review and user testing. Do not merge, delete branch, or publish image without approval.

## Context
Connector delegated identity and app-only original storage remain separate; never delete external SharePoint items. Migration 33 leaves dormant encrypted legacy tokens pending owner reconnect; table-wide deletion was rejected. No live tenant credentials. Preserve ignored `.env` secrets; main `.env` rollout is after merge. Follow Ponytail, Karpathy, Superpowers/TDD, Remember and verification skills. Account weekly usage reached 97%; another model may need to continue.
