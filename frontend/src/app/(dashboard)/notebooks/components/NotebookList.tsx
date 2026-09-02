'use client'

import { useId, useState } from 'react'
import { AlertTriangle, Book, ChevronDown, ChevronRight, Plus, RefreshCw } from 'lucide-react'

import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { NotebookResponse } from '@/lib/types/api'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { LibraryViewMode } from '@/lib/stores/library-view-store'
import { cn } from '@/lib/utils'
import { NotebookRow } from './NotebookRow'

interface NotebookListProps {
  notebooks?: NotebookResponse[]
  isLoading: boolean
  title: string
  collapsible?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onAction?: () => void
  actionLabel?: string
  isError?: boolean
  onRetry?: () => void
  viewMode?: LibraryViewMode
}

export function NotebookList({
  notebooks,
  isLoading,
  title,
  collapsible = false,
  emptyTitle,
  emptyDescription,
  onAction,
  actionLabel,
  isError = false,
  onRetry,
  viewMode = 'list',
}: NotebookListProps) {
  const { t } = useTranslation()
  const contentId = useId()
  const [isExpanded, setIsExpanded] = useState(!collapsible)
  const count = notebooks?.length ?? 0

  return (
    <section className="space-y-3" aria-labelledby={`${contentId}-title`}>
      <div className="flex min-h-9 items-center gap-2">
        {collapsible ? (
          <h2 id={`${contentId}-title`}>
            <Button
              variant="ghost"
              className="h-9 justify-start !px-0 text-lg font-semibold"
              onClick={() => setIsExpanded(value => !value)}
              aria-expanded={isExpanded}
              aria-controls={contentId}
            >
              {title}
              <Badge
                variant="secondary"
                className="pointer-events-none min-w-6 px-1.5 tabular-nums"
              >
                {count}
              </Badge>
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </Button>
          </h2>
        ) : (
          <>
            <h2 id={`${contentId}-title`} className="text-lg font-semibold">
              {title}
            </h2>
            <Badge variant="secondary" className="min-w-6 px-1.5 tabular-nums">
              {count}
            </Badge>
          </>
        )}
      </div>

      {isExpanded && (
        <div id={contentId}>
          {isLoading ? (
            <div
              className={cn(
                viewMode === 'card'
                  ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                  : 'overflow-hidden rounded-[var(--surface-radius)] border border-border',
              )}
              aria-label={t('common.loading')}
            >
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  data-testid="notebook-row-skeleton"
                  className={cn(
                    'grid animate-pulse bg-card',
                    viewMode === 'card'
                      ? 'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-3 rounded-[var(--surface-radius)] border border-border p-3'
                      : 'grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 border-b border-border px-2 py-2 last:border-b-0 sm:px-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-3',
                  )}
                >
                  <div
                    data-testid="notebook-skeleton-title"
                    className="col-start-1 row-start-1 min-w-0"
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <div className="size-7 shrink-0 rounded-[var(--control-radius)] bg-muted" />
                      <div className="h-4 w-1/2 min-w-24 rounded-sm bg-muted" />
                    </div>
                    <div className="mt-0.5 pl-8">
                      <div className="h-3 w-2/3 rounded-sm bg-muted" />
                    </div>
                  </div>

                  <div
                    data-testid="notebook-skeleton-metadata"
                    className={cn(
                      'flex flex-wrap items-center gap-y-1.5',
                      viewMode === 'card'
                        ? 'col-span-2 row-start-2 self-end gap-x-4 border-t border-border pt-3'
                        : 'col-span-2 row-start-2 gap-x-2 pl-8 md:col-span-1 md:row-start-auto md:gap-x-4 md:pl-0',
                    )}
                  >
                    <div className="h-5 w-14 rounded-[var(--pill-radius)] bg-muted" />
                    <div className="h-5 w-10 rounded-[var(--pill-radius)] bg-muted" />
                    <div className="h-5 w-10 rounded-[var(--pill-radius)] bg-muted" />
                    <div className="ml-auto h-3 w-20 rounded-sm bg-muted" />
                  </div>

                  <div
                    data-testid="notebook-skeleton-action"
                    className={cn(
                      'col-start-2 row-start-1 size-9 self-start justify-self-end rounded-[var(--control-radius)] bg-muted',
                      viewMode === 'list' && 'md:col-start-auto md:row-start-auto md:self-auto',
                    )}
                  />
                </div>
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              icon={AlertTriangle}
              title={t('common.contentUnavailable.errorTitle')}
              description={t('common.contentUnavailable.errorDescription')}
              action={onRetry ? (
                <Button onClick={onRetry} variant="outline" className="mt-4">
                  <RefreshCw />
                  {t('common.retry')}
                </Button>
              ) : undefined}
            />
          ) : !notebooks?.length ? (
            <EmptyState
              icon={Book}
              title={emptyTitle ?? t('common.noResults')}
              description={emptyDescription ?? t('chat.startByCreating')}
              action={onAction && actionLabel ? (
                <Button onClick={onAction} variant="outline" className="mt-4">
                  <Plus />
                  {actionLabel}
                </Button>
              ) : undefined}
            />
          ) : (
            <div
              data-testid="notebook-collection"
              data-view-mode={viewMode}
              className={cn(
                viewMode === 'card'
                  ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                  : 'overflow-hidden rounded-[var(--surface-radius)] border border-border',
              )}
            >
              {notebooks.map(notebook => (
                <NotebookRow key={notebook.id} notebook={notebook} viewMode={viewMode} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
