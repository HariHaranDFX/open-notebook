'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  CircleAlert,
  Clock3,
  FileText,
  LoaderCircle,
  Mic2,
  VolumeX,
} from 'lucide-react'

import apiClient from '@/lib/api/client'
import { resolvePodcastAssetUrl } from '@/lib/api/podcasts'
import {
  ACTIVE_EPISODE_STATUSES,
  EpisodeStatus,
  FAILED_EPISODE_STATUSES,
  PodcastEpisode,
} from '@/lib/types/podcasts'
import { getDateLocale } from '@/lib/utils/date-locale'
import { AccessRole } from '@/lib/utils/access-role'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { DeleteEpisodeAction, RetryEpisodeButton, StatusBadge } from './EpisodeActions'

interface EpisodeDetailProps {
  episode: PodcastEpisode
  onBack?: () => void
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
    if (Array.isArray(data.segments)) return data.segments
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
    if (Array.isArray(data.transcript)) return data.transcript
  }
  return []
}

function speakerInitials(name?: string) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'S'
}

export function EpisodeDetail({
  episode,
  onBack,
  onDelete,
  deleting,
  onRetry,
  retrying,
  role,
}: EpisodeDetailProps) {
  const { t, language } = useTranslation()
  const [audioSrc, setAudioSrc] = useState<string | undefined>()
  const [audioError, setAudioError] = useState<string | null>(null)
  const [audioLoading, setAudioLoading] = useState(Boolean(episode.audio_url || episode.audio_file))

  const outlineSegments = useMemo(() => extractOutlineSegments(episode.outline), [episode.outline])
  const transcriptEntries = useMemo(() => extractTranscriptEntries(episode.transcript), [episode.transcript])
  const isFailed = FAILED_EPISODE_STATUSES.includes(episode.job_status as EpisodeStatus)
  const isActive = ACTIVE_EPISODE_STATUSES.includes(episode.job_status as EpisodeStatus)

  useEffect(() => {
    let cancelled = false
    let revokeUrl: string | undefined

    setAudioError(null)
    setAudioSrc(undefined)

    const audioReference = episode.audio_url || episode.audio_file
    if (!audioReference) {
      setAudioLoading(false)
      return
    }

    setAudioLoading(true)

    const loadAudio = async () => {
      try {
        const directAudioUrl = await resolvePodcastAssetUrl(audioReference)

        if (!directAudioUrl || !episode.audio_url) {
          if (!cancelled) setAudioSrc(directAudioUrl)
          return
        }

        const response = await apiClient.get<Blob>(directAudioUrl, { responseType: 'blob' })
        const objectUrl = URL.createObjectURL(response.data)

        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }

        revokeUrl = objectUrl
        setAudioSrc(objectUrl)
      } catch (error) {
        if (!cancelled) {
          console.error('Unable to load podcast audio', error)
          setAudioError(t('podcasts.audioUnavailable'))
        }
      } finally {
        if (!cancelled) setAudioLoading(false)
      }
    }

    void loadAudio()

    return () => {
      cancelled = true
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    }
  }, [episode.audio_url, episode.audio_file, t])

  const distance = episode.created
    ? formatDistanceToNow(new Date(episode.created), {
        addSuffix: true,
        locale: getDateLocale(language),
      })
    : null

  const createdLabel = distance ? t('podcasts.created', { time: distance }) : null
  const speakers = episode.speaker_profile?.speakers ?? []

  return (
    <article className="space-y-6">
      <header className="border-b border-border pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="max-w-4xl text-2xl font-semibold leading-[1.2] text-foreground">
              {episode.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={episode.job_status} showCompleted />
              {speakers.length > 0 ? (
                <Badge variant="secondary" className="font-normal">
                  {speakers.map((speaker) => speaker.name).filter(Boolean).join(' · ')}
                </Badge>
              ) : null}
              <Badge variant="secondary" className="font-normal">
                {t('podcasts.profile')}: {episode.episode_profile?.name || t('common.unknown')}
              </Badge>
              {createdLabel ? <Badge variant="secondary" className="font-normal">{createdLabel}</Badge> : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <RetryEpisodeButton episode={episode} onRetry={onRetry} retrying={retrying} role={role} />
            {onBack ? (
              <Button variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft />
                {t('common.back')}
              </Button>
            ) : null}
            <DeleteEpisodeAction episode={episode} onDelete={onDelete} deleting={deleting} role={role} />
          </div>
        </div>
      </header>

      <section
        aria-label={t('common.podcast')}
        className="overflow-hidden rounded-[var(--surface-radius)] border border-border bg-card text-card-foreground"
      >
        {audioSrc ? (
          <div className="p-3 sm:px-5">
            <audio
              controls
              preload="metadata"
              src={audioSrc}
              aria-label={`${episode.name} ${t('common.podcast')}`}
              className="h-10 w-full"
            />
          </div>
        ) : audioLoading ? (
          <PlayerState icon={LoaderCircle} title={t('common.loading')} iconClassName="animate-spin" />
        ) : audioError ? (
          <PlayerState icon={VolumeX} title={audioError} role="alert" />
        ) : isActive ? (
          <PlayerState
            icon={episode.job_status === 'pending' || episode.job_status === 'submitted' ? Clock3 : LoaderCircle}
            title={episode.job_status === 'pending' || episode.job_status === 'submitted'
              ? t('podcasts.statusPendingTitle')
              : t('podcasts.statusRunningTitle')}
            description={episode.job_status === 'pending' || episode.job_status === 'submitted'
              ? t('podcasts.statusPendingDesc')
              : t('podcasts.statusRunningDesc')}
            iconClassName={episode.job_status === 'pending' || episode.job_status === 'submitted' ? undefined : 'animate-spin'}
          />
        ) : isFailed ? (
          <PlayerState
            icon={CircleAlert}
            title={t('podcasts.statusFailedTitle')}
            description={t('podcasts.statusFailedDesc')}
          />
        ) : (
          <PlayerState icon={VolumeX} title={t('podcasts.audioUnavailable')} />
        )}
      </section>

      {isFailed && episode.error_message ? (
        <div role="alert" className="flex gap-3 rounded-[var(--surface-radius)] border border-error bg-error-surface p-4 text-error">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{t('podcasts.errorDetails')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{episode.error_message}</p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="summary" className="gap-0">
        <TabsList className="sticky top-0 z-10 w-full justify-start gap-5 overflow-x-auto rounded-none border-x-0 border-t-0 bg-background p-0">
          <EditorialTab value="summary">{t('podcasts.summaryTab')}</EditorialTab>
          <EditorialTab value="outline">
            {t('podcasts.outlineTab')}
            {outlineSegments.length > 0 ? (
              <Badge variant="secondary" className="pointer-events-none min-w-6 px-1.5 tabular-nums">
                {outlineSegments.length}
              </Badge>
            ) : null}
          </EditorialTab>
          <EditorialTab value="transcript">{t('podcasts.transcriptTab')}</EditorialTab>
          <EditorialTab value="details">{t('podcasts.commonDetailsTab')}</EditorialTab>
        </TabsList>

        <TabsContent value="summary" className="pt-6">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section className="max-w-3xl">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-primary">{t('podcasts.briefing')}</p>
              <h2 className="mb-3 text-xl font-semibold text-foreground">{episode.name}</h2>
              <p className="whitespace-pre-wrap font-research text-base leading-7 text-foreground/85">
                {episode.briefing || episode.episode_profile?.default_briefing || t('podcasts.noDescription')}
              </p>
            </section>

            <aside className="space-y-5 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <SummaryBlock title={t('podcasts.speakerProfile')}>
                {speakers.length > 0 ? speakers.map((speaker, index) => (
                  <div key={`${speaker.name}-${index}`} className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-accent text-xs font-semibold text-accent-foreground">
                      {speakerInitials(speaker.name)}
                    </span>
                    <span className="text-sm font-medium text-foreground">{speaker.name || t('podcasts.speaker')}</span>
                  </div>
                )) : <p className="text-sm text-muted-foreground">{t('podcasts.noSpeakerProfilesAvailable')}</p>}
              </SummaryBlock>

              <SummaryBlock title={t('podcasts.episodeProfile')}>
                <DetailLine label={t('podcasts.profile')} value={episode.episode_profile?.name || t('common.unknown')} />
                <DetailLine label={t('podcasts.segments')} value={String(episode.episode_profile?.num_segments ?? '—')} />
                <DetailLine label={t('podcasts.language')} value={episode.episode_profile?.language || '—'} />
              </SummaryBlock>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="outline" className="pt-6">
          {outlineSegments.length > 0 ? (
            <div className="divide-y divide-border">
              {outlineSegments.map((segment, index) => (
                <article key={index} className="grid gap-3 py-5 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-start">
                  <span className="font-mono text-sm text-primary">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      {segment.name ?? `${t('podcasts.segment')} ${index + 1}`}
                    </h2>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {segment.description ?? t('podcasts.noDescription')}
                    </p>
                  </div>
                  {segment.size ? <Badge variant="outline" className="w-fit text-[10px] uppercase tracking-wide">{segment.size}</Badge> : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyTab icon={FileText} message={t('podcasts.noOutline')} />
          )}
        </TabsContent>

        <TabsContent value="transcript" className="pt-6">
          {transcriptEntries.length > 0 ? (
            <div className="divide-y divide-border">
              {transcriptEntries.map((entry, index) => (
                <article key={index} className="grid gap-3 py-5 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-primary">
                    {speakerInitials(entry.speaker)}
                  </span>
                  <div className="max-w-3xl">
                    <h2 className="text-sm font-semibold text-foreground">{entry.speaker ?? t('podcasts.speaker')}</h2>
                    <p className="mt-1 whitespace-pre-wrap font-research text-base leading-7 text-foreground/85">{entry.dialogue ?? ''}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyTab icon={Mic2} message={t('podcasts.noTranscript')} />
          )}
        </TabsContent>

        <TabsContent value="details" className="pt-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-4 text-base font-semibold text-foreground">{t('podcasts.episodeProfile')}</h2>
              <div className="divide-y divide-border border-y border-border">
                <DetailLine
                  label={t('podcasts.outlineModel')}
                  value={formatModelLabel(
                    episode.episode_profile?.outline_model_provider,
                    episode.episode_profile?.outline_model_name,
                    episode.episode_profile?.outline_provider,
                    episode.episode_profile?.outline_model
                  )}
                />
                <DetailLine
                  label={t('podcasts.transcriptModel')}
                  value={formatModelLabel(
                    episode.episode_profile?.transcript_model_provider,
                    episode.episode_profile?.transcript_model_name,
                    episode.episode_profile?.transcript_provider,
                    episode.episode_profile?.transcript_model
                  )}
                />
                <DetailLine label={t('podcasts.segments')} value={String(episode.episode_profile?.num_segments ?? '—')} />
                <DetailLine label={t('podcasts.maxTokens')} value={String(episode.episode_profile?.max_tokens ?? '—')} />
              </div>
              {episode.episode_profile?.default_briefing ? (
                <div className="mt-5">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{t('podcasts.defaultBriefingTitle')}</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{episode.episode_profile.default_briefing}</p>
                </div>
              ) : null}
            </section>

            <section>
              <h2 className="mb-1 text-base font-semibold text-foreground">{t('podcasts.speakerProfile')}</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                {formatModelLabel(
                  episode.speaker_profile?.voice_model_provider,
                  episode.speaker_profile?.voice_model_name,
                  episode.speaker_profile?.tts_provider,
                  episode.speaker_profile?.tts_model
                )}
              </p>
              <div className="divide-y divide-border border-y border-border">
                {speakers.map((speaker, index) => (
                  <article key={`${speaker.name}-${index}`} className="py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full border border-border bg-accent text-xs font-semibold text-accent-foreground">
                        {speakerInitials(speaker.name)}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{speaker.name || t('podcasts.speaker')}</h3>
                        <p className="text-xs text-muted-foreground">{t('podcasts.voiceId')}: {speaker.voice_id}</p>
                      </div>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      <span className="font-semibold text-foreground">{t('podcasts.backstory')}:</span> {speaker.backstory}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      <span className="font-semibold text-foreground">{t('podcasts.personality')}:</span> {speaker.personality}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </article>
  )
}

function EditorialTab({ children, value }: { children: React.ReactNode; value: string }) {
  return (
    <TabsTrigger
      value={value}
      className="h-11 flex-none rounded-none border-0 border-b-2 border-b-transparent bg-transparent px-0 data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"
    >
      {children}
    </TabsTrigger>
  )
}

function PlayerState({
  icon: Icon,
  title,
  description,
  iconClassName,
  role,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  description?: string
  iconClassName?: string
  role?: 'alert'
}) {
  return (
    <div role={role} className="flex min-h-36 items-center gap-4 p-5 sm:p-6">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-current/30 bg-current/10">
        <Icon className={`size-5 ${iconClassName ?? ''}`} aria-hidden />
      </span>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-6 opacity-75">{description}</p> : null}
      </div>
    </div>
  )
}

function SummaryBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  )
}

function EmptyTab({ icon: Icon, message }: { icon: React.ComponentType<{ className?: string }>; message: string }) {
  return (
    <div className="grid min-h-56 place-items-center border border-dashed border-border bg-card p-8 text-center">
      <div>
        <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full border border-border text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
