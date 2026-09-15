'use client'

import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'

import { LibraryToolbar } from '@/components/common/LibraryToolbar'
import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { Button } from '@/components/ui/button'
import type { NotebookSortField } from '@/lib/api/notebooks'
import { useNotebookLibrary } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useLibraryView } from '@/lib/stores/library-view-store'
import { NotebookList } from './components/NotebookList'
import { RecentlyViewed } from './components/RecentlyViewed'

const notebookSortOptions: Array<{ value: NotebookSortField; label: string }> = [
  { value: 'updated', label: 'common.updated_label' },
  { value: 'name', label: 'common.name' },
  { value: 'created', label: 'common.created_label' },
]

export default function NotebooksPage() {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<NotebookSortField>('updated')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const { viewMode, setViewMode } = useLibraryView('notebooks')

  // Search is server-backed via the library route; normalize to match the
  // backend's fingerprint (trim + lowercase) so cursor and query stay aligned.
  const normalizedQuery = searchTerm.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0

  const active = useNotebookLibrary({
    archived: false,
    query: normalizedQuery,
    sortBy,
    sortOrder: sortDirection,
  })
  const archived = useNotebookLibrary({
    archived: true,
    query: normalizedQuery,
    sortBy,
    sortOrder: sortDirection,
  })

  const showArchived = archived.notebooks.length > 0 || isSearching || archived.isLoading

  return (
    <AppShell>
      <PageFrame className="space-y-4 py-4 sm:py-4">
        <PageHeader
          title={t('notebooks.title')}
          description={t('notebooks.description')}
          secondaryActions={(
            <Button
              variant="outline"
              onClick={() => void Promise.all([active.refetch(), archived.refetch()])}
            >
              <RefreshCw />
              {t('common.refresh')}
            </Button>
          )}
          primaryAction={(
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus />
              {t('notebooks.newNotebook')}
            </Button>
          )}
        />

        <LibraryToolbar
          id="notebook-library"
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchLabel={t('common.accessibility.searchNotebooks')}
          searchPlaceholder={t('notebooks.searchPlaceholder')}
          sortValue={sortBy}
          onSortChange={value => setSortBy(value as NotebookSortField)}
          sortLabel={t('notebooks.sortLabel')}
          sortOptions={notebookSortOptions.map(option => ({
            value: option.value,
            label: t(option.label),
          }))}
          sortDirection={sortDirection}
          onSortDirectionChange={setSortDirection}
          sortDirectionLabel={t('notebooks.sortDirection')}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          viewModeLabel={t('common.viewMode')}
          listLabel={t('common.listView')}
          cardLabel={t('common.cardView')}
        />

        <div className="space-y-8">
          {!isSearching && <RecentlyViewed viewMode={viewMode} />}
          <NotebookList
            notebooks={active.notebooks}
            isLoading={active.isLoading}
            isError={active.isError}
            onRetry={() => void active.refetch()}
            title={t('notebooks.activeNotebooks')}
            emptyTitle={isSearching ? t('common.noMatches') : undefined}
            emptyDescription={isSearching ? t('common.tryDifferentSearch') : undefined}
            onAction={!isSearching ? () => setCreateDialogOpen(true) : undefined}
            actionLabel={!isSearching ? t('notebooks.newNotebook') : undefined}
            viewMode={viewMode}
            hasNextPage={active.hasNextPage}
            isFetchingNextPage={active.isFetchingNextPage}
            onLoadMore={() => void active.fetchNextPage()}
            loadMoreLabel={t('notebooks.loadMore')}
          />
          {/* Later-page errors must not hide already-loaded rows — mirror
              the retryable pattern from the sources library. */}
          {active.notebooks.length > 0
            && (active.isFetchNextPageError || active.isRefetchError) && (
            <div
              className="flex flex-col gap-3 border border-warning/40 bg-warning-surface p-4 text-warning sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <p>{t('common.contentUnavailable.errorDescription')}</p>
              <Button
                variant="outline"
                onClick={() => void (active.isFetchNextPageError ? active.fetchNextPage() : active.refetch())}
              >
                <RefreshCw />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {showArchived && (
            <NotebookList
              notebooks={archived.notebooks}
              isLoading={archived.isLoading}
              isError={archived.isError}
              onRetry={() => void archived.refetch()}
              title={t('notebooks.archivedNotebooks')}
              collapsible
              emptyTitle={isSearching ? t('common.noMatches') : undefined}
              emptyDescription={isSearching ? t('common.tryDifferentSearch') : undefined}
              viewMode={viewMode}
              hasNextPage={archived.hasNextPage}
              isFetchingNextPage={archived.isFetchingNextPage}
              onLoadMore={() => void archived.fetchNextPage()}
              loadMoreLabel={t('notebooks.loadMore')}
            />
          )}

          {showArchived && archived.notebooks.length > 0
            && (archived.isFetchNextPageError || archived.isRefetchError) && (
            <div
              className="flex flex-col gap-3 border border-warning/40 bg-warning-surface p-4 text-warning sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <p>{t('common.contentUnavailable.errorDescription')}</p>
              <Button
                variant="outline"
                onClick={() => void (archived.isFetchNextPageError ? archived.fetchNextPage() : archived.refetch())}
              >
                <RefreshCw />
                {t('common.retry')}
              </Button>
            </div>
          )}
        </div>
      </PageFrame>

      <CreateNotebookDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </AppShell>
  )
}
