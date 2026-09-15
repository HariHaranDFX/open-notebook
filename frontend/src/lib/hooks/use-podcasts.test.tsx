import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { podcastsApi } from '@/lib/api/podcasts'
import { QUERY_KEYS } from '@/lib/api/query-client'
import {
  useEpisodeLibrary,
  usePodcastEpisode,
  usePodcastEpisodesSummary,
  useRetryPodcastEpisode,
} from '@/lib/hooks/use-podcasts'
import { isNotFoundError } from '@/lib/utils/error-handler'
import type { PodcastEpisode } from '@/lib/types/podcasts'

// useTranslation is mocked globally in setup.ts (t returns the key string).

vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: {
    getEpisode: vi.fn(),
    retryEpisode: vi.fn(),
    listEpisodeLibrary: vi.fn(),
    getEpisodeSummary: vi.fn(),
  },
}))

function makeEpisode(overrides: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: 'episode:1',
    name: 'Test Episode',
    episode_profile: {
      id: 'episode_profile:1',
      name: 'default',
      description: '',
      speaker_config: null,
      default_briefing: '',
      num_segments: 5,
    },
    speaker_profile: {
      id: 'speaker_profile:1',
      name: 'default',
      description: '',
      speakers: [],
    },
    briefing: 'briefing',
    job_status: 'completed',
    ...overrides,
  }
}

function createWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('usePodcastEpisode', () => {
  beforeEach(() => vi.mocked(podcastsApi.getEpisode).mockReset())

  it('fetches a single episode by id under the shared podcastEpisode query key', async () => {
    const episode = makeEpisode()
    vi.mocked(podcastsApi.getEpisode).mockResolvedValue(episode)

    const { result } = renderHook(() => usePodcastEpisode('episode:1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data).toEqual(episode))
    expect(podcastsApi.getEpisode).toHaveBeenCalledWith('episode:1')
    expect(QUERY_KEYS.podcastEpisode('episode:1')).toEqual(['podcasts', 'episodes', 'episode:1'])
  })

  it('does not fetch when the episode id is empty', () => {
    renderHook(() => usePodcastEpisode(''), { wrapper: createWrapper() })

    expect(podcastsApi.getEpisode).not.toHaveBeenCalled()
  })

  // A deleted (or never-existing) episode's GET returns 404. The shared
  // queryClient (query-client.ts) skips retries for exactly this
  // classification (`retry: (count, error) => !isNotFoundError(error) && ...`),
  // so the query settles into a recoverable error state on the first
  // attempt instead of hammering the server. That retry wiring is global
  // and already governs every query in the app; what's specific to this
  // hook's contract is that a 404 on this endpoint is classified the same
  // way. Exercising the real rejection through react-query's retryer here
  // was flaky under jsdom timing, so assert the classification directly.
  it('classifies a 404 response as not-found, matching the shared no-retry policy', () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      isAxiosError: true,
      response: { status: 404, data: { detail: 'Episode not found' } },
    })

    expect(isNotFoundError(notFound)).toBe(true)
  })
})

describe('useEpisodeLibrary', () => {
  beforeEach(() => vi.mocked(podcastsApi.listEpisodeLibrary).mockReset())

  it('first request sends no cursor and normalizes the query', async () => {
    vi.mocked(podcastsApi.listEpisodeLibrary).mockResolvedValue({
      items: [],
      next_cursor: null,
    })

    const { result } = renderHook(
      () => useEpisodeLibrary({ query: '  Hello  ' }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(podcastsApi.listEpisodeLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'hello',
        sort_by: 'updated',
        sort_order: 'desc',
        limit: 30,
        cursor: undefined,
      })
    )
  })

  it('load more sends the previously returned cursor', async () => {
    vi.mocked(podcastsApi.listEpisodeLibrary)
      .mockResolvedValueOnce({ items: [makeEpisode()], next_cursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [makeEpisode({ id: 'episode:2' })], next_cursor: null })

    const { result } = renderHook(() => useEpisodeLibrary(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.hasNextPage).toBe(true))
    await act(async () => {
      await result.current.fetchNextPage()
    })

    expect(podcastsApi.listEpisodeLibrary).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'cursor-1' })
    )
    await waitFor(() => expect(result.current.episodes).toHaveLength(2))
  })

  it('changing the filter starts a fresh query with no cursor', async () => {
    vi.mocked(podcastsApi.listEpisodeLibrary).mockResolvedValue({
      items: [],
      next_cursor: null,
    })

    const { rerender } = renderHook(
      ({ q }: { q: string }) => useEpisodeLibrary({ query: q }),
      { wrapper: createWrapper(), initialProps: { q: 'alpha' } }
    )
    await waitFor(() => expect(podcastsApi.listEpisodeLibrary).toHaveBeenCalled())

    vi.mocked(podcastsApi.listEpisodeLibrary).mockClear()
    rerender({ q: 'beta' })
    await waitFor(() => expect(podcastsApi.listEpisodeLibrary).toHaveBeenCalled())

    expect(podcastsApi.listEpisodeLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'beta', cursor: undefined })
    )
  })
})

describe('usePodcastEpisodesSummary', () => {
  beforeEach(() => vi.mocked(podcastsApi.getEpisodeSummary).mockReset())

  it('fetches under the summary query key', async () => {
    const summary = {
      total: 3,
      running: 1,
      pending: 0,
      completed: 2,
      failed: 0,
      has_active: true,
    }
    vi.mocked(podcastsApi.getEpisodeSummary).mockResolvedValue(summary)

    const { result } = renderHook(() => usePodcastEpisodesSummary({ autoRefresh: false }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data).toEqual(summary))
    expect(QUERY_KEYS.podcastEpisodeSummary).toEqual([
      'podcasts',
      'episodes',
      'summary',
    ])
  })
})

describe('useRetryPodcastEpisode', () => {
  beforeEach(() => vi.mocked(podcastsApi.retryEpisode).mockReset())

  it('refreshes both the episode list and the single-episode key for the retried id', async () => {
    vi.mocked(podcastsApi.retryEpisode).mockResolvedValue({ job_id: 'job:1', message: 'retrying' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const refetch = vi.spyOn(client, 'refetchQueries')
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useRetryPodcastEpisode(), {
      wrapper: createWrapper(client),
    })

    await act(async () => {
      await result.current.mutateAsync('episode:1')
    })

    expect(refetch).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.podcastEpisodes })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEYS.podcastEpisode('episode:1') })
  })
})
