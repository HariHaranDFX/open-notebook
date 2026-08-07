# WP3-05 Output Studios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Podcasts and Transformations as coherent output studios with addressable detail/playground state, visible queues, origin/configuration metadata, and scoped retry.

**Architecture:** Reuse existing hooks, profile dialogs, generation flow, and API contracts. Replace local-only tab/detail state with URL state where the artifact must be addressable. Add the already-supported single-episode client call; do not add backend endpoints.

**Tech Stack:** Next.js routes/search params, existing podcast/transformation hooks, PageFrame/PageHeader, Radix Tabs/Accordion, Vitest.

## Global Constraints

- Studio order: local subnavigation → creation/action header → active queue → artifact library → detail/playground inspector.
- Preserve queued, processing, completed, partial, failed, retry, delete, playback, transcript/outline, and configuration visibility.
- Generated outputs retain origin, model/profile configuration, status, and AI authorship.
- Cards are allowed for top-level templates/profiles; repeated episodes and transformations use rows.
- One primary creation action per active studio view.
- Episode details are URL-addressable. Transformation playground selection is URL-addressable.

---

### Task 1: Add addressable podcast episode detail

**Files:**
- Modify: `frontend/src/lib/api/podcasts.ts`
- Modify: `frontend/src/lib/api/query-client.ts`
- Modify: `frontend/src/lib/hooks/use-podcasts.ts`
- Create: `frontend/src/app/(dashboard)/podcasts/[id]/page.tsx`
- Create: `frontend/src/components/podcasts/EpisodeDetail.tsx`
- Create: `frontend/src/components/podcasts/EpisodeDetail.test.tsx`

**Interfaces:**
- Produces:

```ts
podcastsApi.getEpisode(episodeId: string): Promise<PodcastEpisode>
usePodcastEpisode(episodeId: string): UseQueryResult<PodcastEpisode>
```

- [ ] **Step 1: Write failing detail tests**

Cover completed playback/configuration, running progress, failed error with retry, legacy model snapshot fallback, deleted/404 return state, viewer playback without delete, and editor/owner actions after WP2b.

- [ ] **Step 2: Wire the existing backend endpoint**

Call `GET /podcasts/episodes/{episodeId}` through `apiClient`, use `QUERY_KEYS.podcastEpisode`, and reuse retry/delete mutations.

- [ ] **Step 3: Extract details from EpisodeCard**

Move outline, transcript, audio, model/profile snapshot, status, retry, and delete presentation into EpisodeDetail. Keep EpisodeCard temporarily as a row summary linking to `/podcasts/${encodeURIComponent(id)}`.

- [ ] **Step 4: Verify detail behavior**

Run `npm run test -- src/components/podcasts/EpisodeDetail.test.tsx src/components/podcasts/EpisodeCard.test.tsx`. Expected: pass.

### Task 2: Reshape the podcast studio

**Files:**
- Modify: `frontend/src/app/(dashboard)/podcasts/page.tsx`
- Modify: `frontend/src/components/podcasts/EpisodesTab.tsx`
- Modify: `frontend/src/components/podcasts/EpisodeCard.tsx`
- Modify: `frontend/src/components/podcasts/TemplatesTab.tsx`
- Modify: `frontend/src/components/podcasts/EpisodeProfilesPanel.tsx`
- Modify: `frontend/src/components/podcasts/SpeakerProfilesPanel.tsx`
- Create: `frontend/src/components/podcasts/EpisodesTab.test.tsx`

**Interfaces:**
- Consumes: PageFrame, PageHeader, existing generation/profile dialogs.
- Produces: URL mode `?view=episodes|templates` and row-based queue/library.

- [ ] **Step 1: Write failing studio tests**

Assert the URL selects the view, Generate episode is the sole primary action in Episodes, running/pending groups precede completed/failed artifacts, refresh is secondary, failed rows expose retry, and templates keep speaker/episode profile creation and editing.

- [ ] **Step 2: Replace local view state with URL state**

Default to `episodes`; preserve unrelated query params. Use PageHeader and local tabs. Convert summary badges into a compact status summary and repeated episode cards into rows with visible status, profile, created time, playback/detail link, and permitted actions.

- [ ] **Step 3: Keep profile cards bounded and useful**

Profile objects may remain cards because they are top-level visual configurations. Apply foundation radii/borders, remove decorative rounded-xl containers, and retain model setup warnings and usage constraints.

- [ ] **Step 4: Verify podcasts**

Run podcast tests, locale parity, lint, and build. Expected: all pass.

### Task 3: Make the transformation studio addressable

**Files:**
- Modify: `frontend/src/app/(dashboard)/transformations/page.tsx`
- Modify: `frontend/src/app/(dashboard)/transformations/components/TransformationsList.tsx`
- Modify: `frontend/src/app/(dashboard)/transformations/components/TransformationCard.tsx`
- Modify: `frontend/src/app/(dashboard)/transformations/components/TransformationPlayground.tsx`
- Modify: `frontend/src/app/(dashboard)/transformations/components/TransformationsList.test.tsx`
- Create: `frontend/src/app/(dashboard)/transformations/components/TransformationPlayground.test.tsx`

**Interfaces:**
- Produces URL state `?view=library|playground&transformation=<encoded-id>`.

- [ ] **Step 1: Write failing URL/playground tests**

Assert selection writes both query params, reload restores the selected transformation, a deleted ID yields a recoverable not-found state, Back to library preserves list state, and admin-only default prompt remains gated.

- [ ] **Step 2: Replace local tab/selection state**

Derive view and selected ID from search params. Render PageHeader, local tabs, transformation rows, and playground inspector. Keep editor dialog and all transformation hooks unchanged.

- [ ] **Step 3: Make transformation rows explicit**

Show title, description, default badge, model, updated time, Edit, and Test in playground. The create action is primary; refresh and default-prompt editing are secondary/admin actions.

- [ ] **Step 4: Verify transformations**

Run targeted tests, locale parity, lint, and build. Expected: all pass.

### Task 4: Visual verification and commit

- [ ] **Step 1: Inspect studios**

At all four required widths/themes, verify queue ordering, long titles, progress/error/retry, playable completed episode, addressable detail, profile grids-to-lists, transformation URL restore, focus, reduced motion, and 200% zoom.

- [ ] **Step 2: Commit**

```powershell
git add frontend/src
git commit -m "feat(frontend): redesign output studios"
```
