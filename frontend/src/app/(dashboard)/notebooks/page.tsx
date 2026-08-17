'use client'

import { useMemo, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'

import { LibraryToolbar } from '@/components/common/LibraryToolbar'
import { AppShell } from '@/components/layout/AppShell'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { Button } from '@/components/ui/button'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useLibraryView } from '@/lib/stores/library-view-store'
import type { NotebookResponse } from '@/lib/types/api'
import { NotebookList } from './components/NotebookList'
import { RecentlyViewed } from './components/RecentlyViewed'

type NotebookSortField = 'updated' | 'name' | 'created'

const notebookSortOptions: Array<{ value: NotebookSortField; label: string }> = [
  { value: 'updated', label: 'common.updated_label' },
  { value: 'name', label: 'common.name' },
  { value: 'created', label: 'common.created_label' },
]

function filterNotebooks(
  notebooks: NotebookResponse[] | undefined,
  query: string,
) {
  if (!notebooks) return notebooks

  return notebooks.filter(notebook => !query || notebook.name.toLowerCase().includes(query))
}

export default function NotebooksPage() {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<NotebookSortField>('updated')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const { viewMode, setViewMode } = useLibraryView('notebooks')
  const {
    data: notebooks,
    isLoading,
    isError: activeError,
    refetch: refetchActive,
  } = useNotebooks(false, `${sortBy} ${sortDirection}`)
  const {
    data: archivedNotebooks,
    isLoading: archivedLoading,
    isError: archivedError,
    refetch: refetchArchived,
  } = useNotebooks(true, `${sortBy} ${sortDirection}`)

  const normalizedQuery = searchTerm.trim().toLowerCase()
  const filteredActive = useMemo(
    () => filterNotebooks(notebooks, normalizedQuery),
    [notebooks, normalizedQuery],
  )
  const filteredArchived = useMemo(
    () => filterNotebooks(archivedNotebooks, normalizedQuery),
    [archivedNotebooks, normalizedQuery],
  )
  const isSearching = normalizedQuery.length > 0
  const showArchived = (archivedNotebooks?.length ?? 0) > 0 || isSearching

  return (
    <AppShell>
      <PageFrame className="space-y-4 py-4 sm:py-4">
        <PageHeader
          title={t('notebooks.title')}
          description={t('notebooks.description')}
          secondaryActions={(
            <Button
              variant="outline"
              onClick={() => void Promise.all([refetchActive(), refetchArchived()])}
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
            notebooks={filteredActive}
            isLoading={isLoading}
            isError={activeError}
            onRetry={() => void refetchActive()}
            title={t('notebooks.activeNotebooks')}
            emptyTitle={isSearching ? t('common.noMatches') : undefined}
            emptyDescription={isSearching ? t('common.tryDifferentSearch') : undefined}
            onAction={!isSearching ? () => setCreateDialogOpen(true) : undefined}
            actionLabel={!isSearching ? t('notebooks.newNotebook') : undefined}
            viewMode={viewMode}
          />
          {showArchived && (
            <NotebookList
              notebooks={filteredArchived}
              isLoading={archivedLoading}
              isError={archivedError}
              onRetry={() => void refetchArchived()}
              title={t('notebooks.archivedNotebooks')}
              collapsible
              emptyTitle={isSearching ? t('common.noMatches') : undefined}
              emptyDescription={isSearching ? t('common.tryDifferentSearch') : undefined}
              viewMode={viewMode}
            />
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
