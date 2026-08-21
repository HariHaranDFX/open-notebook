'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { RefreshCcw, Trash2 } from 'lucide-react'

import { EpisodeStatus, FAILED_EPISODE_STATUSES, PodcastEpisode } from '@/lib/types/podcasts'
import { cn } from '@/lib/utils'
import { AccessRole, canDeleteSource, canEditContent } from '@/lib/utils/access-role'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslation } from '@/lib/hooks/use-translation'
import { StatusBadge } from './EpisodeDetail'

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

  const handleDelete = () => {
    void onDelete(episode.id)
  }

  const handleRetry = () => {
    if (onRetry) {
      void onRetry(episode.id)
    }
  }

  const isFailed = FAILED_EPISODE_STATUSES.includes(episode.job_status as EpisodeStatus)
  const canRetry = canEditContent(role)
  const canDelete = canDeleteSource(role)

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
          {isFailed && onRetry && canRetry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
            >
              <RefreshCcw className={cn('mr-2 h-4 w-4', retrying && 'animate-spin')} />
              {retrying ? t('podcasts.retrying') : t('podcasts.retry')}
            </Button>
          ) : null}
          {canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('podcasts.delete')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('podcasts.deleteEpisodeTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('podcasts.deleteEpisodeDesc', { name: episode.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                    {deleting ? t('podcasts.deleting') : t('podcasts.delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
