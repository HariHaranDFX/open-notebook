'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, Loader2, RefreshCcw } from 'lucide-react'

import { useDeletePodcastEpisode, usePodcastEpisodes, useRetryPodcastEpisode } from '@/lib/hooks/use-podcasts'
import { EpisodeCard } from '@/components/podcasts/EpisodeCard'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { GeneratePodcastDialog } from '@/components/podcasts/GeneratePodcastDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import type { TFunction } from 'i18next'

const getSTATUS_ORDER = (t: TFunction): Array<{
  key: 'running' | 'completed' | 'failed' | 'pending'
  title: string
  description?: string
}> => [
  {
    key: 'running',
    title: t('podcasts.statusRunningTitle'),
    description: t('podcasts.statusRunningDesc'),
  },
  {
    key: 'pending',
    title: t('podcasts.statusPendingTitle'),
    description: t('podcasts.statusPendingDesc'),
  },
  {
    key: 'completed',
    title: t('podcasts.statusCompletedTitle'),
    description: t('podcasts.statusCompletedDesc'),
  },
  {
    key: 'failed',
    title: t('podcasts.statusFailedTitle'),
    description: t('podcasts.statusFailedDesc'),
  },
]

function StatChip({
  label,
  value,
  dotClass,
  alert,
}: {
  label: string
  value: number
  dotClass?: string
  alert?: boolean
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-[var(--surface-radius)] border bg-card px-3 py-1.5',
        alert && value > 0 && 'border-destructive/40 bg-destructive/5'
      )}
    >
      {dotClass ? <span className={cn('h-2 w-2 rounded-full', dotClass)} /> : null}
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export function EpisodesTab() {
  const { t } = useTranslation()
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const {
    episodes,
    statusGroups,
    statusCounts,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = usePodcastEpisodes()
  const deleteEpisode = useDeletePodcastEpisode()
  const retryEpisode = useRetryPodcastEpisode()

  const handleRefresh = useCallback(() => {
    void refetch()
  }, [refetch])

  const handleDelete = useCallback(
    (episodeId: string) => deleteEpisode.mutateAsync(episodeId),
    [deleteEpisode]
  )

  const handleRetry = useCallback(
    async (episodeId: string) => { await retryEpisode.mutateAsync(episodeId) },
    [retryEpisode]
  )

  const emptyState = !isLoading && episodes.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t('podcasts.overviewTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('podcasts.overviewDesc')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowGenerateDialog(true)}>
            {t('podcasts.generateBtn')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatChip label={t('podcasts.total')} value={statusCounts.total} />
        <StatChip label={t('podcasts.processingLabel')} value={statusCounts.running} dotClass="bg-amber-500" />
        <StatChip label={t('podcasts.pendingLabel')} value={statusCounts.pending} dotClass="bg-sky-500" />
        <StatChip label={t('podcasts.completedLabel')} value={statusCounts.completed} dotClass="bg-emerald-500" />
        <StatChip label={t('podcasts.failedLabel')} value={statusCounts.failed} dotClass="bg-red-500" alert />
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('podcasts.loadErrorTitle')}</AlertTitle>
          <AlertDescription>
            {t('podcasts.loadErrorDesc')}
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-3 rounded-[var(--surface-radius)] border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('podcasts.loadingEpisodes')}
        </div>
      ) : null}

      {emptyState ? (
        <div className="rounded-[var(--surface-radius)] border border-dashed bg-muted/30 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {t('podcasts.noEpisodesYet')}
          </p>
        </div>
      ) : null}

      {getSTATUS_ORDER(t).map(({ key, title, description }) => {
        const data = statusGroups[key]
        if (!data || data.length === 0) {
          return null
        }

        return (
          <section key={key} className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold leading-tight">{title}</h3>
              {description ? (
                <p className="text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <Separator />
            <div className="space-y-2">
              {data.map((episode) => (
                <EpisodeCard
                  key={episode.id}
                  episode={episode}
                  role={episode.access_role}
                  onDelete={handleDelete}
                  deleting={deleteEpisode.isPending}
                  onRetry={handleRetry}
                  retrying={retryEpisode.isPending}
                />
              ))}
            </div>
          </section>
        )
      })}

      <GeneratePodcastDialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
      />
    </div>
  )
}
