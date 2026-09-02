'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { AlertTriangle, LayoutTemplate, Mic } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EpisodesTab } from '@/components/podcasts/EpisodesTab'
import { TemplatesTab } from '@/components/podcasts/TemplatesTab'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useEpisodeProfiles, useSpeakerProfiles } from '@/lib/hooks/use-podcasts'
import { needsModelSetup } from '@/lib/types/podcasts'

type PodcastView = 'episodes' | 'templates'

function isPodcastView(value: string | null): value is PodcastView {
  return value === 'episodes' || value === 'templates'
}

export default function PodcastsPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // View is derived from the URL — the single source of truth (no second state).
  const rawView = searchParams?.get('view') ?? null
  const view: PodcastView = isPodcastView(rawView) ? rawView : 'episodes'

  const setView = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('view', next)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

  const { episodeProfiles } = useEpisodeProfiles()
  const { speakerProfiles } = useSpeakerProfiles(episodeProfiles)

  const hasUnconfiguredProfiles = useMemo(() => {
    return episodeProfiles.some(needsModelSetup) || speakerProfiles.some(needsModelSetup)
  }, [episodeProfiles, speakerProfiles])

  return (
    <AppShell>
      <PageFrame>
        <PageHeader
          title={t('podcasts.listTitle')}
          description={t('podcasts.listDesc')}
        />

        {hasUnconfiguredProfiles ? (
          <Alert className="border-warning/40 bg-warning-surface text-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('podcasts.setupRequired')}</AlertTitle>
            <AlertDescription>
              {t('podcasts.setupRequiredDesc')}
            </AlertDescription>
          </Alert>
        ) : null}

        <Tabs value={view} onValueChange={setView} className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('podcasts.chooseAView')}</p>
            <TabsList aria-label={t('common.accessibility.podcastViews')} className="w-full max-w-md">
              <TabsTrigger value="episodes">
                <Mic className="h-4 w-4" />
                {t('podcasts.episodesTab')}
              </TabsTrigger>
              <TabsTrigger value="templates">
                <LayoutTemplate className="h-4 w-4" />
                {t('podcasts.templatesTab')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="episodes">
            <EpisodesTab />
          </TabsContent>

          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>
        </Tabs>
      </PageFrame>
    </AppShell>
  )
}
