# WP3-06 Administration, Authentication, and Sharing — SDD Progress Ledger

Branch: codex/wp3-app-redesign
Plan: docs/superpowers/plans/2026-08-07-wp3-06-admin-auth-sharing.md
Base commit (branch HEAD before this package): 5e52da4
Merge-base with main: 4967823
Started: 2026-08-23

## Controller decisions (pre-flight)
- WP2b is integrated on this branch (WP3-00). Every "after WP2b merge" marker is satisfied:
  `api/ownership.py` carries the grant helpers + `effective_role_for_notebook` (172);
  `api/models.py` NotebookResponse (20) / SourceResponse (366) carry `access_role`;
  `frontend/.../sharing/ShareDialog.tsx`, `settings/groups/page.tsx`, `lib/types/api.ts`,
  `lib/utils/access-role.test.ts` all present.
- ONE reviewable commit per task (user rule) OVERRIDES the plan's batch-commit-in-Task-7.
  Each task self-commits; Task 7 is visual verification only (its commit steps are then a no-op).
  Commit messages: T1 `feat(sharing): expose effective access origin`;
  T2 `feat(podcasts): expose notebook-inherited access role on episodes`;
  T3 `feat(podcasts): gate episode retry/delete on inherited access role`;
  T4 `feat(frontend): unify administration under nested settings`;
  T5 `feat(frontend): redesign sharing as a permission sheet`;
  T6 `feat(frontend): redesign login and global recovery states`.
- Tasks 2–3 depend only on the existing `effective_role_for_notebook`; independent of Task 1.
  Wire the real per-item role WITHOUT weakening auth — the API must still 403 a viewer
  (Task 2 test `test_notebook_viewer_delete_still_403` proves it). Additive `access_role` only;
  no `access_summary`/origin on episodes (YAGNI — the UI gate needs role alone).
- Live visual/a11y browser sweep (Task 7 Step 1) is a human/live-app gate → DEFERRED to WP3-07,
  same posture as WP3-04/05. Per-task automated gates (targeted tests + lint + build) run green
  before every commit.
- Do NOT push, do NOT open a PR (main is protected). Stop at package end for human review.
- i18n: every UI string via `t()`, present in all 14 locales, no orphaned keys; reuse existing
  keys before adding.

## Tasks
- Task 1: Access-origin metadata (backend resolver + shared types) — TODO
- Task 2: Stamp podcast episodes with notebook-inherited role (backend) — TODO
- Task 3: Wire the inherited role into the episode UI seam (frontend) — TODO
- Task 4: One administration hierarchy (nested settings) — TODO
- Task 5: Sharing as an explicit permission Sheet — TODO
- Task 6: Login + global recovery redesign — TODO
- Task 7: Visual verification (live sweep deferred to WP3-07) — TODO

---

# WP3-05 Output Studios — SDD Progress Ledger

Branch: codex/wp3-app-redesign
Plan: docs/superpowers/plans/2026-08-07-wp3-05-output-studios.md
Base commit (branch HEAD before this package): 52d751a
Merge-base with main: 4967823
Started: 2026-08-21

## Controller decisions (pre-flight)
- QUERY_KEYS.podcastEpisode already exists (query-client.ts:36) — reuse, don't add.
- Backend GET /podcasts/episodes/{id} already exists → getEpisode reuses PodcastEpisode type; no backend changes.
- Podcast payload has no access_role. EpisodeDetail takes optional role?: AccessRole and gates
  delete/retry via existing access-role.ts helpers, defaulting to full access. Live role wiring is WP3-06.
