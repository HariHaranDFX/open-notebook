import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RecentlyViewed } from './RecentlyViewed'

const { recentlyViewed } = vi.hoisted(() => ({ recentlyViewed: vi.fn() }))

vi.mock('@/lib/api/notebooks', () => ({
  notebooksApi: { recentlyViewed },
}))

function renderRecentlyViewed(viewMode: 'list' | 'card') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RecentlyViewed viewMode={viewMode} />
    </QueryClientProvider>,
  )
}

describe('RecentlyViewed', () => {
  it('follows the selected card view while keeping each resource clickable', async () => {
    recentlyViewed.mockResolvedValue([
      {
        type: 'notebook',
        id: 'notebook:research',
        title: 'Research notebook',
        last_viewed_at: '2026-01-02T00:00:00Z',
      },
      {
        type: 'source',
        id: 'source:evidence',
        title: 'Evidence source',
        last_viewed_at: '2026-01-01T00:00:00Z',
      },
    ])

    renderRecentlyViewed('card')

    expect(await screen.findByRole('link', { name: /Research notebook/ })).toHaveAttribute(
      'href',
      '/notebooks/notebook%3Aresearch',
    )
    expect(screen.getByRole('link', { name: /Evidence source/ })).toHaveAttribute(
      'href',
      '/sources/source%3Aevidence',
    )
    const recentTitle = screen.getByText('Research notebook')
    const recentIcon = screen
      .getByRole('link', { name: /Research notebook/ })
      .querySelector('.lucide-book-open')
    const notebookTile = recentIcon?.parentElement
    expect(notebookTile).toHaveAttribute('data-resource-kind', 'notebook')
    expect(notebookTile?.parentElement).toBe(recentTitle.parentElement)
    expect(notebookTile).toHaveClass('size-7', 'shrink-0')
    expect(recentTitle).toHaveClass(
      'truncate',
      'font-semibold',
      'leading-snug',
    )
    const recentCard = screen.getByRole('link', { name: /Research notebook/ })
    expect(recentCard).toHaveClass('p-3')
    expect(recentCard).not.toHaveClass('sm:p-4')
    const typeLabel = within(recentCard).getByText('notebooks.recentlyViewedNotebook')
    const viewedAt = recentCard.querySelector('time')
    expect(viewedAt).not.toBeNull()
    if (!viewedAt) throw new Error('Expected a relative-time element')
    expect(viewedAt.parentElement).toHaveClass('border-t')
    expect(viewedAt).toHaveClass('ml-auto', 'self-end')
    expect(typeLabel.compareDocumentPosition(viewedAt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('recently-viewed-collection')).toHaveAttribute(
      'data-view-mode',
      'card',
    )
    expect(screen.getByTestId('recently-viewed-collection')).toHaveClass(
      'grid',
      'grid-cols-2',
      'gap-2',
      'sm:gap-3',
      'xl:grid-cols-5',
    )
    const disclosure = screen.getByRole('button', { name: /notebooks\.recentlyViewed/ })
    const chevron = disclosure.querySelector('.lucide-chevron-down')
    expect(disclosure).toHaveClass('!px-0')
    expect(disclosure).not.toHaveClass('w-full', 'px-2')
    expect(disclosure.parentElement).not.toHaveClass('w-full')
    expect(chevron).not.toHaveClass('ml-auto')
    expect(chevron?.previousElementSibling).toBe(screen.getByText('2'))
    expect(disclosure.lastElementChild).toBe(chevron)
    expect(screen.getByText('2')).toHaveAttribute('data-slot', 'badge')

    const sourceTile = screen
      .getByRole('link', { name: /Evidence source/ })
      .querySelector('[data-testid="resource-type-icon"]')
    expect(sourceTile).toHaveAttribute('data-resource-kind', 'source')
    expect(sourceTile?.querySelector('.lucide-file-text')).toBeInTheDocument()
  })

  it('bounds list view with a complete border', async () => {
    recentlyViewed.mockResolvedValue([
      {
        type: 'notebook',
        id: 'notebook:research',
        title: 'Research notebook',
        last_viewed_at: '2026-01-02T00:00:00Z',
      },
    ])

    renderRecentlyViewed('list')

    expect(await screen.findByTestId('recently-viewed-collection')).toHaveClass('border')
    expect(screen.getByTestId('recently-viewed-collection')).not.toHaveClass('border-y')
    const recentRow = screen.getByRole('link', { name: /Research notebook/ })
    const typeLabel = screen.getByText('notebooks.recentlyViewedNotebook')
    const metadata = typeLabel.parentElement
    expect(recentRow).toHaveClass(
      'grid-cols-[minmax(0,1fr)_auto]',
      'items-center',
      'px-2',
      'sm:px-3',
      'py-2',
    )
    expect(metadata).toHaveClass('shrink-0', 'flex-nowrap', 'justify-end')
    expect(metadata).toContainElement(recentRow.querySelector('time'))
  })
})
