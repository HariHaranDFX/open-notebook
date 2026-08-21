'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'

import apiClient from '@/lib/api/client'
import { resolvePodcastAssetUrl } from '@/lib/api/podcasts'
import { EpisodeStatus, FAILED_EPISODE_STATUSES, PodcastEpisode } from '@/lib/types/podcasts'
import { AccessRole } from '@/lib/utils/access-role'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { DeleteEpisodeAction, RetryEpisodeButton, StatusBadge } from './EpisodeActions'

interface EpisodeDetailProps {
  episode: PodcastEpisode
  onDelete: (episodeId: string) => Promise<void> | void
  deleting?: boolean
  onRetry?: (episodeId: string) => Promise<void> | void
  retrying?: boolean
  /** Missing role (open/auth-off mode, or callers that haven't wired ACLs) grants full access. */
  role?: AccessRole | null
}

type OutlineSegment = {
  name?: string
  description?: string
  size?: string
}

type OutlineData = {
  segments?: OutlineSegment[]
}

type TranscriptEntry = {
  speaker?: string
  dialogue?: string
}

type TranscriptData = {
  transcript?: TranscriptEntry[]
}

export function extractOutlineSegments(outline: unknown): OutlineSegment[] {
  if (outline && typeof outline === 'object' && 'segments' in outline) {
    const data = outline as OutlineData
    if (Array.isArray(data.segments)) {
      return data.segments
    }
  }
  return []
}

/**
 * "provider / name" label for a snapshot model row. Prefers the display
 * fields the API resolves from the snapshot's model references, falls back
 * to the legacy snapshot strings (pre-#1107 episodes), then to a dash.
 */
export function formatModelLabel(
  provider?: string | null,
  name?: string | null,
  legacyProvider?: string | null,
  legacyName?: string | null
): string {
  return `${provider || legacyProvider || '—'} / ${name || legacyName || '—'}`
}

export function extractTranscriptEntries(transcript: unknown): TranscriptEntry[] {
  if (transcript && typeof transcript === 'object' && 'transcript' in transcript) {
    const data = transcript as TranscriptData
    if (Array.isArray(data.transcript)) {
      return data.transcript
    }
  }
  return []
}

