# WP3 app-redesign UI polish (post-WP3-06, user-requested) — Progress Ledger

Branch: codex/wp3-app-redesign. On top of the reviewed WP3-00..06 packages; NOT pushed (main is PR-only). Interactive UI/UX polish; each change = one reviewable commit, verified green (targeted tests + 14-locale parity + lint + build) before committing. Live a11y/visual sweep still owed → WP3-07 (in-app browser is behind Entra login; verification here is tests/lint/build only).

Arc (2026-08-24 → 2026-08-25):
- d7f4120 — Settings became a MODAL (SettingsDialog + use-settings-dialog); Models/Groups stay standalone pages.
- 254fdf9 — app-wide modal pointer-events bug fixed via shadcn-documented `modal={false}` on the shared dropdown-menu wrapper (live-verified).
- 5cef6f7, e87a7bb — close-X kept clear of content/header actions; standardized dialog button spacing; squared the share Sheet.
- f361e49, f319ac9 — Settings General/Advanced redesigned (row-based SettingRow, `?` help popovers, maintenance block, Preferences = Appearance+Language); normal-case rail/Docling labels.
- 0d84b05 — Groups → two-pane manager (list + members detail, create dialog, ⋯ delete, empty states); +4 i18n ×14, removed orphaned groups.members; new page.test.tsx (8 tests).
- 6fbd233 — Groups + Settings modal responsive (stack < md / < sm).
- 0e0ec29 → f3c19f2 — header divider bleed + tighter top space, then REVERTED per user (headers back to standard inset; Groups back to contained). Kept only the equal-height h-14 pane headers (e9fa53e).
- 126954c — button-consistency tidy: CredentialItem hover icons keyboard-accessible; removed redundant size restatements (AskWorkspace); dropped redundant h-9 (RecentlyViewed).
- a13aac2, 73c8842 — Groups counts (header, row, detail) → secondary count pills (match insights badge).
- 2177543 — Models page (settings/api-keys) redesigned: DefaultModelSelectors → labelled row list (Core/Advanced); CredentialItem actions → Test + ⋯ menu; Providers search + Configured/All filter + "N more available"; +4 i18n ×14; updated page.test.tsx.
- 14fddce — removed redundant clear-X on optional default-model rows (None clears); Providers search/filter equal height (h-9). HEAD.

Deviation recorded: auto-assign stays in the missing-required alert (recovery action; not always-visible → avoids overwriting user picks).

---

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
- Task 1: Access-origin metadata (backend resolver + shared types) — COMPLETE (commit 9c20265, review clean)
- Task 2: Stamp podcast episodes with notebook-inherited role (backend) — COMPLETE (commit f3493cd, review clean)
- Task 3: Wire the inherited role into the episode UI seam (frontend) — COMPLETE (commit 091c003, review clean)
  NOTE: also fixed a latent bug (test-forced, reviewer-confirmed) — DeleteEpisodeAction gate
  canDeleteSource→canEditContent so editors see delete, matching backend _assert_episode_edit_or_403
  (editor+) and SHARING.md (editor can delete podcasts). Only EpisodeCard/EpisodeDetail use it.
  REGRESSION (found during Task 4): T3 impl ran only EpisodesTab.test.tsx, so EpisodeCard.test.tsx +
  EpisodeDetail.test.tsx "editor withholds delete" assertions were left failing at 091c003 (hard-rule
  violation: full suite not green pre-commit). Fixed in commit 6954842 (flipped those 2 assertions to
  the corrected behavior). Full frontend suite now 82 files / 435 tests green. Process lesson: run the
  full suite (not just the named file) after any change to a shared component.
- Task 4: One administration hierarchy (nested settings) — COMPLETE (commit b0c433a, review clean)
- Task 5: Sharing as an explicit permission Sheet — COMPLETE (commit 51ec82d, review clean after 1 fix)
  Important fix: pending-close protection (brief Step 1) was skipped by impl; added guard + test (re-review ✅).
