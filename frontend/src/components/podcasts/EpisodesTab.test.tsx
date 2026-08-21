import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EpisodesTab } from './EpisodesTab'
import type { PodcastEpisode } from '@/lib/types/podcasts'

// useTranslation and next/navigation are mocked globally in setup.ts.

const usePodcastEpisodesMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-podcasts', () => ({
  usePodcastEpisodes: usePodcastEpisodesMock,
  useDeletePodcastEpisode: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryPodcastEpisode: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/components/podcasts/GeneratePodcastDialog', () => ({
  GeneratePodcastDialog: () => null,
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

function mockEpisodes(episodes: PodcastEpisode[]) {
  const statusGroups = {
    running: episodes.filter((e) => e.job_status === 'running'),
    pending: episodes.filter((e) => e.job_status === 'pending'),
    completed: episodes.filter((e) => e.job_status === 'completed'),
    failed: episodes.filter((e) => e.job_status === 'failed'),
  }
  usePodcastEpisodesMock.mockReturnValue({
    episodes,
    statusGroups,
    statusCounts: {
      total: episodes.length,
      running: statusGroups.running.length,
      completed: statusGroups.completed.length,
      failed: statusGroups.failed.length,
      pending: statusGroups.pending.length,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isFetching: false,
  })
}

describe('EpisodesTab', () => {
  beforeEach(() => {
    usePodcastEpisodesMock.mockReset()
  })

  it('shows Generate episode as the sole primary action; refresh stays secondary', () => {
    mockEpisodes([makeEpisode()])

    render(<EpisodesTab />)

    const generateBtn = screen.getByText('podcasts.generateBtn').closest('button')
    const refreshBtn = screen.getByText('common.refresh').closest('button')

    expect(generateBtn).toHaveClass('bg-primary')
    expect(refreshBtn).not.toHaveClass('bg-primary')
  })

  it('orders running/pending groups before completed/failed', () => {
    mockEpisodes([
      makeEpisode({ id: 'episode:running', job_status: 'running' }),
      makeEpisode({ id: 'episode:pending', job_status: 'pending' }),
      makeEpisode({ id: 'episode:completed', job_status: 'completed' }),
      makeEpisode({ id: 'episode:failed', job_status: 'failed' }),
    ])

    render(<EpisodesTab />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    const runningIdx = headings.indexOf('podcasts.statusRunningTitle')
    const pendingIdx = headings.indexOf('podcasts.statusPendingTitle')
    const completedIdx = headings.indexOf('podcasts.statusCompletedTitle')
    const failedIdx = headings.indexOf('podcasts.statusFailedTitle')

    expect(runningIdx).toBeGreaterThanOrEqual(0)
    expect(runningIdx).toBeLessThan(completedIdx)
    expect(pendingIdx).toBeLessThan(completedIdx)
    expect(runningIdx).toBeLessThan(failedIdx)
    expect(pendingIdx).toBeLessThan(failedIdx)
  })

  it('exposes a retry action on failed rows', () => {
    mockEpisodes([makeEpisode({ id: 'episode:failed', job_status: 'failed' })])

    render(<EpisodesTab />)

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
  })

  it('renders a compact inline status summary instead of a large card', () => {
    mockEpisodes([
      makeEpisode({ id: 'episode:completed', job_status: 'completed' }),
      makeEpisode({ id: 'episode:failed', job_status: 'failed' }),
    ])

    render(<EpisodesTab />)

    expect(screen.getByText('podcasts.total').closest('span')).toHaveTextContent('2')
    expect(screen.getByText('podcasts.pendingLabel').closest('span')).toHaveTextContent('0')
  })
})
