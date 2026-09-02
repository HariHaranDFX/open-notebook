import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import NotebooksPage from './page'

const { useNotebooksMock } = vi.hoisted(() => ({
  useNotebooksMock: vi.fn(),
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
  }: {
    notebooks?: Array<{ id: string; name: string }>
    title: string
  }) => (
    <section aria-label={title}>
      <ul>{notebooks?.map(notebook => <li key={notebook.id}>{notebook.name}</li>)}</ul>
    </section>
  ),
}))

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: useNotebooksMock,
}))

vi.mock('@/lib/stores/library-view-store', () => ({
  useLibraryView: () => ({ viewMode: 'list', setViewMode: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common.cardView': 'Cards',
      'common.created_label': 'Created',
      'common.listView': 'List',
      'common.refresh': 'Refresh',
      'common.name': 'Name',
      'common.updated_label': 'Updated',
      'common.viewMode': 'Collection view',
      'notebooks.activeNotebooks': 'Active notebooks',
      'notebooks.description': 'Organize sources, notes, and research in focused workspaces.',
      'notebooks.newNotebook': 'New notebook',
      'notebooks.searchLabel': 'Search notebooks',
      'notebooks.searchPlaceholder': 'Search notebooks...',
      'notebooks.sortDirection': 'Change sort direction',
      'notebooks.sortLabel': 'Sort notebooks',
      'notebooks.title': 'Notebooks',
    })[key] ?? key,
  }),
}))

describe('NotebooksPage', () => {
  it('describes the library and requests notebook sorting in both directions', () => {
    useNotebooksMock.mockImplementation((archived: boolean, orderBy: string) => ({
      data: archived
        ? []
        : [...activeNotebooks].sort((left, right) => {
            const comparison = left.updated.localeCompare(right.updated)
            return orderBy.endsWith('asc') ? comparison : -comparison
          }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }))

    render(<NotebooksPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Notebooks' })).toBeVisible()
    expect(
      screen.getByText('Organize sources, notes, and research in focused workspaces.'),
    ).toBeVisible()
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Newer notebook',
      'Older notebook',
    ])
    expect(useNotebooksMock).toHaveBeenCalledWith(false, 'updated desc')
    expect(useNotebooksMock).toHaveBeenCalledWith(true, 'updated desc')
    expect(screen.getByTestId('page-frame')).toHaveClass('space-y-4', 'py-4', 'sm:py-4')

    fireEvent.click(screen.getByRole('button', { name: 'Change sort direction' }))
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Older notebook',
      'Newer notebook',
    ])
    expect(useNotebooksMock).toHaveBeenCalledWith(false, 'updated asc')
    expect(useNotebooksMock).toHaveBeenCalledWith(true, 'updated asc')
  })
})
