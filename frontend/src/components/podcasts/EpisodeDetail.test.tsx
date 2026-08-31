import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

import apiClient from '@/lib/api/client'
import { enUS } from '@/lib/locales/en-US'
import { EpisodeDetail } from './EpisodeDetail'
import type { PodcastEpisode } from '@/lib/types/podcasts'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// jsdom does not implement the Blob object URL APIs the protected-audio
// effect relies on.
URL.createObjectURL = vi.fn(() => 'blob:mock-audio-url')
URL.revokeObjectURL = vi.fn()

vi.mock('@/lib/api/client', () => ({
  default: { get: vi.fn(async () => ({ data: new Blob(['audio-bytes']) })) },
}))

vi.mock('@/lib/api/podcasts', () => ({
  resolvePodcastAssetUrl: vi.fn(async (path?: string | null) => (path ? `https://api.test${path}` : undefined)),
}))

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset().mockResolvedValue({ data: new Blob(['audio-bytes']) })
})

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

describe('EpisodeDetail playback and status', () => {
  it('presents a completed episode as a listening workspace with accessible audio and details', async () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ audio_url: '/podcasts/episode:1/audio' })}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Test Episode', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'podcasts.commonDetailsTab' })).toBeInTheDocument()

    const player = screen.getByRole('region', { name: 'common.podcast' })
    await waitFor(() => expect(player).toContainElement(document.querySelector('audio')))
    const audio = document.querySelector('audio') as HTMLAudioElement

    expect(audio).toHaveAttribute('controls')
    expect(player).toHaveClass(
      'bg-card',
      'text-card-foreground',
      'rounded-[var(--surface-radius)]'
    )
    expect(player).not.toHaveClass('bg-foreground', 'dark:bg-card')
    expect(audio).not.toHaveClass('[color-scheme:dark]')
    expect(audio.parentElement).not.toHaveClass('bg-black/10')
    expect(within(player).queryByText('podcasts.completedLabel')).not.toBeInTheDocument()
  })

  it('keeps the compact metadata below the title and places Back beside Delete', () => {
    const onBack = vi.fn()
    render(
      <EpisodeDetail
        episode={makeEpisode({
          created: '2026-08-31T08:00:00Z',
          speaker_profile: {
            id: 'speaker_profile:1',
            name: 'faculty',
            description: '',
            speakers: [
              {
                name: 'Professor Ada',
                voice_id: 'voice:1',
                backstory: '',
                personality: '',
              },
            ],
          },
        })}
        onBack={onBack}
        onDelete={vi.fn()}
      />
    )

    const heading = screen.getByRole('heading', { name: 'Test Episode', level: 1 })
    const header = heading.closest('header') as HTMLElement
    const professor = within(header).getByText('Professor Ada')
    const completed = within(header).getByText('podcasts.completedLabel')
    const profile = within(header).getByText(/podcasts.profile:/)
    const created = within(header).getByText('podcasts.created')
    const back = within(header).getByRole('button', { name: 'common.back' })
    const deleteButton = within(header).getByRole('button', { name: 'podcasts.delete' })
    const metadata = completed.parentElement as HTMLElement

    expect(heading).toHaveClass('text-2xl')
    expect(header).toHaveClass('pb-4')
    expect(heading.parentElement?.parentElement).toHaveClass('lg:items-center')
    expect(heading.compareDocumentPosition(professor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(metadata.firstElementChild).toBe(completed)
    expect(professor.parentElement).toBe(metadata)
    expect(profile.parentElement).toBe(metadata)
    expect(created.parentElement).toBe(metadata)
    expect(professor).toHaveAttribute('data-slot', 'badge')
    expect(profile).toHaveAttribute('data-slot', 'badge')
    expect(created).toHaveAttribute('data-slot', 'badge')
    expect(back.compareDocumentPosition(deleteButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(header).queryByRole('button', { name: 'podcasts.listTitle' })).not.toBeInTheDocument()

    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('loads protected audio and shows the episode/speaker configuration for a completed episode', async () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ audio_url: '/podcasts/episode:1/audio' })}
        onDelete={vi.fn()}
      />
    )

    await waitFor(() => {
      const audio = document.querySelector('audio')
      expect(audio).toHaveAttribute('src', 'blob:mock-audio-url')
    })
    expect(apiClient.get).toHaveBeenCalledWith(
      'https://api.test/podcasts/episode:1/audio',
      { responseType: 'blob' }
    )

    expect(screen.getAllByText(/default/).length).toBeGreaterThan(0)
  })

  it('shows a running status without an error block or retry action', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'running' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText('podcasts.processingLabel')).toBeInTheDocument()
    expect(screen.queryByText('podcasts.retry')).not.toBeInTheDocument()
    expect(screen.queryByText('podcasts.errorDetails')).not.toBeInTheDocument()
  })

  it('explains that a pending episode is queued instead of leaving an empty player', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'pending' })}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByText('podcasts.statusPendingTitle')).toBeInTheDocument()
    expect(screen.getByText('podcasts.statusPendingDesc')).toBeInTheDocument()
    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  it('shows a recoverable audio error inside the player region', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(apiClient.get).mockRejectedValue(new Error('audio failed'))

    render(
      <EpisodeDetail
        episode={makeEpisode({ audio_url: '/podcasts/episode:1/audio' })}
        onDelete={vi.fn()}
      />
    )

    const player = screen.getByRole('region', { name: 'common.podcast' })
    await waitFor(() => expect(player).toHaveTextContent('podcasts.audioUnavailable'))
    expect(document.querySelector('audio')).not.toBeInTheDocument()

    consoleError.mockRestore()
  })

  it('gives empty outline and transcript tabs a deliberate empty state', () => {
    render(<EpisodeDetail episode={makeEpisode()} onDelete={vi.fn()} />)

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'podcasts.outlineTab' }), { button: 0 })
    expect(screen.getByText('podcasts.noOutline')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'podcasts.transcriptTab' }), { button: 0 })
    expect(screen.getByText('podcasts.noTranscript')).toBeInTheDocument()
  })

  it('uses compact summary copy, a pill count, and the translated Common Details label', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({
          outline: {
            segments: [{ name: 'Opening', description: 'Introduction' }],
          },
        })}
        onDelete={vi.fn()}
      />
    )

    const briefing = screen.getByText('briefing')
    const outlineTab = screen.getByRole('tab', { name: /podcasts.outlineTab/ })

    expect(briefing).toHaveClass('text-base')
    expect(briefing).not.toHaveClass('sm:text-lg')
    expect(within(outlineTab).getByText('1')).toHaveAttribute('data-slot', 'badge')
    expect(screen.getByRole('tab', { name: 'podcasts.commonDetailsTab' })).toBeInTheDocument()
    expect(enUS.podcasts.commonDetailsTab).toBe('Common Details')
  })

  it('shows the failure reason and lets a full-access viewer retry', () => {
    const onRetry = vi.fn()
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'failed', error_message: 'The model timed out' })}
        onDelete={vi.fn()}
        onRetry={onRetry}
      />
    )

    expect(screen.getByText('podcasts.errorDetails')).toBeInTheDocument()
    expect(screen.getByText('The model timed out')).toBeInTheDocument()

    fireEvent.click(screen.getByText('podcasts.retry'))
    expect(onRetry).toHaveBeenCalledWith('episode:1')
  })
})

