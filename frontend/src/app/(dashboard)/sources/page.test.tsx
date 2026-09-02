import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SourcesPage from './page'

const { useLibraryViewMock, useSourceLibraryMock } = vi.hoisted(() => ({
  useLibraryViewMock: vi.fn(),
  useSourceLibraryMock: vi.fn(),
}))

vi.mock('use-debounce', () => ({ useDebounce: (value: string) => [value] }))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/layout/PageFrame', () => ({
  PageFrame: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="page-frame" className={className}>{children}</div>
  ),
}))

vi.mock('@/components/sources/AddSourceButton', () => ({
  AddSourceButton: () => <button type="button">Add source</button>,
}))

vi.mock('@/components/sources/SourceLibraryRow', () => ({
  SourceLibraryRow: ({ source }: { source: { title: string } }) => (
    <article>{source.title}</article>
  ),
}))

vi.mock('@/components/common/ConfirmDialog', () => ({ ConfirmDialog: () => null }))

vi.mock('@/lib/hooks/use-sources', () => ({
  useSourceLibrary: useSourceLibraryMock,
  useDeleteSource: () => ({ mutate: vi.fn(), isPending: false }),
  useRetrySource: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/stores/library-view-store', () => ({
  useLibraryView: useLibraryViewMock,
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common.cardView': 'Cards',
      'common.created_label': 'Created',
      'common.listView': 'List',
      'common.refresh': 'Refresh',
      'common.title': 'Title',
      'common.type': 'Type',
      'common.updated_label': 'Updated',
      'common.viewMode': 'Collection view',
      'sources.allSourcesDesc': 'Collect and manage the evidence behind your research.',
      'sources.embedded': 'Embedded',
      'sources.insights': 'Insights',
      'sources.librarySearchLabel': 'Search sources',
      'sources.librarySearchPlaceholder': 'Search source titles...',
      'sources.sortDirection': 'Change sort direction',
      'sources.sortLabel': 'Sort sources',
      'sources.title': 'Sources',
    })[key] ?? key,
  }),
}))

describe('SourcesPage', () => {
  beforeEach(() => {
    useLibraryViewMock.mockReturnValue({ viewMode: 'list', setViewMode: vi.fn() })
    useSourceLibraryMock.mockReturnValue({
      sources: [{ id: 'source:evidence', title: 'Evidence source' }],
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      error: null,
      isFetchNextPageError: false,
      isRefetchError: false,
    })
  })

  it('uses the shared library controls and a completely bordered list', () => {
    render(<SourcesPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Sources' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'All Sources' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Collect and manage the evidence behind your research.'),
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Search sources' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Sort sources' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Change sort direction' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Collection view' })).toBeVisible()
    expect(document.querySelector('[data-view-mode="list"]')).toHaveClass('border')
    expect(screen.getByTestId('page-frame')).toHaveClass('space-y-4', 'py-4', 'sm:py-4')
  })

  it('uses the compact wide-screen grid for source cards and card skeletons', () => {
    useLibraryViewMock.mockReturnValue({ viewMode: 'card', setViewMode: vi.fn() })
    const sourceState = useSourceLibraryMock.getMockImplementation()?.()

    render(<SourcesPage />)
    expect(document.querySelector('[data-view-mode="card"]')).toHaveClass(
      'sm:grid-cols-2',
      'xl:grid-cols-3',
    )

    useSourceLibraryMock.mockReturnValue({ ...sourceState, sources: [], isLoading: true })
    const { unmount } = render(<SourcesPage />)
    const skeleton = screen.getAllByTestId('source-library-skeleton')[0]
    expect(skeleton.parentElement).toHaveClass('contents')
    expect(skeleton.parentElement?.parentElement).toHaveClass(
      'sm:grid-cols-2',
      'xl:grid-cols-3',
    )
    expect(skeleton).toHaveClass('grid-rows-[auto_auto]', 'p-3')
    expect(within(skeleton).getByTestId('source-skeleton-state')).toBeInTheDocument()
    expect(within(skeleton).getByTestId('source-skeleton-description')).toHaveClass('mt-0.5', 'pl-8')
    expect(within(skeleton).getByTestId('source-skeleton-metadata')).toHaveClass('border-t', 'pt-3')
    expect(within(skeleton).getByTestId('source-skeleton-action')).toHaveClass('row-start-1')
    unmount()
  })

  it('matches the responsive source row structure while loading list view', () => {
    useSourceLibraryMock.mockReturnValue({
      ...useSourceLibraryMock.getMockImplementation()?.(),
      sources: [],
      isLoading: true,
    })

    render(<SourcesPage />)

    const skeleton = screen.getAllByTestId('source-library-skeleton')[0]
    expect(skeleton).toHaveClass(
      'grid',
      'grid-cols-[minmax(0,1fr)_auto]',
      'px-2',
      'py-2',
      'sm:px-3',
      'md:grid-cols-[minmax(0,1fr)_auto_auto]',
      'md:items-center',
    )
    expect(within(skeleton).getByTestId('source-skeleton-title')).toBeInTheDocument()
    expect(within(skeleton).getByTestId('source-skeleton-metadata')).toHaveClass(
      'col-span-2',
      'row-start-2',
      'pl-8',
      'md:justify-end',
    )
    expect(within(skeleton).getByTestId('source-skeleton-action')).toHaveClass(
      'col-start-2',
      'row-start-1',
    )
  })
})
