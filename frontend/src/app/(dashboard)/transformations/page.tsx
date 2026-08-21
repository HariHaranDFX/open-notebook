'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DefaultPromptEditor } from './components/DefaultPromptEditor'
import { TransformationsList } from './components/TransformationsList'
import { TransformationPlayground } from './components/TransformationPlayground'
import { useTransformations } from '@/lib/hooks/use-transformations'
import { useAuth } from '@/lib/hooks/use-auth'
import { Transformation } from '@/lib/types/transformations'
import { Wand2, Play, RefreshCw } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'

type TransformationView = 'library' | 'playground'

function isTransformationView(value: string | null): value is TransformationView {
  return value === 'library' || value === 'playground'
}

export default function TransformationsPage() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { data: transformations, isLoading, refetch } = useTransformations()

  // View and selection are derived from the URL — the single source of
  // truth (no shadow useState mirroring either one).
  const rawView = searchParams?.get('view') ?? null
  const view: TransformationView = isTransformationView(rawView) ? rawView : 'library'
  const selectedTransformationId = searchParams?.get('transformation') || undefined

  const setView = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('view', next)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

  const handlePlayground = useCallback(
    (transformation: Transformation) => {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('view', 'playground')
      params.set('transformation', transformation.id)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

  const handleBackToLibrary = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('view', 'library')
    params.delete('transformation')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

  return (
    <AppShell>
      <PageFrame>
        <PageHeader
          title={t('transformations.title')}
          description={t('transformations.desc')}
          secondaryActions={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </Button>
          }
        />

        <Tabs value={view} onValueChange={setView} className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('transformations.workspace')}</p>
            <TabsList aria-label={t('common.accessibility.transformationViews')} className="w-full max-w-xl">
              <TabsTrigger value="library" className="flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                {t('transformations.title')}
              </TabsTrigger>
              <TabsTrigger value="playground" className="flex items-center gap-2">
                <Play className="h-4 w-4" />
                {t('transformations.playground')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="library" className="space-y-6">
            {isAdmin && <DefaultPromptEditor />}
            <TransformationsList
              transformations={transformations}
              isLoading={isLoading}
              onPlayground={handlePlayground}
            />
          </TabsContent>

          <TabsContent value="playground">
            <TransformationPlayground
              transformations={transformations}
              selectedTransformationId={selectedTransformationId}
              onBackToLibrary={handleBackToLibrary}
            />
          </TabsContent>
        </Tabs>
      </PageFrame>
    </AppShell>
  )
}