describe('EpisodeDetail model snapshot fallback', () => {
  it('resolves API-provided model display fields for new episodes', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({
          episode_profile: {
            id: 'episode_profile:1',
            name: 'modern',
            description: '',
            speaker_config: null,
            default_briefing: '',
            num_segments: 5,
            outline_llm: 'model:outline',
            transcript_llm: 'model:transcript',
            outline_model_provider: 'openai',
            outline_model_name: 'gpt-4o',
            transcript_model_provider: 'anthropic',
            transcript_model_name: 'claude-sonnet',
          },
          speaker_profile: {
            id: 'speaker_profile:1',
            name: 'modern',
            description: '',
            speakers: [],
            voice_model: 'model:voice',
            voice_model_provider: 'elevenlabs',
            voice_model_name: 'eleven_turbo',
          },
        })}
        onDelete={vi.fn()}
      />
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'podcasts.commonDetailsTab' }), { button: 0 })

    expect(screen.getByText('openai / gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('anthropic / claude-sonnet')).toBeInTheDocument()
    expect(screen.getByText('elevenlabs / eleven_turbo')).toBeInTheDocument()
  })

  it('falls back to legacy snapshot strings for old episodes', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({
          episode_profile: {
            id: 'episode_profile:1',
            name: 'legacy',
            description: '',
            speaker_config: null,
            default_briefing: '',
            num_segments: 5,
            outline_provider: 'openai',
            outline_model: 'gpt-3.5-turbo',
            transcript_provider: 'openai',
            transcript_model: 'gpt-4',
          },
          speaker_profile: {
            id: 'speaker_profile:1',
            name: 'legacy',
            description: '',
            speakers: [],
            tts_provider: 'openai',
            tts_model: 'tts-1',
          },
        })}
        onDelete={vi.fn()}
      />
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'podcasts.commonDetailsTab' }), { button: 0 })

    expect(screen.getByText('openai / gpt-3.5-turbo')).toBeInTheDocument()
    expect(screen.getByText('openai / gpt-4')).toBeInTheDocument()
    expect(screen.getByText('openai / tts-1')).toBeInTheDocument()
  })

  it('degrades to dashes when references are unresolvable and no legacy strings exist', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({
          episode_profile: {
            id: 'episode_profile:1',
            name: 'orphaned',
            description: '',
            speaker_config: null,
            default_briefing: '',
            num_segments: 5,
            outline_llm: 'model:deleted',
            transcript_llm: 'model:deleted',
          },
          speaker_profile: {
            id: 'speaker_profile:1',
            name: 'orphaned',
            description: '',
            speakers: [],
            voice_model: 'model:deleted',
          },
        })}
        onDelete={vi.fn()}
      />
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'podcasts.commonDetailsTab' }), { button: 0 })

    expect(screen.getAllByText('— / —')).toHaveLength(3)
  })
})

describe('EpisodeDetail access-role gating', () => {
  it('keeps playback available to a viewer but hides delete and retry', async () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'failed', audio_url: '/podcasts/episode:1/audio' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        role="viewer"
      />
    )

    await waitFor(() => {
      expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:mock-audio-url')
    })
    expect(screen.queryByText('podcasts.delete')).not.toBeInTheDocument()
    expect(screen.queryByText('podcasts.retry')).not.toBeInTheDocument()
  })

  it('lets an editor retry and delete a failed episode', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'failed' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        role="editor"
      />
    )

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
    expect(screen.getByText('podcasts.delete')).toBeInTheDocument()
  })

  it('grants the owner full retry and delete access, confirmed via dialog', () => {
    const onDelete = vi.fn()
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'failed' })}
        onDelete={onDelete}
        onRetry={vi.fn()}
        role="owner"
      />
    )

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()

    fireEvent.click(screen.getByText('podcasts.delete'))

    const confirmButtons = screen.getAllByText('podcasts.delete')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(onDelete).toHaveBeenCalledWith('episode:1')
  })
})
