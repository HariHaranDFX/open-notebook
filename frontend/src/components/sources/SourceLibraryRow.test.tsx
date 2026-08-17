import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SourceListResponse } from '@/lib/types/api'
import { SourceLibraryRow } from './SourceLibraryRow'

vi.mock('@/lib/hooks/use-sources', () => ({
  useSourceStatus: () => ({ data: undefined }),
}))
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ isAdmin: false }),
}))
vi.mock('@/components/sharing/ShareDialog', () => ({ ShareDialog: () => null }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <button role="menuitem">{children}</button>,
}))
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    language: 'en',
    t: (key: string, values?: { count?: number }) => ({
      'common.actions': 'Actions',
      'common.insights': 'Insights',
      'common.retry': 'Retry',
      'common.updated': 'Updated',
      'sharing.share': 'Share',
      'sharing.editor': 'Editor',
      'sharing.owner': 'Owner',
      'sharing.viewer': 'Viewer',
      'sources.deleteSource': 'Delete source',
      'sources.embedded': 'Embedded',
      'sources.insightsCount': `${values?.count ?? 0} insights`,
      'sources.notEmbedded': 'Not embedded',
      'sources.retryProcessing': 'Retry processing',
      'sources.statusCompleted': 'Completed',
      'sources.statusFailed': 'Failed',
      'sources.statusPartial': 'Partially available',
      'sources.statusUnavailable': 'Status unavailable',
      'sources.statusProcessing': 'Processing',
      'sources.statusQueued': 'Queued',
      'sources.type.file': 'File',
      'sources.type.link': 'Link',
      'sources.type.text': 'Text',
      'sources.untitledSource': 'Untitled source',
    })[key] ?? key,
  }),
}))

function source(overrides: Partial<SourceListResponse> = {}): SourceListResponse {
  return {
    id: 'source:evidence',
    title: 'Evidence source',
    asset: { url: 'https://example.com/evidence' },
    embedded: true,
    embedded_chunks: 4,
    insights_count: 2,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
    status: 'completed',
    access_role: 'owner',
    ...overrides,
  }
}

