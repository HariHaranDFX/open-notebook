'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EpisodeDetail } from '@/components/podcasts/EpisodeDetail'
import { Button } from '@/components/ui/button'
import {
  useDeletePodcastEpisode,
  usePodcastEpisode,
  useRetryPodcastEpisode,
} from '@/lib/hooks/use-podcasts'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function EpisodeDetailPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useParams()
  const episodeId = params?.id ? decodeURIComponent(params.id as string) : ''
  const { data: episode, isLoading } = usePodcastEpisode(episodeId)
  const deleteEpisode = useDeletePodcastEpisode()
  const retryEpisode = useRetryPodcastEpisode()

  const handleBack = useCallback(() => router.push('/podcasts'), [router])

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteEpisode.mutateAsync(id)
      router.push('/podcasts')
    },
    [deleteEpisode, router]
  )

  const handleRetry = useCallback(
    async (id: string) => {
      await retryEpisode.mutateAsync(id)
    },
    [retryEpisode]
  )

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center p-8">
          <LoadingSpinner />
        </div>
      </AppShell>
    )
  }

  if (!episode) {
    return (
      <AppShell>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t('podcasts.episodeNotFound')}</h1>
            <p className="text-muted-foreground">{t('podcasts.episodeNotFoundDesc')}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/podcasts">
              <ArrowLeft />
              {t('podcasts.backToPodcasts')}
            </Link>
          </Button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <PageFrame>
        <PageHeader
          title={episode.name}
          eyebrow={t('podcasts.listTitle')}
          secondaryActions={
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              {t('common.back')}
            </Button>
          }
        />
        <EpisodeDetail
          episode={episode}
          onDelete={handleDelete}
          deleting={deleteEpisode.isPending}
          onRetry={handleRetry}
          retrying={retryEpisode.isPending}
        />
      </PageFrame>
    </AppShell>
  )
}
