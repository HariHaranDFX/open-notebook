'use client'

import { useState } from 'react'
import { useDebounce } from 'use-debounce'
import {
  AlertTriangle,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react'

import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LibraryToolbar } from '@/components/common/LibraryToolbar'
import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { AddSourceButton } from '@/components/sources/AddSourceButton'
import { SourceLibraryRow } from '@/components/sources/SourceLibraryRow'
import { Button } from '@/components/ui/button'
import type { SourceSortField } from '@/lib/api/sources'
import {
  useDeleteSource,
  useRetrySource,
  useSourceLibrary,
} from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useLibraryView } from '@/lib/stores/library-view-store'
import type { SourceListResponse } from '@/lib/types/api'
import { cn } from '@/lib/utils'

const sortOptions: Array<{ value: SourceSortField; label: string }> = [
  { value: 'updated', label: 'common.updated_label' },
  { value: 'title', label: 'common.title' },
  { value: 'created', label: 'common.created_label' },
  { value: 'type', label: 'common.type' },
  { value: 'insights_count', label: 'sources.insights' },
  { value: 'embedded', label: 'sources.embedded' },
]

function SourceLibrarySkeleton({
  label,
  viewMode,
}: {
  label: string
  viewMode: 'list' | 'card'
}) {
  return (
    <div
      className={cn(
        viewMode === 'card'
          ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
          : 'overflow-hidden rounded-[var(--surface-radius)] border border-border',
      )}
      aria-busy="true"
    >
      <span className="sr-only" role="status">{label}</span>
      <div aria-hidden="true" className="contents">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            data-testid="source-library-skeleton"
            className={cn(
              'grid animate-pulse bg-card',
              viewMode === 'card'
                ? 'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-3 rounded-[var(--surface-radius)] border border-border p-3'
                : 'grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 border-b border-border px-2 py-2 last:border-b-0 sm:px-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-3',
            )}
          >
            <div data-testid="source-skeleton-title" className="col-start-1 row-start-1 min-w-0">
              {viewMode === 'card' && (
                <div data-testid="source-skeleton-state" className="flex flex-wrap items-center gap-2">
                  <div className="h-5 w-20 rounded-[var(--pill-radius)] bg-muted" />
                  <div className="h-5 w-16 rounded-[var(--pill-radius)] bg-muted" />
                </div>
              )}
              <div className={cn('flex min-w-0 items-center gap-1', viewMode === 'card' && 'mt-3')}>
                <div className="size-7 shrink-0 rounded-[var(--control-radius)] bg-muted" />
                <div className="h-4 w-1/2 min-w-24 rounded-sm bg-muted" />
              </div>
              <div data-testid="source-skeleton-description" className="mt-0.5 pl-8">
                <div className="h-3 w-3/5 rounded-sm bg-muted" />
              </div>
            </div>

            <div
              data-testid="source-skeleton-metadata"
              className={cn(
                'flex min-w-0 flex-wrap items-center gap-2',
                viewMode === 'card'
                  ? 'col-span-2 row-start-2 self-end border-t border-border pt-3'
                  : 'col-span-2 row-start-2 pl-8 md:col-span-1 md:row-start-auto md:justify-end md:pl-0',
              )}
            >
              <div className="h-5 w-12 rounded-[var(--pill-radius)] bg-muted" />
              <div className="h-5 w-14 rounded-[var(--pill-radius)] bg-muted" />
              {viewMode === 'list' && (
                <>
                  <div className="h-5 w-20 rounded-[var(--pill-radius)] bg-muted" />
                  <div className="h-5 w-16 rounded-[var(--pill-radius)] bg-muted" />
                </>
              )}
              <div className="h-5 w-9 rounded-[var(--pill-radius)] bg-muted" />
              <div className="ml-auto h-3 w-20 rounded-sm bg-muted" />
            </div>

            <div
              data-testid="source-skeleton-action"
              className={cn(
                'col-start-2 row-start-1 size-9 self-start justify-self-end rounded-[var(--control-radius)] bg-muted',
                viewMode === 'list' && 'md:col-start-auto md:row-start-auto md:self-auto',
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SourcesPage() {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch] = useDebounce(searchTerm, 300)
  const [sortBy, setSortBy] = useState<SourceSortField>('updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const { viewMode, setViewMode } = useLibraryView('sources')
  const [sourceToDelete, setSourceToDelete] = useState<SourceListResponse | null>(null)
  const normalizedQuery = debouncedSearch.trim()
  const {
    sources,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    error,
    isFetchNextPageError,
    isRefetchError,
  } = useSourceLibrary({
    query: normalizedQuery,
    sortBy,
    sortOrder,
  })
  const deleteSource = useDeleteSource()
  const retrySource = useRetrySource()

  const handleDeleteConfirm = () => {
    if (!sourceToDelete) return
    deleteSource.mutate(sourceToDelete.id, {
      onSuccess: () => setSourceToDelete(null),
    })
  }

  return (
    <AppShell>
      <PageFrame className="space-y-4 py-4 sm:py-4">
        <PageHeader
          title={t('sources.title')}
          description={t('sources.allSourcesDesc')}
          secondaryActions={(
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCw />
              {t('common.refresh')}
            </Button>
          )}
          primaryAction={<AddSourceButton />}
        />

        <LibraryToolbar
          id="source-library"
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchLabel={t('sources.librarySearchLabel')}
          searchPlaceholder={t('sources.librarySearchPlaceholder')}
          sortValue={sortBy}
          onSortChange={value => setSortBy(value as SourceSortField)}
          sortLabel={t('sources.sortLabel')}
          sortOptions={sortOptions.map(option => ({
            value: option.value,
            label: t(option.label),
          }))}
          sortDirection={sortOrder}
          onSortDirectionChange={setSortOrder}
          sortDirectionLabel={t('sources.sortDirection')}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          viewModeLabel={t('common.viewMode')}
          listLabel={t('common.listView')}
          cardLabel={t('common.cardView')}
        />

        {isLoading ? (
          <SourceLibrarySkeleton label={t('common.loading')} viewMode={viewMode} />
        ) : error && sources.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={t('sources.failedToLoad')}
            description={t('common.contentUnavailable.errorDescription')}
            action={(
              <Button variant="outline" onClick={() => void refetch()}>
                <RefreshCw />
                {t('common.retry')}
              </Button>
            )}
          />
        ) : sources.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={normalizedQuery ? t('common.noMatches') : t('sources.noSourcesYet')}
            description={normalizedQuery ? t('common.tryDifferentSearch') : t('sources.allSourcesDescShort')}
            action={!normalizedQuery ? <AddSourceButton variant="outline" /> : undefined}
          />
        ) : (
          <div
            data-view-mode={viewMode}
            className={cn(
              viewMode === 'card'
                ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'
                : 'overflow-hidden rounded-[var(--surface-radius)] border border-border',
            )}
          >
            {sources.map(source => (
              <SourceLibraryRow
                key={source.id}
                source={source}
                onDelete={setSourceToDelete}
                onRetry={sourceId => retrySource.mutate(sourceId)}
                isRetrying={retrySource.isPending && retrySource.variables === source.id}
                viewMode={viewMode}
              />
            ))}
          </div>
        )}

        {sources.length > 0 && (isFetchNextPageError || isRefetchError) && (
          <div className="flex flex-col gap-3 border border-warning/40 bg-warning-surface p-4 text-warning sm:flex-row sm:items-center sm:justify-between" role="alert">
            <p>{t('common.contentUnavailable.errorDescription')}</p>
            <Button
              variant="outline"
              onClick={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
            >
              <RefreshCw />
              {t('common.retry')}
            </Button>
          </div>
        )}

        {hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage && <Loader2 className="animate-spin" />}
              {t('sources.loadMore')}
            </Button>
          </div>
        )}
      </PageFrame>

      <ConfirmDialog
        open={sourceToDelete !== null}
        onOpenChange={open => !open && setSourceToDelete(null)}
        title={t('sources.delete')}
        description={t('sources.deleteConfirmWithTitle', {
          title: sourceToDelete?.title || t('sources.untitledSource'),
        })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfirm}
        isLoading={deleteSource.isPending}
      />
    </AppShell>
  )
}
