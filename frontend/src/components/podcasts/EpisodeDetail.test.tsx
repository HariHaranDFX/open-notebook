import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import apiClient from '@/lib/api/client'
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

    expect(screen.getByText(/default/)).toBeInTheDocument()
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

  it('lets an editor retry a failed episode but withholds delete', () => {
    render(
      <EpisodeDetail
        episode={makeEpisode({ job_status: 'failed' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        role="editor"
      />
    )

    expect(screen.getByText('podcasts.retry')).toBeInTheDocument()
    expect(screen.queryByText('podcasts.delete')).not.toBeInTheDocument()
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