- Each task commits its own work (SDD review isolation); consistent with this branch carrying multiple commits per package.
- Task 4 visual/a11y browser sweep is a human/live-app gate (same posture as WP3-04's open item).

## Tasks
- Task 1: Add addressable podcast episode detail — COMPLETE
- Task 2: Reshape the podcast studio — COMPLETE
- Task 3: Make the transformation studio addressable — COMPLETE
- Task 4: Visual verification and commit — commit step satisfied by per-task commits; live visual/a11y sweep DEFERRED to WP3-07 (user, 2026-08-21)

## PACKAGE COMPLETE (implementation + review). Branch kept as-is, nothing pushed (user: stop for review).
Commits: f6e502a, 6f2569c, de774c3, 4373b17, 1b941fd. Full suite 80 files/415 tests green; lint 0 errors; build clean.
Follow-ups: WP3-07 live visual/a11y sweep (also covers WP3-04's still-open sweep); optional flip of roadmap/plan [ ]→[x] for WP3-04 & WP3-05; Minor triage items above (dropdown re-sync URL-wins, Templates dual-create → WP3-06).

## Minor findings (for final whole-branch review to triage)
- EpisodeDetail.tsx ~420 lines (same shape as code it replaced); candidate to split if it grows in Task 2.
- useRetryPodcastEpisode: the added invalidateQueries(podcastEpisode(id)) is redundant (refetchQueries on the list key already prefix-matches the nested single-episode key in react-query 5.83.0) but harmless + idiomatic (matches use-transformations.ts). Leave as-is unless trimming.

## Whole-branch review notes (triage at final review)
- Templates view has two primary "Create" buttons (speaker + episode profiles). Global constraint says one primary per view, but plan Task 2 Step 3 explicitly keeps both creations, and they are distinct object types in separate panels. Controller resolution: acceptable; WP3-06 may visually subordinate one. Not fixed in WP3-05.
- EpisodesTab compact summary uses <p> of <span>s (semantically a <dl> would fit); cosmetic only.

## Final whole-branch review (opus, 52d751a..4373b17): Ready to merge WITH FIXES → FIXED (commit 1b941fd)
- IMPORTANT #1 (capability regression): FIXED in 1b941fd. TransformationCard now renders the prompt in an ungated Collapsible (CollapsibleContent shows {transformation.prompt}); only Edit stays gated on can_edit. New TransformationCard.test.tsx asserts a can_edit:false transformation reveals the prompt with no edit control. Controller-verified: covering tests 19/19 transformation + 27/27 locales; lint 0 errors; build exit 0. (Controller also fixed a Radix tab-click test to use fireEvent.mouseDown per the repo pattern.)
- Minor to fix same pass: playground shows transformations.desc twice (PageHeader + CardDescription); setView('library') leaves stale ?transformation= param (handleBackToLibrary clears it) — make library URL canonical.
- Minor no-action (triaged): redundant invalidateQueries (benign/idiomatic/tested); dropdown re-sync clobber (URL-wins, post-merge/WP3-06); EpisodeDetail size; <p>/<span> summary; URL-mutation triplication.
- Task 4 visual/a11y sweep: DEFERRED to WP3-07 per user (2026-08-21).

## Completed
- Task 1: complete (commits f6e502a..6f2569c, review clean). Shared EpisodeActions module (StatusBadge/RetryEpisodeButton/DeleteEpisodeAction); /podcasts/[id] route; getEpisode + usePodcastEpisode; EpisodeCard is now a row.
- Task 2: complete (commit de774c3, review clean; both ⚠️ resolved — warning-token contrast passes AA light 5.4:1 / dark 6.1:1). Podcasts page URL-driven ?view=episodes|templates via PageHeader/PageFrame; queue-first episode rows + compact summary; profile Alert/panels re-tokenized to warning tokens (dark-mode bugfix); no i18n key changes.
- Task 3: complete (commit 4373b17, review clean; ⚠️ TranslationShape parity resolved by passing build). Transformations page URL-driven ?view=library|playground&transformation=<id>; recoverable not-found (deleted/unknown id → EmptyState + Back to library); TransformationCard now a row; +4 i18n keys (testInPlayground/notFound/notFoundDesc/backToLibrary) in all 14 locales. Minor (final-review triage): playground re-sync useEffect can revert a manual dropdown pick after refetch (URL-wins semantics, untested); URL-mutation triplication mirrors podcasts/page.tsx.

---

# Archived: WP2 SDD Progress Ledger (closed 2026-08-05, merged to main)
- WP2 Tasks 1–11 complete (AuthProvider → Entra BFF → ownership → frontend → AUTH.md → PR).
- Additional WBS 4.11–4.14 (transformation ownership, 403 messages, admin UI gating, sidebar active state).
