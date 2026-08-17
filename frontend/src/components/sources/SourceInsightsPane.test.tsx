import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SourceInsightsPane } from './SourceInsightsPane'

describe('SourceInsightsPane', () => {
  it('keeps transformation selection and creation in one compact row', () => {
    render(
      <SourceInsightsPane
        insights={[]}
        transformations={[{ id: 'transformation:summary', name: 'Summary' }]}
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
    expect(screen.getByRole('combobox')).toHaveAttribute('data-size', 'sm')
    expect(screen.getByRole('combobox')).toHaveClass('min-w-0', 'flex-1')
    expect(screen.getByRole('button', { name: 'common.create' })).not.toHaveClass('w-full')
  })
})
