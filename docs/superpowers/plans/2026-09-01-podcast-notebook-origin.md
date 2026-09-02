# Podcast Notebook Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whether a podcast episode came from a notebook and, when linked, identify that notebook in the single-podcast header.

**Architecture:** Keep `episode.notebook_id` as the source of truth. Add optional origin fields to the single-episode API response, resolve the notebook name only in the detail endpoint, and render the result as a compact metadata pill beside the existing status/profile/created pills. A missing `notebook_id` is explicitly presented as a standalone episode; this changes presentation only and does not alter sharing or authorization.

**Tech Stack:** FastAPI, Pydantic, SurrealDB repository helpers, Next.js, TypeScript, React, Vitest, Testing Library, i18next.

**Spec:** `docs/SHARING.md`

## Global Constraints

- Podcast authorization remains inherited from `episode.notebook_id` plus episode ownership; do not add podcast grants.
- Do not expose notebook content or grants through the episode response.
- Use existing design tokens, `Badge`, and the compact header metadata row; add no new dependency.
- Every new UI string must exist in all locale files under `frontend/src/lib/locales/`.

---

### Task 1: Expose and display podcast notebook origin

**Files:**
- Modify: `api/routers/podcasts.py`
- Create: `tests/test_podcast_notebook_origin.py`
- Modify: `frontend/src/lib/types/podcasts.ts`
- Modify: `frontend/src/components/podcasts/EpisodeDetail.tsx`
- Modify: `frontend/src/components/podcasts/EpisodeDetail.test.tsx`
- Modify: `frontend/src/lib/locales/*/index.ts`

**Interfaces:**
- Consumes: `PodcastEpisode.notebook_id: Optional[str]` and the existing `GET /api/podcasts/episodes/{episode_id}` authorization guard.
- Produces: `PodcastEpisode.notebook_id?: string | null`, `PodcastEpisode.notebook_name?: string | null`, and a localized origin pill in `EpisodeDetail`.

- [ ] **Step 1: Write failing API response tests**

Create `tests/test_podcast_notebook_origin.py` using the existing podcast route test client and mocks. Cover both response shapes:

```python
def test_linked_episode_reports_notebook_origin(...):
    response = client.get("/api/podcasts/episodes/episode:1")
    assert response.status_code == 200
    assert response.json()["notebook_id"] == "notebook:1"
    assert response.json()["notebook_name"] == "Research notebook"


def test_standalone_episode_reports_no_notebook_origin(...):
    response = client.get("/api/podcasts/episodes/episode:1")
    assert response.status_code == 200
    assert response.json()["notebook_id"] is None
    assert response.json()["notebook_name"] is None
```

- [ ] **Step 2: Run the API tests and confirm the contract is missing**

Run: `uv run pytest tests/test_podcast_notebook_origin.py -q`

Expected: FAIL because `PodcastEpisodeResponse` does not yet contain `notebook_id` or `notebook_name`.

- [ ] **Step 3: Add the minimal detail-response origin fields**

Add optional fields to `PodcastEpisodeResponse`:

```python
notebook_id: Optional[str] = None
notebook_name: Optional[str] = None
```

In `get_podcast_episode`, after `_assert_episode_view_or_404`, resolve the linked notebook name only when `episode.notebook_id` is present:

```python
notebook_id = str(episode.notebook_id) if episode.notebook_id else None
notebook_name = None
if notebook_id:
    rows = await repo_query(
        "SELECT name FROM notebook WHERE id = $id",
        {"id": ensure_record_id(notebook_id)},
    )
    notebook_name = rows[0].get("name") if rows else None
```

Pass both values into the detail endpoint's `PodcastEpisodeResponse`. Leave list responses at the optional defaults because the origin is required only by the single-podcast page.

- [ ] **Step 4: Run the API regression tests**

Run: `uv run pytest tests/test_podcast_notebook_origin.py tests/test_podcast_access_role.py tests/test_ownership_notes_chat_podcasts.py -q`

Expected: PASS, including the existing inherited-role and authorization tests.

- [ ] **Step 5: Write failing UI tests for linked and standalone episodes**

Extend `EpisodeDetail.test.tsx` with two cases:

```tsx
it('shows the originating notebook in the header metadata', () => {
  render(<EpisodeDetail episode={makeEpisode({
    notebook_id: 'notebook:1',
    notebook_name: 'Research notebook',
  })} onDelete={vi.fn()} />)

  expect(screen.getByText('podcasts.fromNotebook')).toHaveAttribute('data-slot', 'badge')
})

it('labels an episode without a notebook as standalone', () => {
  render(<EpisodeDetail episode={makeEpisode()} onDelete={vi.fn()} />)
  expect(screen.getByText('podcasts.standaloneEpisode')).toHaveAttribute('data-slot', 'badge')
})
```

- [ ] **Step 6: Run the UI test and confirm the indicator is absent**

Run from `frontend/`: `npm run test -- src/components/podcasts/EpisodeDetail.test.tsx`

Expected: FAIL because the episode type and header do not yet expose notebook origin.

- [ ] **Step 7: Add the typed, localized metadata pill**

Add the optional response fields to `PodcastEpisode`:

```ts
notebook_id?: string | null
notebook_name?: string | null
```

In `EpisodeDetail`, add one secondary `Badge` in the existing metadata row after the completed status pill:

```tsx
<Badge variant="secondary" className="font-normal">
  {episode.notebook_id
    ? t('podcasts.fromNotebook', {
        name: episode.notebook_name || t('common.unknown'),
      })
    : t('podcasts.standaloneEpisode')}
</Badge>
```

Add `podcasts.fromNotebook` (`From {{name}}`) and `podcasts.standaloneEpisode` (`Standalone`) to `en-US`, then add equivalent keys to every other locale. Do not make the pill a link in this task; the response communicates origin but does not promise that the current user can open the notebook after a later permission change.

- [ ] **Step 8: Verify frontend behavior and locale parity**

Run from `frontend/`:

```bash
npm run test -- src/components/podcasts/EpisodeDetail.test.tsx src/lib/locales/index.test.ts
npm run lint
npm run build
```

Expected: all commands PASS; linked episodes show the notebook name and unlinked episodes show `Standalone` without changing header height or action permissions.

- [ ] **Step 9: Commit the implementation**

```bash
git add api/routers/podcasts.py tests/test_podcast_notebook_origin.py frontend/src/lib/types/podcasts.ts frontend/src/components/podcasts/EpisodeDetail.tsx frontend/src/components/podcasts/EpisodeDetail.test.tsx frontend/src/lib/locales
git commit -m "feat(podcasts): show episode notebook origin"
```
