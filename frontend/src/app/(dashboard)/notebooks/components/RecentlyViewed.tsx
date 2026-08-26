'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

import { ResourceTypeIcon } from '@/components/common/ResourceTypeIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { notebooksApi } from '@/lib/api/notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { LibraryViewMode } from '@/lib/stores/library-view-store'
import type { RecentlyViewedResponse } from '@/lib/types/api'
import { cn } from '@/lib/utils'
import { formatCompactRelativeTime } from '@/lib/utils/relative-time'

interface RecentlyViewedProps {
  viewMode: LibraryViewMode
  limit?: number
}

function getItemHref(item: RecentlyViewedResponse) {
  return `/${item.type === 'notebook' ? 'notebooks' : 'sources'}/${encodeURIComponent(item.id)}`
}

export function RecentlyViewed({ viewMode, limit = 12 }: RecentlyViewedProps) {
  const { t, language } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)
  const { data: items, isLoading, isError, refetch } = useQuery({
    queryKey: ['recently-viewed', limit],
    queryFn: () => notebooksApi.recentlyViewed(limit),
  })

  if (isLoading) return null

  if (isError) {
    return (
      <section className="flex flex-wrap items-center gap-3 border border-warning/40 bg-warning-surface p-4 text-warning" aria-labelledby="recently-viewed-error-title">
        <AlertTriangle className="size-4" />
        <h2 id="recently-viewed-error-title" className="font-semibold">{t('notebooks.recentlyViewed')}</h2>
        <p className="text-sm">{t('common.contentUnavailable.errorDescription')}</p>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void refetch()}>
          <RefreshCw />
          {t('common.retry')}
        </Button>
      </section>
    )
  }

  if (!items?.length) return null

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-3">
      <div className="flex min-h-9 items-center gap-2">
        <h2>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="justify-start !px-0 text-lg font-semibold">
              {t('notebooks.recentlyViewed')}
              <Badge
                variant="secondary"
                className="pointer-events-none min-w-6 px-1.5 tabular-nums"
              >
                {items.length}
              </Badge>
              {isOpen
                ? <ChevronDown />
                : <ChevronRight />}
            </Button>
          </CollapsibleTrigger>
        </h2>
      </div>

      <CollapsibleContent>
        <div
          data-testid="recently-viewed-collection"
          data-view-mode={viewMode}
          className={cn(
            viewMode === 'card'
              ? 'grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5'
              : 'overflow-hidden rounded-[var(--surface-radius)] border border-border',
          )}
        >
          {items.map(item => {
            const typeLabel = item.type === 'notebook'
              ? t('notebooks.recentlyViewedNotebook')
              : t('notebooks.recentlyViewedSource')

            return (
              <Link
                key={`${item.type}-${item.id}`}
                href={getItemHref(item)}
                title={item.title}
                className={cn(
                  'group min-w-0 bg-card outline-none transition-colors duration-[var(--motion-standard)] hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  viewMode === 'card'
                    ? 'flex min-h-28 flex-col gap-3 rounded-[var(--surface-radius)] border border-border p-3'
                    : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-2 py-2 last:border-b-0 sm:px-3',
                )}
              >
                <span
                  className="flex min-w-0 items-center gap-2"
                >
                  <ResourceTypeIcon
                    kind={item.type === 'notebook' ? 'notebook' : 'source'}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary"
                  >
                    {item.title}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex items-center gap-2',
                    viewMode === 'card'
                      ? 'mt-auto flex-wrap justify-between border-t border-border pt-3'
                      : 'shrink-0 flex-nowrap justify-end',
                  )}
                >
                  <Badge variant="outline">{typeLabel}</Badge>
                    <time
                      dateTime={item.last_viewed_at}
                      title={item.last_viewed_at}
                      className={cn(
                        'text-xs text-muted-foreground',
                        viewMode === 'card' && 'ml-auto self-end',
                      )}
                    >
                    {formatCompactRelativeTime(item.last_viewed_at, language)}
                  </time>
                </span>
              </Link>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
