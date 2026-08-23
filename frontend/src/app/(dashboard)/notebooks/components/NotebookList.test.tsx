import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotebookResponse } from '@/lib/types/api'
import { NotebookList } from './NotebookList'

const mutate = vi.fn()

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useUpdateNotebook: () => ({ mutate }),
}))
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ isAdmin: false }),
}))
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key: string) => ({
      'common.actions': 'Actions',
      'common.contentUnavailable.errorDescription': 'Please try again.',
      'common.contentUnavailable.errorTitle': 'Unable to load content',
      'common.loading': 'Loading',
      'common.notes': 'Notes',
      'common.updated': 'Updated',
      'common.retry': 'Retry',
      'navigation.sources': 'Sources',
      'sharing.owner': 'Owner',
      'sharing.viewer': 'Viewer',
    })[key] ?? key,
  }),
}))
vi.mock('@/components/sharing/ShareSheet', () => ({ ShareSheet: () => null }))
vi.mock('./NotebookDeleteDialog', () => ({ NotebookDeleteDialog: () => null }))

function notebook(overrides: Partial<NotebookResponse> = {}): NotebookResponse {
  return {
    id: 'notebook:research',
    name: 'Research notebook',
    description: 'Evidence and working notes',
    archived: false,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
    source_count: 4,
    note_count: 2,
    access_role: 'owner',
    ...overrides,
  }
}

