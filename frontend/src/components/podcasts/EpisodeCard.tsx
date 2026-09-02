'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'

import { PodcastEpisode } from '@/lib/types/podcasts'
import { AccessRole } from '@/lib/utils/access-role'
import { useTranslation } from '@/lib/hooks/use-translation'
import { DeleteEpisodeAction, RetryEpisodeButton, StatusBadge } from './EpisodeActions'

interface EpisodeCardProps {
  episode: PodcastEpisode
  onDelete: (episodeId: string) => Promise<void> | void
  deleting?: boolean
  onRetry?: (episodeId: string) => Promise<void> | void
  retrying?: boolean
  /** Missing role (open/auth-off mode, or callers that haven't wired ACLs) grants full access. */
  role?: AccessRole | null
}

export function EpisodeCard({ episode, onDelete, deleting, onRetry, retrying, role }: EpisodeCardProps) {
  const { t, language } = useTranslation()
  const href = `/podcasts/${encodeURIComponent(episode.id)}`

  const distance = episode.created
    ? formatDistanceToNow(new Date(episode.created), {
        addSuffix: true,
        locale: getDateLocale(language),
      })
    : null

  const createdLabel = distance
    ? t('podcasts.created', { time: distance })
    : null

  return (
    <div className="group relative flex items-center justify-between gap-3 rounded-[var(--surface-radius)] border bg-card px-3 py-2 transition-colors hover:bg-muted/50">
      {/* Stretched link: the whole row is clickable, while the action buttons
          below sit in a higher stacking layer and stay independently clickable. */}
      <Link
        href={href}
        aria-label={episode.name}
        className="absolute inset-0 rounded-[var(--surface-radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {episode.name}
          </span>
          <StatusBadge status={episode.job_status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('podcasts.profile')}: {episode.episode_profile?.name || t('common.unknown')}
          {createdLabel ? ` • ${createdLabel}` : ''}
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        <RetryEpisodeButton episode={episode} onRetry={onRetry} retrying={retrying} role={role} compact />
        <DeleteEpisodeAction episode={episode} onDelete={onDelete} deleting={deleting} role={role} compact />
      </div>
    </div>
  )
}
