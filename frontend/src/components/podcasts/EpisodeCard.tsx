'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'

import { PodcastEpisode } from '@/lib/types/podcasts'
import { AccessRole } from '@/lib/utils/access-role'
import { Card, CardContent } from '@/components/ui/card'
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
    <Card className="shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/podcasts/${encodeURIComponent(episode.id)}`}
              className="truncate text-base font-semibold text-foreground hover:underline"
            >
              {episode.name}
            </Link>
            <StatusBadge status={episode.job_status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('podcasts.profile')}: {episode.episode_profile?.name || t('common.unknown')}
            {createdLabel ? ` • ${createdLabel}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RetryEpisodeButton episode={episode} onRetry={onRetry} retrying={retrying} role={role} />
          <DeleteEpisodeAction episode={episode} onDelete={onDelete} deleting={deleting} role={role} />
        </div>
      </CardContent>
    </Card>
  )
}