export function EpisodeDetail({
  episode,
  onDelete,
  deleting,
  onRetry,
  retrying,
  role,
}: EpisodeDetailProps) {
  const { t, language } = useTranslation()
  const [audioSrc, setAudioSrc] = useState<string | undefined>()
  const [audioError, setAudioError] = useState<string | null>(null)

  const outlineSegments = useMemo(() => extractOutlineSegments(episode.outline), [episode.outline])
  const transcriptEntries = useMemo(() => extractTranscriptEntries(episode.transcript), [episode.transcript])

  useEffect(() => {
    let revokeUrl: string | undefined
    setAudioError(null)

    // If backend exposed a protected endpoint, fetch it with auth headers
    const loadProtectedAudio = async () => {
      // First resolve the audio URL
      const directAudioUrl = await resolvePodcastAssetUrl(episode.audio_url ?? episode.audio_file)

      if (!directAudioUrl || !episode.audio_url) {
        setAudioSrc(directAudioUrl)
        return
      }

      try {
        // apiClient attaches the auth header; directAudioUrl is absolute so
        // the dynamic baseURL is ignored.
        const response = await apiClient.get<Blob>(directAudioUrl, {
          responseType: 'blob',
        })

        revokeUrl = URL.createObjectURL(response.data)
        setAudioSrc(revokeUrl)
      } catch (error) {
        console.error('Unable to load podcast audio', error)
        setAudioError(t('podcasts.audioUnavailable'))
        setAudioSrc(undefined)
      }
    }

    void loadProtectedAudio()

    return () => {
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl)
      }
    }
  }, [episode.audio_url, episode.audio_file, t])

  const distance = episode.created
    ? formatDistanceToNow(new Date(episode.created), {
        addSuffix: true,
        locale: getDateLocale(language),
      })
    : null

  const createdLabel = distance
    ? t('podcasts.created', { time: distance })
    : null

  const isFailed = FAILED_EPISODE_STATUSES.includes(episode.job_status as EpisodeStatus)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={episode.job_status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('podcasts.profile')}: {episode.episode_profile?.name || t('common.unknown')}
            {createdLabel ? ` • ${createdLabel}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RetryEpisodeButton episode={episode} onRetry={onRetry} retrying={retrying} role={role} />
          <DeleteEpisodeAction episode={episode} onDelete={onDelete} deleting={deleting} role={role} />
        </div>
      </div>

      {audioSrc ? (
        <audio controls preload="none" src={audioSrc} className="w-full" />
      ) : audioError ? (
        <p className="text-sm text-destructive">{audioError}</p>
      ) : null}

      {isFailed && episode.error_message ? (
        <div className="rounded-[var(--surface-radius)] border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-xs font-medium text-red-800 dark:text-red-300">{t('podcasts.errorDetails')}</p>
          <p className="mt-1 text-xs whitespace-pre-wrap text-red-700 dark:text-red-400">{episode.error_message}</p>
        </div>
      ) : null}

      <Tabs defaultValue="summary">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="summary">{t('podcasts.summaryTab')}</TabsTrigger>
          <TabsTrigger value="outline">{t('podcasts.outlineTab')}</TabsTrigger>
          <TabsTrigger value="transcript">{t('podcasts.transcriptTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="space-y-6">
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">{t('podcasts.episodeProfile')}</h4>
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">{t('podcasts.outlineModel')}</p>
                  <p>
                    {formatModelLabel(
                      episode.episode_profile?.outline_model_provider,
                      episode.episode_profile?.outline_model_name,
                      episode.episode_profile?.outline_provider,
                      episode.episode_profile?.outline_model
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('podcasts.transcriptModel')}</p>
                  <p>
                    {formatModelLabel(
                      episode.episode_profile?.transcript_model_provider,
                      episode.episode_profile?.transcript_model_name,
                      episode.episode_profile?.transcript_provider,
                      episode.episode_profile?.transcript_model
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('podcasts.segments')}</p>
                  <p>{episode.episode_profile?.num_segments ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('podcasts.maxTokens')}</p>
                  <p>{episode.episode_profile?.max_tokens ?? '—'}</p>
                </div>
              </div>
              {episode.episode_profile?.default_briefing ? (
                <div className="rounded-[var(--surface-radius)] border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                  {episode.episode_profile.default_briefing}
                </div>
              ) : null}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">{t('podcasts.speakerProfile')}</h4>
              <p className="text-xs text-muted-foreground">
                {formatModelLabel(
                  episode.speaker_profile?.voice_model_provider,
                  episode.speaker_profile?.voice_model_name,
                  episode.speaker_profile?.tts_provider,
                  episode.speaker_profile?.tts_model
                )}
              </p>
              {episode.speaker_profile?.speakers?.map((speaker, index) => (
                <div
                  key={`${speaker.name}-${index}`}
                  className="rounded-[var(--surface-radius)] border bg-muted/20 p-3 text-xs"
                >
                  <p className="font-semibold text-foreground">{speaker.name}</p>
                  <p className="text-muted-foreground">{t('podcasts.voiceId')}: {speaker.voice_id}</p>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                    <span className="font-semibold">{t('podcasts.backstory')}:</span> {speaker.backstory}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                    <span className="font-semibold">{t('podcasts.personality')}:</span> {speaker.personality}
                  </p>
                </div>
              ))}
            </section>

            {episode.briefing ? (
              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">{t('podcasts.briefing')}</h4>
                <div className="rounded-[var(--surface-radius)] border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                  {episode.briefing}
                </div>
              </section>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="outline">
          <ScrollArea className="max-h-[60vh] pr-4">
            {outlineSegments.length > 0 ? (
              <div className="space-y-3">
                {outlineSegments.map((segment, index) => (
                  <div key={index} className="space-y-1 rounded-[var(--surface-radius)] border bg-muted/20 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-foreground">{segment.name ?? `${t('podcasts.segment')} ${index + 1}`}</p>
                      {segment.size ? (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{segment.size}</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground whitespace-pre-wrap">{segment.description ?? t('podcasts.noDescription')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('podcasts.noOutline')}</p>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="transcript">
          <ScrollArea className="max-h-[60vh] space-y-3 pr-4">
            {transcriptEntries.length > 0 ? (
              transcriptEntries.map((entry, index) => (
                <div key={index} className="space-y-1 rounded-[var(--surface-radius)] border bg-muted/20 p-3 text-xs">
                  <p className="font-semibold text-foreground">{entry.speaker ?? t('podcasts.speaker')}</p>
                  <p className="text-muted-foreground whitespace-pre-wrap">{entry.dialogue ?? ''}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{t('podcasts.noTranscript')}</p>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
