import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SourceDetailResponse } from '@/lib/types/api'
import { SourceContentPane } from './SourceContentPane'

const source: SourceDetailResponse = {
  id: 'source:youtube',
  title: 'Responsive research source',
  asset: { url: 'https://www.youtube.com/watch?v=abcdefghijk' },
  embedded: true,
  embedded_chunks: 1,
  insights_count: 0,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  full_text: 'Grounded source content',
}

function renderContent() {
  return render(
    <SourceContentPane
      source={source}
      sourceId={source.id}
      section="content"
      externalHref={source.asset?.url ?? null}
      youTubeVideoId="abcdefghijk"
      copied={false}
      isEmbedding={false}
      isDownloadingFile={false}
      fileAvailable={null}
      canEdit
      onEmbedContent={vi.fn()}
      onCopyUrl={vi.fn()}
      onOpenExternal={vi.fn()}
      onDownloadFile={vi.fn()}
      onRefresh={vi.fn()}
    />,
  )
}

function renderDetails(detailsSource = source) {
  return render(
    <SourceContentPane
      source={detailsSource}
      sourceId={detailsSource.id}
      section="details"
      detailsVariant="sheet"
      showDetailsHeader={false}
      externalHref={detailsSource.asset?.url ?? null}
      youTubeVideoId="abcdefghijk"
      copied={false}
      isEmbedding={false}
      isDownloadingFile={false}
      fileAvailable={null}
      canEdit={false}
      onEmbedContent={vi.fn()}
      onCopyUrl={vi.fn()}
      onOpenExternal={vi.fn()}
      onDownloadFile={vi.fn()}
      onRefresh={vi.fn()}
    />,
  )
}

describe('SourceContentPane', () => {
  it('keeps YouTube media fluid inside a bounded reading surface', () => {
    renderContent()

    const iframe = screen.getByTitle('common.accessibility.ytVideo')
    const frame = iframe.parentElement
    const media = frame?.parentElement

    expect(frame).toHaveClass('aspect-video', 'w-full')
    expect(media).toHaveClass('mx-auto', 'w-full', 'max-w-4xl')
  })

  it('constrains research prose without allowing it to widen its pane', () => {
    renderContent()

    const readingSurface = screen.getByText('Grounded source content').closest(
      '[data-slot="source-reading-content"]',
    )

    expect(readingSurface).toHaveClass(
      'mx-auto',
      'min-w-0',
      'w-full',
      'max-w-[75ch]',
      'overflow-x-hidden',
    )
  })

  it('uses a flat, compact inspector hierarchy for sheet details', () => {
    const { container } = renderDetails()

    const inspector = container.querySelector('[data-slot="source-details-inspector"]')
    const summary = container.querySelector('[data-slot="source-details-summary"]')
    const resourceIcon = summary?.querySelector('[data-testid="resource-type-icon"]')

    expect(inspector).toBeInTheDocument()
    expect(inspector?.querySelector('[data-slot="card"]')).not.toBeInTheDocument()
    expect(summary).toContainElement(screen.getByText('Responsive research source'))
    expect(resourceIcon).toHaveAttribute('data-resource-kind', 'link')
    expect(resourceIcon).toHaveClass(
      'rounded-[var(--control-radius)]',
      'border',
      'border-border',
    )
    expect(screen.getByText('sources.type.link').closest('[data-slot="badge"]')).toBeInTheDocument()
    expect(screen.getByText('common.source')).toBeInTheDocument()
    expect(screen.getByText('sources.metadata')).toBeInTheDocument()
    expect(screen.queryByText('sources.details')).not.toBeInTheDocument()
    expect(screen.queryByText('sources.embedded')).not.toBeInTheDocument()
  })

  it('uses the control radius for the not-embedded banner', () => {
    renderDetails({ ...source, embedded: false })

    expect(screen.getByRole('alert')).toHaveClass('rounded-[var(--control-radius)]')
  })
})