- Task 6: Login + global recovery redesign — COMPLETE (commit f84b0f7, review clean after 1 fix)
  Interrupted mid-work by usage limit; finished in place (partial tree was coherent + security removals done).
  Important fix: 403 read-only ContentUnavailable variant was built but unwired — wired 3 viewers
  (SourceDetailContent/SourceInsightDialog/NoteEditorDialog) via isForbiddenError + tests (re-review ✅).
- Task 7: Visual verification — automated gates green per task; live browser a11y/visual sweep DEFERRED to WP3-07
  (human/live-app gate, same posture as WP3-04/05). No separate commit (per-task commits satisfy it).

## PACKAGE COMPLETE (implementation + per-task reviews + final whole-package review). NOT pushed; no PR (main protected; user: stop for human review).
Commits (8): fba63aa (docs) · 9c20265 (T1) · f3493cd (T2) · 091c003 (T3) · 6954842 (T3 test-fix) · b0c433a (T4) · 51ec82d (T5, fix amended) · f84b0f7 (T6, 2 fixes amended). Final HEAD: f84b0f7.
Final review (opus, 5e52da4..f84b0f7): READY TO MERGE — 0 Critical, 0 Important. Central invariant verified: authorization unchanged everywhere; new resolvers provably equal to enforcement helpers; UI gates now match backend (no over-permit); no diagnostic leakage; 14-locale parity; no new deps; Task 2→3 seam wired end-to-end; 403 variant reachable.
Verification at HEAD: frontend 468/468 (83 files) + lint 0 err + build clean; backend targeted 72 passed.
Deferred to WP3-07 (per plan): live browser a11y/visual sweep (200% zoom, reduced motion, light/dark, keyboard on running app). Also fold auth-store.ts:192 raw "Network error: {message}" branch into the fixed-safe-copy treatment.

## Minor findings (final whole-branch review triage)
- T1 (sources.py:693-699,741-747): 404→403 block from assert_can_edit_source_or_403 duplicated verbatim in update_source + retry_source_processing (~7 lines, inlined to avoid a 2nd query). Candidate `_require_editor(summary)` helper.
- T1 (access-role.ts describeAccess): 'notebook' origin falls back to '' when origin_label missing, while 'group' falls back to t('sharing.group'); cosmetic, low-probability (backend omits label only if notebook.name is falsy).
- T1 (ownership.py:381-386): source linked to multiple notebooks with equal winning role uses `>` not `>=`, so the shown notebook label is query-order-dependent on ties. No auth/role impact; UX-cosmetic.
- T2 (podcasts list endpoint): notebook owner queried twice per episode (filter_episodes_by_access + effective_role_for_episode) — spec-directed N+1 doubling. Candidate: cache resolved notebook-owner per unique notebook_id within the list loop.
- T4 (api-keys/page.tsx): PageFrame with no width prop defaults to `content` (max-w-1600); report called it "unconstrained". Non-issue at 1600px; align wording/width if desired.
- T4 (CommandPalette.tsx, EmbeddingModelChangeDialog.tsx): still navigate to legacy /advanced (redirects correctly to /settings/advanced, so not broken; out of Task 4 scope). Optional: repoint directly.
- T5 (ShareSheet revoke confirm): names resource by TYPE ("Notebook"/"Source"), not title — ShareSheetProps carries no name; defensible, but thread a title if product wants literal naming.
- T5: stale showShareDialog/setShowShareDialog state names left in 4 callers post-rename (cosmetic, no functional ShareDialog ref remains).
- T5: 13 non-English locales for the 4 new sharing keys are AI-authored (not native-reviewed) — standing pre-launch item.
- T6 (LoginForm.test.tsx:66-68): getConfig "must-not-be-called" mock guard is now inert (LoginForm no longer imports @/lib/config); harmless soft-guard.
- T6: all new-key non-English locales AI-authored (standing pre-launch native-review item, same as T5).

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
