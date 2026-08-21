import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EpisodeDetailPage from './page'

const push = vi.hoisted(() => vi.fn())
const episodeHook = vi.hoisted(() => vi.fn())
const deleteMutateAsync = vi.hoisted(() => vi.fn())
const retryMutateAsync = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'episode%3A1' }),
  useRouter: () => ({ push }),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/lib/hooks/use-podcasts', () => ({
  usePodcastEpisode: episodeHook,
  useDeletePodcastEpisode: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
  useRetryPodcastEpisode: () => ({ mutateAsync: retryMutateAsync, isPending: false }),
}))

vi.mock('@/components/podcasts/EpisodeDetail', () => ({
  EpisodeDetail: ({
    episode,
    onDelete,
  }: {
    episode: { id: string; name: string }
    onDelete: (id: string) => void
  }) => (
    <div>
      <p>Episode detail for {episode.name}</p>
      <button type="button" onClick={() => onDelete(episode.id)}>
        confirm-delete
      </button>
    </div>
  ),
}))

describe('EpisodeDetailPage', () => {
  beforeEach(() => {
    push.mockReset()
    deleteMutateAsync.mockReset().mockResolvedValue(undefined)
    retryMutateAsync.mockReset()
    episodeHook.mockReset()
  })

  it('shows a loading state while the episode is being fetched', () => {
    episodeHook.mockReturnValue({ data: undefined, isLoading: true })

    render(<EpisodeDetailPage />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('offers a safe return to the podcasts list when the episode no longer exists', () => {
    episodeHook.mockReturnValue({ data: undefined, isLoading: false })

    render(<EpisodeDetailPage />)

    expect(screen.getByText('podcasts.episodeNotFound')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /podcasts.backToPodcasts/ })).toHaveAttribute(
      'href',
      '/podcasts'
    )
  })

  it('renders the episode detail once the episode has loaded', () => {
    episodeHook.mockReturnValue({
      data: { id: 'episode:1', name: 'My Episode' },
      isLoading: false,
    })

    render(<EpisodeDetailPage />)

    expect(screen.getByText('My Episode')).toBeInTheDocument()
    expect(screen.getByText('Episode detail for My Episode')).toBeInTheDocument()
  })

  it('navigates back to the podcasts list after a successful delete', async () => {
    episodeHook.mockReturnValue({
      data: { id: 'episode:1', name: 'My Episode' },
      isLoading: false,
    })

    render(<EpisodeDetailPage />)
    screen.getByText('confirm-delete').click()

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('episode:1'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/podcasts'))
  })
})
