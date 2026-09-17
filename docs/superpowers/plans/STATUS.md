# Plans — done / not done

Index of every file in this directory, with what actually landed on `main`.
Last verified: 2026-09-15 against branch `main` at commit `8ce0cd1` (post PR #14).

This file is a **status snapshot**, not a source of truth for what the plans
should contain. When a plan lands or its verdict changes, update the row here.

---

## ✅ Shipped to `main`

| Plan | Landed as | Evidence |
|---|---|---|
| [2026-08-03-wp2-entra-auth.md](2026-08-03-wp2-entra-auth.md) | WP2 (WBS 4.0–4.14) | `AuthProvider` in `open_notebook/auth/`, roles, [docs/AUTH.md](../../AUTH.md) |
| [2026-08-06-wp2b-sharing-acl.md](2026-08-06-wp2b-sharing-acl.md) | WP2b, rolled into WP3-00 | ACL layer + [docs/SHARING.md](../../SHARING.md) |
| [2026-08-07-wp3-00-wp2b-integration.md](2026-08-07-wp3-00-wp2b-integration.md) | WP3-00 (PR #10, merge `6699686`, 2026-09-03) | Redesign shell + sharing wired in |
| [2026-08-07-wp3-01-foundation-shell.md](2026-08-07-wp3-01-foundation-shell.md) | WP3-01 (PR #10) | Frontend shell + shadscan foundation |
| [2026-08-07-wp3-01b-branding.md](2026-08-07-wp3-01b-branding.md) | WP3-01b (PR #10) | Config-driven white-label |
| [2026-08-07-wp3-02-collection-libraries.md](2026-08-07-wp3-02-collection-libraries.md) | WP3-02 (PR #10) | Notebooks + sources libraries |
| [2026-08-07-wp3-03-research-workbench.md](2026-08-07-wp3-03-research-workbench.md) | WP3-03 (PR #10) | Notebook workbench |
| [2026-08-07-wp3-04-ask-search.md](2026-08-07-wp3-04-ask-search.md) | WP3-04 (PR #10) | Ask + search surface |
| [2026-08-07-wp3-05-output-studios.md](2026-08-07-wp3-05-output-studios.md) | WP3-05 (PR #10) | Podcasts / outputs |
| [2026-08-07-wp3-06-admin-auth-sharing.md](2026-08-07-wp3-06-admin-auth-sharing.md) | WP3-06 (PR #10) | Admin surfaces |
| [2026-08-07-wp3-07-hardening.md](2026-08-07-wp3-07-hardening.md) | WP3-07 (PR #10) | a11y + foundation hardening |
| [2026-08-07-wp3-redesign-roadmap.md](2026-08-07-wp3-redesign-roadmap.md) | Roadmap only — the 7 tickets above delivered it | — |
| [2026-08-13-ingestion-runtime-capabilities.md](2026-08-13-ingestion-runtime-capabilities.md) | PR #13 (merge `3c21361`) | `runtime_capabilities.py`: `docling_available`, `crawl4ai_available`, `crawl4ai_local_ready`, `crawl4ai_remote_configured`, `media_processing_available`, `engine_runtime_missing` + tests |
| [2026-08-13-notebook-source-documentation-truth.md](2026-08-13-notebook-source-documentation-truth.md) | PR #14 (squash `8ce0cd1`, 2026-09-15) | [docs/2-CORE-CONCEPTS/notebooks-sources-notes.md](../../2-CORE-CONCEPTS/notebooks-sources-notes.md): `Reusable` property (line 110), `Reusable Sources, Explicit Notebook Associations` decision (line 207), common questions (line 259), summary table (line 278), and Why-This-Matters framing (line 46) all match `PRODUCT.md:27` |
| [2026-08-17-library-keyset-pagination.md](2026-08-17-library-keyset-pagination.md) | Branch `feat/library-keyset-pagination` (commits `5000456` sources + `72edfa7` notebooks, 2026-09-15) — Tasks 1 + 2 complete | `api/pagination.py` cursor codec (opaque, versioned, URL-safe, SHA-256 fingerprint of filters); `GET /api/sources/library` + `GET /api/notebooks/library` (keyset predicates in SurrealQL, no `START`/`OFFSET`); `useSourceLibrary` + `useNotebookLibrary` `useInfiniteQuery` hooks; NotebookList Load more; 29+54 backend tests + 28 frontend tests + locale parity green; `GET /sources` and `GET /notebooks` complete-list APIs kept for dialogs (CommandPalette, GeneratePodcastDialog, SaveToNotebooksDialog, AddSourceDialog, NotebookAssociations, AddExistingSourceDialog, ContentSelectionPanel); Recently Viewed left capped |
| [2026-09-01-podcast-notebook-origin.md](2026-09-01-podcast-notebook-origin.md) | This session (2026-09-16) — all 8 steps complete | `PodcastEpisodeResponse` gets optional `notebook_id` + `notebook_name`; `get_podcast_episode` resolves the notebook name via `SELECT name FROM notebook WHERE id = $id`; new `tests/test_podcast_notebook_origin.py` (2 tests) + full podcast regression (63 pass); typed `PodcastEpisode.notebook_id?` / `notebook_name?`; `EpisodeDetail.tsx` header adds a `Badge` — `podcasts.fromNotebook` when linked, `podcasts.standaloneEpisode` when not; 2 new UI tests + locale parity across all 14 locales (`fromNotebook` + `standaloneEpisode`); frontend build + lint clean; backend ruff + mypy clean |
| [2026-08-13-source-notebook-relationship-integrity.md](2026-08-13-source-notebook-relationship-integrity.md) | Branch `fix/source-notebook-relationship-integrity` (2026-09-17) — all 4 tasks | `api/routers/notebooks.py` link lookup + unlink DELETE now use `in = $source_id AND out = $notebook_id` (matches migration 1's `TYPE RELATION FROM source TO notebook`); `Source.add_to_notebook` gains a check-then-relate idempotency guard so `api/routers/sources.py` re-ingest paths stop creating duplicate `reference` edges; migration 29 (`29.surrealql` / `29_down.surrealql`, registered in `AsyncMigrationManager`) dedupes any historical `(in, out)` pairs and defines `reference_pair_unique` UNIQUE index; new `tests/test_notebook_source_relationships.py` (4 tests) covers link direction, unlink direction, endpoint idempotency, and domain-layer idempotency; full backend suite 1119 pass / 4 skip, ruff clean |

---

## 🟡 Partial

| Plan | What shipped | What's missing |
|---|---|---|
| [2026-09-01-original-file-retention-governance.md](2026-09-01-original-file-retention-governance.md) | Landed via PR #17 (`86d6e93`, 2026-09-16) + follow-up branch `feat/retention-followups` (Tasks 1–7 fully; Task 8 automated gates green) | Task 8 Step 5 (manual product-verification matrix — needs a live running stack) and Step 6 (recording the exact passing-test totals in Remember and marking Definition-of-Done evidence). Every acceptance criterion the automated suite can prove is now proved. |

---

## 📋 Written, not implemented

| Plan | Verified evidence of "not started" |
|---|---|
| [2026-08-13-long-context-handling.md](2026-08-13-long-context-handling.md) | No `input_limit` / `max_input_tokens` / `context_status` / `reserved_output` anywhere under `open_notebook/` |
| [2026-09-05-orphan-command-reconciliation.md](2026-09-05-orphan-command-reconciliation.md) | `open_notebook/database/reconcile.py` does not exist; no `ORPHAN_ERROR_MESSAGE` in `commands/` |

Also referenced: a paired spec `2026-09-04-container-and-email-sources.md` (not yet in `docs/superpowers/specs/`) — no plan file, no `container` source type in the sources router.

---

## Not tracked by these plans (from CLAUDE.md master plan)

**WP4–WP8 work packages** — none started:
- WP4 Backend architecture map / decomposition
- WP5 Connectors
- WP6 Performance & sizing
- WP7 Deployment
- WP8 Onboarding

**WBS sharing follow-ons** (schema reserved in WP2b, no code):
- 4.20 Entra ID group sync
- 4.21 Full Graph org directory user picker
- 4.22 Public links / editor reshare / ownership transfer

**Legal / open items** (from CLAUDE.md):
- Customer ToS for model-weight + customer-configured endpoint responsibility (`LEGAL_DECISIONS.md` items 5–6)
- PRC-jurisdiction providers → opt-in per deployment (DeepSeek, DashScope, MiniMax)
- Re-verify `PROVIDER_TERMS.md` links before commercial launch

**Product gaps found while testing** (from CLAUDE.md):
- Uploaded `.html`, `.json`, `.png` without Docling are rejected
