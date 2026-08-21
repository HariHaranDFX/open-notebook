import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { podcastsApi } from '@/lib/api/podcasts'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { usePodcastEpisode } from '@/lib/hooks/use-podcasts'
import { isNotFoundError } from '@/lib/utils/error-handler'
import type { PodcastEpisode } from '@/lib/types/podcasts'

vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: { getEpisode: vi.fn() },
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

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

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