describe('NotebookList', () => {
  beforeEach(() => mutate.mockReset())

  it('uses structural row skeletons while loading', () => {
    render(<NotebookList isLoading title="Active notebooks" />)

    expect(screen.getAllByTestId('notebook-row-skeleton')).toHaveLength(3)
    const skeleton = screen.getAllByTestId('notebook-row-skeleton')[0]
    expect(skeleton).toHaveClass(
      'grid',
      'grid-cols-[minmax(0,1fr)_auto]',
      'px-2',
      'py-2',
      'sm:px-3',
      'md:grid-cols-[minmax(0,1fr)_auto_auto]',
      'md:items-center',
    )
    expect(within(skeleton).getByTestId('notebook-skeleton-title')).toBeInTheDocument()
    expect(within(skeleton).getByTestId('notebook-skeleton-title').querySelector('.mt-0\\.5')).toBeInTheDocument()
    expect(within(skeleton).getByTestId('notebook-skeleton-metadata')).toHaveClass(
      'col-span-2',
      'row-start-2',
      'pl-8',
    )
    expect(within(skeleton).getByTestId('notebook-skeleton-action')).toHaveClass(
      'size-9',
      'col-start-2',
      'row-start-1',
    )
  })

  it('uses the compact wide-screen grid for card skeletons', () => {
    render(<NotebookList isLoading title="Active notebooks" viewMode="card" />)

    const skeleton = screen.getAllByTestId('notebook-row-skeleton')[0]
    expect(skeleton.parentElement).toHaveClass(
      'sm:grid-cols-2',
      'xl:grid-cols-3',
    )
    expect(skeleton).toHaveClass(
      'grid-cols-[minmax(0,1fr)_auto]',
      'grid-rows-[auto_auto]',
      'p-3',
    )
    expect(within(skeleton).getByTestId('notebook-skeleton-metadata')).toHaveClass('border-t', 'pt-3')
  })

  it('offers the supplied recovery action when empty', () => {
    render(
      <NotebookList
        notebooks={[]}
        isLoading={false}
        title="Active notebooks"
        emptyTitle="No notebooks yet"
        emptyDescription="Create one to begin."
        onAction={vi.fn()}
        actionLabel="New notebook"
      />,
    )

    expect(screen.getByRole('button', { name: 'New notebook' })).toBeVisible()
  })

  it('shows a retry instead of an empty state when loading fails', () => {
    const onRetry = vi.fn()
    render(
      <NotebookList
        isLoading={false}
        isError
        onRetry={onRetry}
        title="Active notebooks"
        onAction={vi.fn()}
        actionLabel="New notebook"
      />,
    )

    expect(screen.getByText('Unable to load content')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'New notebook' })).not.toBeInTheDocument()
  })

  it('renders one named link and a permanently visible action trigger per notebook', () => {
    render(<NotebookList notebooks={[notebook()]} isLoading={false} title="Active notebooks" />)

    expect(screen.getAllByRole('link', { name: 'Research notebook' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Sources: 4' })).toHaveAttribute(
      'href',
      '/notebooks/notebook%3Aresearch?section=sources',
    )
    expect(screen.getByRole('link', { name: 'Notes: 2' })).toHaveAttribute(
      'href',
      '/notebooks/notebook%3Aresearch?section=notes',
    )
    expect(screen.getByRole('button', { name: 'Actions' })).not.toHaveClass('opacity-0')
  })

  it('keeps the notebook icon aligned with a one-line truncated title', () => {
    render(<NotebookList notebooks={[notebook()]} isLoading={false} title="Active notebooks" />)

    const title = screen.getByRole('link', { name: 'Research notebook' })
    const icon = document.querySelector('.lucide-book-open')
    const tile = screen.getByTestId('resource-type-icon')
    const titleRow = title.parentElement
    expect(icon).toBeInTheDocument()
    expect(tile).toHaveAttribute('data-resource-kind', 'notebook')
    expect(tile).toHaveClass('size-7', 'text-[var(--resource-notebook)]')
    expect([...tile.classList].some(className => className.startsWith('bg-'))).toBe(false)
    expect(tile.parentElement).toBe(titleRow)
    expect(titleRow).toHaveClass('gap-1')
    expect(icon?.parentElement).toBe(tile)
    expect(screen.getByText('Owner').parentElement).not.toBe(titleRow)
    expect(tile).toHaveClass('shrink-0')
    expect(title).toHaveClass('truncate', 'font-semibold', 'leading-snug')
    expect(screen.getByText('Evidence and working notes')).toHaveClass('mt-0.5', 'truncate', 'pl-8')
  })

  it('presents the collection total as a compact count badge', () => {
    render(<NotebookList notebooks={[notebook()]} isLoading={false} title="Active notebooks" />)

    expect(screen.getByText('1')).toHaveAttribute('data-slot', 'badge')
  })

  it('bounds list view with a complete border', () => {
    render(<NotebookList notebooks={[notebook()]} isLoading={false} title="Active notebooks" />)

    expect(screen.getByTestId('notebook-collection')).toHaveClass('border')
    expect(screen.getByTestId('notebook-collection')).not.toHaveClass('border-y')
    const row = screen.getByRole('article')
    const metadata = screen.getByText('Owner').parentElement
    expect(row).toHaveClass(
      'grid-cols-[minmax(0,1fr)_auto]',
      'gap-x-2',
      'px-2',
      'py-2',
      'sm:px-3',
    )
    expect(metadata).toHaveClass('col-span-2', 'row-start-2', 'pl-8')
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveClass(
      'col-start-2',
      'row-start-1',
    )
  })

  it('uses the same complete-surface native link in card view', () => {
    render(
      <NotebookList
        notebooks={[notebook()]}
        isLoading={false}
        title="Active notebooks"
        viewMode="card"
      />,
    )

    expect(screen.getByTestId('notebook-collection')).toHaveAttribute('data-view-mode', 'card')
    expect(screen.getByTestId('notebook-collection')).toHaveClass(
      'grid',
      'sm:grid-cols-2',
      'xl:grid-cols-3',
    )
    expect(screen.getByRole('article')).toHaveClass('relative', 'p-3')
    const title = screen.getByRole('link', { name: 'Research notebook' })
    expect(title).toHaveClass('after:absolute', 'after:inset-0', 'truncate')
    const metadata = screen.getByTestId('notebook-card-metadata')
    expect(metadata).toHaveClass('border-t', 'row-start-2')
    expect(metadata.querySelector('time')).toHaveClass('ml-auto', 'self-end')
    expect(within(metadata).getByText('Owner')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveClass('relative', 'z-10')
    expect(screen.getByRole('button', { name: 'Actions' }).querySelector('.lucide-ellipsis-vertical')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sources: 4' })).not.toHaveClass('min-h-8')
    expect(screen.getByRole('link', { name: 'Notes: 2' })).not.toHaveClass('min-h-8')
  })

  it('shows the effective role and withholds editing actions from viewers', () => {
    render(
      <NotebookList
        notebooks={[notebook({ access_role: 'viewer' })]}
        isLoading={false}
        title="Active notebooks"
      />,
    )

    expect(screen.getByText('Viewer')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
  })
})
