import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EpisodesTab } from './EpisodesTab'
import type { PodcastEpisode } from '@/lib/types/podcasts'

// useTranslation and next/navigation are mocked globally in setup.ts.

const useEpisodeLibraryMock = vi.hoisted(() => vi.fn())
const usePodcastEpisodesSummaryMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-podcasts', () => ({
  useEpisodeLibrary: useEpisodeLibraryMock,
  usePodcastEpisodesSummary: usePodcastEpisodesSummaryMock,
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

interface MockOptions {
  hasNextPage?: boolean
  fetchNextPage?: () => void
  summaryOverride?: Partial<{
    total: number
    running: number
    pending: number
    completed: number
    failed: number
    has_active: boolean
  }>
}

function mockEpisodes(episodes: PodcastEpisode[], opts: MockOptions = {}) {
  const total =
    opts.summaryOverride?.total ??
    (episodes.length + (opts.hasNextPage ? 1 : 0))
  useEpisodeLibraryMock.mockReturnValue({
    episodes,
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: opts.hasNextPage ?? false,
    fetchNextPage: opts.fetchNextPage ?? vi.fn(),
    refetch: vi.fn(),
    isError: false,
    isFetchNextPageError: false,
    isRefetchError: false,
    error: null,
  })
  usePodcastEpisodesSummaryMock.mockReturnValue({
    data: {
      total,
      running: opts.summaryOverride?.running ?? episodes.filter((e) => e.job_status === 'running').length,
      pending: opts.summaryOverride?.pending ?? episodes.filter((e) => e.job_status === 'pending').length,
      completed: opts.summaryOverride?.completed ?? episodes.filter((e) => e.job_status === 'completed').length,
      failed: opts.summaryOverride?.failed ?? episodes.filter((e) => e.job_status === 'failed').length,
      has_active: opts.summaryOverride?.has_active ?? false,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <EpisodesTab />
    </QueryClientProvider>
  )
}

describe('EpisodesTab', () => {
  beforeEach(() => {
    useEpisodeLibraryMock.mockReset()
    usePodcastEpisodesSummaryMock.mockReset()
  })

  it('shows Generate episode as the sole primary action; refresh stays secondary', () => {
    mockEpisodes([makeEpisode()])

    renderTab()

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

    renderTab()

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

    renderTab()

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
  })

  it('shows global summary counts, not loaded-only counts', () => {
    // Only 1 completed episode loaded, but summary reports 42 total, 3 running.
    mockEpisodes(
      [makeEpisode({ id: 'episode:completed', job_status: 'completed' })],
      {
        summaryOverride: { total: 42, running: 3, has_active: true },
      }
    )

    renderTab()

    expect(screen.getByText('podcasts.total').closest('div')).toHaveTextContent('42')
    expect(screen.getByText('podcasts.processingLabel').closest('div')).toHaveTextContent('3')
  })

  it('hides retry and delete on a failed row when access is viewer', () => {
    mockEpisodes([
      makeEpisode({ id: 'episode:failed', job_status: 'failed', access_role: 'viewer' }),
    ])

    renderTab()

    expect(screen.queryByText('podcasts.retry')).not.toBeInTheDocument()
    expect(screen.queryByText('podcasts.delete')).not.toBeInTheDocument()
  })

  it('keeps retry and delete on a failed row when access is editor', () => {
    mockEpisodes([
      makeEpisode({ id: 'episode:failed', job_status: 'failed', access_role: 'editor' }),
    ])

    renderTab()

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
    expect(screen.getByText('podcasts.delete')).toBeInTheDocument()
  })

  it('renders a Load more button when hasNextPage is true', () => {
    const fetchNextPage = vi.fn()
    mockEpisodes([makeEpisode()], { hasNextPage: true, fetchNextPage })

    renderTab()

    const loadMore = screen.getByRole('button', { name: 'podcasts.loadMore' })
    expect(loadMore).toBeInTheDocument()
  })

  it('hides Load more when hasNextPage is false', () => {
    mockEpisodes([makeEpisode()], { hasNextPage: false })

    renderTab()

    expect(
      screen.queryByRole('button', { name: 'podcasts.loadMore' })
    ).not.toBeInTheDocument()
  })
})
