import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SourceCard } from './SourceCard'

vi.mock('@/lib/hooks/use-sources', () => ({
  useSourceStatus: () => ({ data: undefined, isLoading: false }),
}))

describe('SourceCard', () => {
  it('keeps source context at the lower-left and primary badges on one line', () => {
    render(
      <SourceCard
        source={{
          id: 'source:research',
          title: 'Research source',
          asset: null,
          embedded: true,
          embedded_chunks: 1,
          insights_count: 3,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-02T00:00:00Z',
          status: 'completed',
        }}
        contextMode="insights"
        onContextModeChange={vi.fn()}
      />,
    )

    const card = screen.getByText('Research source').closest('[data-slot="card"]') as HTMLElement
    const cardContent = card.querySelector('[data-slot="card-content"]') as HTMLElement
    const header = card.querySelector('.workbench-item-header') as HTMLElement
    const primaryBadges = card.querySelector('[data-slot="source-primary-badges"]') as HTMLElement
    const footer = card.querySelector('[data-slot="source-card-footer"]') as HTMLElement
    const title = within(card).getByRole('heading', { name: 'Research source' })
    const actions = within(card).getByRole('button', { name: 'common.actions' })

    expect(card).toHaveClass('py-0')
    expect(card).not.toHaveClass('py-6')
    expect(cardContent).toHaveClass('p-3')
    expect(header).toHaveClass('mb-2', 'gap-2')
    expect(header).toContainElement(primaryBadges)
    expect(header).toContainElement(actions)
    expect(header).not.toContainElement(title)
    expect(primaryBadges).toHaveClass('flex-nowrap')
    expect(header.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(primaryBadges).toContainElement(screen.getByText('sources.enterText').closest('[data-slot="badge"]'))
    expect(primaryBadges).toContainElement(screen.getByText('sources.insightsCount').closest('[data-slot="badge"]'))
    expect(footer).toHaveClass('mt-3', 'justify-start')
    expect(footer).toContainElement(within(card).getByRole('combobox', { name: 'common.contextModes.sourceLabel' }))
  })
})
