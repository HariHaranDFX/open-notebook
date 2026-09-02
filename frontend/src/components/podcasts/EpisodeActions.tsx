'use client'

import { RefreshCcw, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'

import { EpisodeStatus, FAILED_EPISODE_STATUSES, PodcastEpisode } from '@/lib/types/podcasts'
import { cn } from '@/lib/utils'
import { AccessRole, canEditContent } from '@/lib/utils/access-role'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

/**
 * Shared podcast-episode actions used by both the list row (EpisodeCard)
 * and the detail page (EpisodeDetail): the status badge, the retry quick
 * action, and the delete confirm dialog. Kept in one module so the row
 * doesn't have to import from the detail-page component to get them.
 */

const getSTATUS_META = (t: TFunction): Record<
  EpisodeStatus | 'unknown',
  { label: string; className: string }
> => ({
  running: {
    label: t('podcasts.processingLabel'),
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  processing: {
    label: t('podcasts.processingLabel'),
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  completed: {
    label: t('podcasts.completedLabel'),
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  failed: {
    label: t('podcasts.failedLabel'),
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  error: {
    label: t('podcasts.failedLabel'),
    className: 'bg-red-100 text-red-800 border-red-200',
  },
  pending: {
    label: t('podcasts.pendingLabel'),
    className: 'bg-sky-100 text-sky-800 border-sky-200',
  },
  submitted: {
    label: t('podcasts.pendingLabel'),
    className: 'bg-sky-100 text-sky-800 border-sky-200',
  },
  unknown: {
    label: t('common.unknown'),
    className: 'bg-muted text-muted-foreground border-transparent',
  },
})

export function StatusBadge({
  status,
  showCompleted = false,
}: {
  status?: EpisodeStatus | null
  showCompleted?: boolean
}) {
  const { t } = useTranslation()
  if (status === 'completed' && !showCompleted) {
    return null
  }

  const meta = getSTATUS_META(t)[status ?? 'unknown']
  return (
    <Badge
      variant="outline"
      className={cn('uppercase tracking-wide text-xs', meta.className)}
    >
      {meta.label}
    </Badge>
  )
}

interface RetryEpisodeButtonProps {
  episode: PodcastEpisode
  onRetry?: (episodeId: string) => Promise<void> | void
  retrying?: boolean
  /** Missing role (open/auth-off mode, or callers that haven't wired ACLs) grants full access. */
  role?: AccessRole | null
  /** Collapse to icon-only on narrow screens so the row never wraps. */
  compact?: boolean
}

export function RetryEpisodeButton({ episode, onRetry, retrying, role, compact }: RetryEpisodeButtonProps) {
  const { t } = useTranslation()
  const isFailed = FAILED_EPISODE_STATUSES.includes(episode.job_status as EpisodeStatus)

  if (!isFailed || !onRetry || !canEditContent(role)) {
    return null
  }

  const handleRetry = () => {
    void onRetry(episode.id)
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying} aria-label={t('podcasts.retry')}>
      <RefreshCcw className={cn('h-4 w-4', retrying && 'animate-spin')} />
      <span className={cn(compact && 'hidden sm:inline')}>
        {retrying ? t('podcasts.retrying') : t('podcasts.retry')}
      </span>
    </Button>
  )
}

interface DeleteEpisodeActionProps {
  episode: PodcastEpisode
  onDelete: (episodeId: string) => Promise<void> | void
  deleting?: boolean
  /** Missing role (open/auth-off mode, or callers that haven't wired ACLs) grants full access. */
  role?: AccessRole | null
  /** Collapse to icon-only on narrow screens so the row never wraps. */
  compact?: boolean
}

export function DeleteEpisodeAction({ episode, onDelete, deleting, role, compact }: DeleteEpisodeActionProps) {
  const { t } = useTranslation()

  if (!canEditContent(role)) {
    return null
  }

  const handleDelete = () => {
    void onDelete(episode.id)
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('podcasts.delete')}
          className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          <span className={cn(compact && 'hidden sm:inline')}>{t('podcasts.delete')}</span>
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
  )
}
