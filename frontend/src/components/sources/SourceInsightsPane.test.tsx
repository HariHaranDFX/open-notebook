import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SourceInsightsPane } from './SourceInsightsPane'

describe('SourceInsightsPane', () => {
  it('keeps transformation selection and creation in one compact row', () => {
    render(
      <SourceInsightsPane
        insights={[]}
        transformations={[{
          id: 'transformation:summary',
          name: 'Summary',
          title: 'Summary',
          description: 'Summarise the source in a paragraph.',
          prompt: 'Summarise: {{ text }}',
          apply_default: false,
          model_id: null,
          created: '2026-08-01T00:00:00Z',
          updated: '2026-08-01T00:00:00Z',
        }]}
        selectedTransformation="transformation:summary"
        loadingInsights={false}
        creatingInsight={false}
        canEdit
        onTransformationChange={vi.fn()}
        onCreateInsight={vi.fn()}
        onViewInsight={vi.fn()}
        onDeleteInsight={vi.fn()}
      />,
    )

    const controls = screen.getByTestId('insight-generation-controls')
    expect(controls).toHaveClass('flex', 'items-center')
    expect(controls.parentElement).toHaveClass('rounded-[var(--control-radius)]')
    expect(screen.getByRole('combobox')).toHaveAttribute('data-size', 'sm')
    expect(screen.getByRole('combobox')).toHaveClass('min-w-0', 'flex-1')
    expect(screen.getByRole('button', { name: 'common.create' })).not.toHaveClass('w-full')
  })

  it('uses the destructive action color for an insight delete button and its hover state', () => {
    render(
      <SourceInsightsPane
        insights={[{
          id: 'source_insight:summary',
          source_id: 'source:evidence',
          insight_type: 'summary',
          content: 'A concise summary.',
          created: '2026-08-01T00:00:00Z',
          updated: '2026-08-01T00:00:00Z',
        }]}
        transformations={[]}
        selectedTransformation=""
        loadingInsights={false}
        creatingInsight={false}
        canEdit
        onTransformationChange={vi.fn()}
        onCreateInsight={vi.fn()}
        onViewInsight={vi.fn()}
        onDeleteInsight={vi.fn()}
      />,
    )

    const viewButton = screen.getByRole('button', { name: 'sources.viewInsight' })
    expect(viewButton.closest('article')).toHaveClass('rounded-[var(--control-radius)]')
    expect(screen.getByRole('button', { name: 'common.delete' })).toHaveClass(
      'border-destructive/30',
      'text-destructive',
      'hover:bg-destructive/10',
      'hover:text-destructive',
    )
  })
})
