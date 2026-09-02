import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { EpisodeCard } from './EpisodeCard'
import type { PodcastEpisode } from '@/lib/types/podcasts'

// useTranslation is mocked globally in setup.ts (t returns the key string)

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

describe('EpisodeCard row', () => {
  it('renders the episode name, profile and created time, linking to its detail route', () => {
    render(
      <EpisodeCard
        episode={makeEpisode({ created: '2024-01-01T00:00:00Z' })}
        onDelete={vi.fn()}
      />
    )

    const link = screen.getByRole('link', { name: 'Test Episode' })
    const title = screen.getByText('Test Episode')
    expect(link).toHaveAttribute('href', `/podcasts/${encodeURIComponent('episode:1')}`)
    expect(title).toHaveClass('group-hover:text-primary')
    expect(title).not.toHaveClass('group-hover:underline')
    expect(screen.getByText(/default/)).toBeInTheDocument()
  })

  it('shows a status badge for a non-completed episode', () => {
    render(
      <EpisodeCard episode={makeEpisode({ job_status: 'running' })} onDelete={vi.fn()} />
    )

    expect(screen.getByText('podcasts.processingLabel')).toBeInTheDocument()
  })

  it('offers a retry quick action for a failed episode and calls onRetry with the episode id', () => {
    const onRetry = vi.fn()
    render(
      <EpisodeCard
        episode={makeEpisode({ job_status: 'failed' })}
        onDelete={vi.fn()}
        onRetry={onRetry}
      />
    )

    fireEvent.click(screen.getByText('podcasts.retry'))
    expect(onRetry).toHaveBeenCalledWith('episode:1')
  })

  it('deletes after the confirm dialog is accepted', () => {
    const onDelete = vi.fn()
    render(<EpisodeCard episode={makeEpisode()} onDelete={onDelete} />)

    fireEvent.click(screen.getByText('podcasts.delete'))
    const confirmButtons = screen.getAllByText('podcasts.delete')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(onDelete).toHaveBeenCalledWith('episode:1')
  })

  it('hides the delete quick action for a viewer', () => {
    render(<EpisodeCard episode={makeEpisode()} onDelete={vi.fn()} role="viewer" />)

    expect(screen.queryByText('podcasts.delete')).not.toBeInTheDocument()
  })

  it('lets an editor retry and delete', () => {
    render(
      <EpisodeCard
        episode={makeEpisode({ job_status: 'failed' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        role="editor"
      />
    )

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
    expect(screen.getByText('podcasts.delete')).toBeInTheDocument()
  })
})