describe('SourceLibraryRow', () => {
  it('shows type, status, embedding, insights, role, and permitted owner actions', () => {
    render(<SourceLibraryRow source={source()} onDelete={vi.fn()} onRetry={vi.fn()} />)

    expect(screen.getAllByRole('link', { name: 'Evidence source' })).toHaveLength(1)
    for (const label of ['Link', 'Completed', 'Embedded', 'Owner']) {
      expect(screen.getByText(label)).toBeVisible()
    }
    const insightCount = screen.getByLabelText('Insights: 2')
    expect(insightCount).toHaveTextContent('2')
    expect(insightCount.querySelector('.lucide-lightbulb')).toBeInTheDocument()
    expect(screen.queryByText('2 insights')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Share' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Delete source' })).toBeVisible()
  })

  it.each([
    ['queued', 'Queued'],
    ['running', 'Processing'],
    ['partial', 'Partially available'],
    ['unknown', 'Status unavailable'],
  ])('renders the %s processing state with text', (status, label) => {
    render(<SourceLibraryRow source={source({ status })} onDelete={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText(label)).toBeVisible()
  })

  it('keeps retry visible for a failed editable source but withholds delete from editors', () => {
    render(
      <SourceLibraryRow
        source={source({ status: 'failed', access_role: 'editor' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('Failed')).toBeVisible()
    const retry = screen.getByRole('button', { name: 'Retry' })
    const updatedAt = document.querySelector('time')
    expect(retry).toBeVisible()
    expect(updatedAt).not.toBeNull()
    if (!updatedAt) throw new Error('Expected a relative-time element')
    expect(retry.compareDocumentPosition(updatedAt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
  })

  it('renders a viewer as read-only without action controls', () => {
    render(
      <SourceLibraryRow
        source={source({ access_role: 'viewer' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByText('Viewer')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
  })

  it('makes the complete card a native link while keeping actions above it', () => {
    render(
      <SourceLibraryRow
        source={source({ asset: { file_path: '/uploads/evidence.pdf' } })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        viewMode="card"
      />,
    )

    expect(screen.getByRole('article')).toHaveAttribute('data-view-mode', 'card')
    expect(screen.getByRole('article')).toHaveClass('relative', 'p-3')
    const title = screen.getByRole('link', { name: 'Evidence source' })
    expect(title).toHaveClass('after:absolute', 'after:inset-0', 'truncate')
    const metadata = screen.getByTestId('source-card-metadata')
    expect(metadata).toHaveClass('border-t', 'row-start-2')
    expect(metadata.querySelector('time')).toHaveClass('ml-auto', 'self-end')
    expect(within(metadata).getByText('File')).toBeVisible()
    expect(within(metadata).getByText('Owner')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveClass(
      'relative',
      'z-10',
      'col-start-2',
      'row-start-1',
    )
    expect(screen.getByRole('button', { name: 'Actions' }).querySelector('.lucide-ellipsis-vertical')).toBeInTheDocument()
  })

  it('keeps source state above the card title and aligns the URL with the title text', () => {
    render(
      <SourceLibraryRow
        source={source({ status: 'failed' })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        viewMode="card"
      />,
    )

    const state = screen.getByTestId('source-card-state')
    const title = screen.getByRole('link', { name: 'Evidence source' })
    const metadata = screen.getByTestId('source-card-metadata')
    expect(within(state).getByText('Failed')).toBeVisible()
    expect(within(state).queryByText('Embedded')).not.toBeInTheDocument()
    expect(within(state).getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(within(state).queryByText('Retry processing')).not.toBeInTheDocument()
    expect(state.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(metadata).queryByText('Failed')).not.toBeInTheDocument()
    expect(within(metadata).queryByText('Embedded')).not.toBeInTheDocument()
    expect(screen.getByText('https://example.com/evidence')).toHaveClass('mt-0.5', 'pl-8')
  })

  it('uses compact vertical spacing in list view', () => {
    render(<SourceLibraryRow source={source()} onDelete={vi.fn()} onRetry={vi.fn()} />)

    const row = screen.getByRole('article')
    const metadata = screen.getByText('Link').parentElement
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

  it('keeps the source icon aligned with a one-line truncated title', () => {
    render(<SourceLibraryRow source={source()} onDelete={vi.fn()} onRetry={vi.fn()} />)

    const title = screen.getByRole('link', { name: 'Evidence source' })
    const icon = document.querySelector('.lucide-external-link')
    const tile = screen.getByTestId('resource-type-icon')
    const titleRow = title.parentElement
    expect(icon).toBeInTheDocument()
    expect(tile.parentElement).toBe(titleRow)
    expect(titleRow).toHaveClass('gap-1')
    expect(icon?.parentElement).toBe(tile)
    expect(screen.getByText('Link').parentElement).not.toBe(titleRow)
    expect(screen.getByText('Owner').parentElement).not.toBe(titleRow)
    expect(tile).toHaveClass('shrink-0')
    expect(title).toHaveClass('truncate', 'font-semibold', 'leading-snug')
    expect(screen.getByText('https://example.com/evidence')).toHaveClass('pl-8')
  })

  it('uses a file-specific colored icon without a background in source cards', () => {
    render(
      <SourceLibraryRow
        source={source({ asset: { file_path: '/uploads/evidence.xlsx' } })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        viewMode="card"
      />,
    )

    const tile = screen.getByTestId('resource-type-icon')
    expect(tile).toHaveAttribute('data-resource-kind', 'spreadsheet')
    expect(tile).toHaveClass('size-7', 'text-[var(--resource-spreadsheet)]')
    expect([...tile.classList].some(className => className.startsWith('bg-'))).toBe(false)
    expect(tile.querySelector('.lucide-file-spreadsheet')).toBeInTheDocument()
  })

  it.each(['list', 'card'] as const)('hides embedding state for failed sources in %s view', viewMode => {
    render(
      <SourceLibraryRow
        source={source({ status: 'failed', embedded: true })}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        viewMode={viewMode}
      />,
    )

    expect(screen.getByText('Failed')).toBeVisible()
    expect(screen.queryByText('Embedded')).not.toBeInTheDocument()
  })
})
