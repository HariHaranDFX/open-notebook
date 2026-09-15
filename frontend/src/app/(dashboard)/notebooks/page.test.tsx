import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import NotebooksPage from './page'

const { useNotebookLibraryMock } = vi.hoisted(() => ({
  useNotebookLibraryMock: vi.fn(),
}))

const activeNotebooks = [
  {
    id: 'notebook:older',
    name: 'Older notebook',
    description: '',
    archived: false,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
    source_count: 0,
    note_count: 0,
  },
  {
    id: 'notebook:newer',
    name: 'Newer notebook',
    description: '',
    archived: false,
    created: '2026-02-01T00:00:00Z',
    updated: '2026-02-02T00:00:00Z',
    source_count: 0,
    note_count: 0,
  },
]

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/layout/PageFrame', () => ({
  PageFrame: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="page-frame" className={className}>{children}</div>
  ),
}))

vi.mock('@/components/notebooks/CreateNotebookDialog', () => ({
  CreateNotebookDialog: () => null,
}))

vi.mock('./components/RecentlyViewed', () => ({ RecentlyViewed: () => null }))

vi.mock('./components/NotebookList', () => ({
  NotebookList: ({
    notebooks,
    title,
    hasNextPage,
    onLoadMore,
    loadMoreLabel,
  }: {
    notebooks?: Array<{ id: string; name: string }>
    title: string
    hasNextPage?: boolean
    onLoadMore?: () => void
    loadMoreLabel?: string
  }) => (
    <section aria-label={title}>
      <ul>{notebooks?.map(notebook => <li key={notebook.id}>{notebook.name}</li>)}</ul>
      {hasNextPage && (
        <button type="button" onClick={onLoadMore} data-testid={`load-more-${title}`}>
          {loadMoreLabel}
        </button>
      )}
    </section>
  ),
}))

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebookLibrary: useNotebookLibraryMock,
}))

vi.mock('@/lib/stores/library-view-store', () => ({
  useLibraryView: () => ({ viewMode: 'list', setViewMode: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common.accessibility.searchNotebooks': 'Search notebooks',
      'common.cardView': 'Cards',
      'common.created_label': 'Created',
      'common.listView': 'List',
      'common.refresh': 'Refresh',
      'common.name': 'Name',
      'common.updated_label': 'Updated',
      'common.viewMode': 'Collection view',
      'notebooks.activeNotebooks': 'Active notebooks',
      'notebooks.archivedNotebooks': 'Archived notebooks',
      'notebooks.description': 'Organize sources, notes, and research in focused workspaces.',
      'notebooks.loadMore': 'Load more notebooks',
      'notebooks.newNotebook': 'New notebook',
      'notebooks.searchPlaceholder': 'Search notebooks...',
      'notebooks.sortDirection': 'Change sort direction',
      'notebooks.sortLabel': 'Sort notebooks',
      'notebooks.title': 'Notebooks',
    })[key] ?? key,
  }),
}))

interface LibraryHookOverrides {
  notebooks?: Array<{ id: string; name: string; archived?: boolean }>
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  refetch?: () => void
  isLoading?: boolean
  isError?: boolean
}

function libraryState(overrides: LibraryHookOverrides = {}) {
  return {
    notebooks: [],
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    isError: false,
    isFetchNextPageError: false,
    isRefetchError: false,
    error: null,
    ...overrides,
  }
}

describe('NotebooksPage', () => {
  it('drives active and archived collections with independent library queries', () => {
    useNotebookLibraryMock.mockImplementation(({ archived }: { archived: boolean }) =>
      libraryState({
        notebooks: archived ? [] : activeNotebooks,
      }),
    )

    render(<NotebooksPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Notebooks' })).toBeVisible()
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Older notebook',
      'Newer notebook',
    ])
    expect(useNotebookLibraryMock).toHaveBeenCalledWith(
      expect.objectContaining({ archived: false, query: '', sortBy: 'updated', sortOrder: 'desc' }),
    )
    expect(useNotebookLibraryMock).toHaveBeenCalledWith(
      expect.objectContaining({ archived: true, query: '', sortBy: 'updated', sortOrder: 'desc' }),
    )
  })

  it('propagates the search term to the server (no client-only filtering)', () => {
    useNotebookLibraryMock.mockImplementation(() => libraryState({ notebooks: activeNotebooks }))

    render(<NotebooksPage />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notebooks' }), {
      target: { value: 'evidence' },
    })

    // Search term is normalized (trimmed, lowercased) and sent to the hook.
    expect(useNotebookLibraryMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'evidence', archived: false }),
    )
  })

  it('surfaces Load more per collection when hasNextPage is true', () => {
    const activeFetchNextPage = vi.fn()
    const archivedFetchNextPage = vi.fn()
    useNotebookLibraryMock.mockImplementation(({ archived }: { archived: boolean }) =>
      libraryState({
        notebooks: archived ? [{ id: 'notebook:a1', name: 'Archived one' }] : activeNotebooks,
        hasNextPage: true,
        fetchNextPage: archived ? archivedFetchNextPage : activeFetchNextPage,
      }),
    )

    render(<NotebooksPage />)

    const activeLoadMore = screen.getByTestId('load-more-Active notebooks')
    const archivedLoadMore = screen.getByTestId('load-more-Archived notebooks')
    expect(activeLoadMore).toHaveTextContent('Load more notebooks')
    fireEvent.click(activeLoadMore)
    expect(activeFetchNextPage).toHaveBeenCalledOnce()
    expect(archivedFetchNextPage).not.toHaveBeenCalled()
    fireEvent.click(archivedLoadMore)
    expect(archivedFetchNextPage).toHaveBeenCalledOnce()
  })
})
