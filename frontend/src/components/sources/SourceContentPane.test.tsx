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
})
