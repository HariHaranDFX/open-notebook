'use client'

import { useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { MessageCircleQuestion, Search } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AskWorkspace } from '@/components/search/AskWorkspace'
import { SearchWorkspace } from '@/components/search/SearchWorkspace'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function SearchPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Mode is derived from the URL — the single source of truth (no second state).
  const q = searchParams?.get('q') || ''
  const activeMode: 'ask' | 'search' = searchParams?.get('mode') === 'search' ? 'search' : 'ask'

  const setMode = useCallback((mode: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('mode', mode)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
        {/* Ask/Search header only (not the shared PageHeader): a single row that
            never wraps — title + description on the left, compact mode tabs on
            the right, all vertically centered. */}
        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight text-foreground sm:text-xl">
              {t('searchPage.askAndSearch')}
            </h1>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              {t('searchPage.askAndSearchDesc')}
            </p>
          </div>
          <Tabs value={activeMode} onValueChange={setMode} className="shrink-0">
            <TabsList aria-label={t('common.accessibility.searchKB')} className="gap-2 p-1.5">
              <TabsTrigger value="ask" className="h-7 flex-none gap-1 whitespace-nowrap px-2.5 text-xs">
                <MessageCircleQuestion className="size-3.5" />
                {t('searchPage.askBeta')}
              </TabsTrigger>
              <TabsTrigger value="search" className="h-7 flex-none gap-1 whitespace-nowrap px-2.5 text-xs">
                <Search className="size-3.5" />
                {t('searchPage.search')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </header>

        <div className="min-h-0 flex-1">
          {activeMode === 'ask' ? (
            <AskWorkspace initialQuestion={q} />
          ) : (
            <SearchWorkspace initialQuery={q} />
          )}
        </div>
      </div>
    </AppShell>
  )
}
