import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NotebooksStep } from './NotebooksStep'
import { ProcessingStep } from './ProcessingStep'

describe('source wizard step layouts', () => {
  it('lets the notebook list fill the available step body', () => {
    const { container } = render(
      <NotebooksStep
        notebooks={[
          {
            id: 'notebook:1',
            name: 'Research notebook',
            description: 'Research notes',
            archived: false,
            created: '2026-08-26',
            updated: '2026-08-26',
            source_count: 1,
            note_count: 0,
          },
        ]}
        selectedNotebooks={[]}
        onToggleNotebook={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-slot="notebooks-step"]')).toHaveClass('h-full', 'min-h-0')
    expect(container.querySelector('[data-slot="checkbox-list"]')).toHaveClass('min-h-0', 'flex-1')
    const listContent = container.querySelector('[data-slot="checkbox-list-content"]')

    expect(listContent).toHaveClass('max-h-none', 'min-h-0', 'flex-1')
    expect(listContent).not.toHaveClass('max-h-48')
  })

  it('lets the transformations list fill the space above settings', () => {
    const { container } = render(
      <ProcessingStep
        control={{} as never}
        transformations={[
          {
            id: 'transformation:1',
            name: 'summary',
            title: 'Dense Summary',
            description: 'Create a detailed summary',
            prompt: 'Summarize',
            apply_default: false,
            model_id: null,
            created: '2026-08-26',
            updated: '2026-08-26',
          },
        ]}
        selectedTransformations={[]}
        onToggleTransformation={vi.fn()}
      />,
    )

    const transformationsSection = screen
      .getByRole('heading', { name: 'navigation.transformations (common.optional)' })
      .closest('[data-slot="form-section"]')

    expect(container.querySelector('[data-slot="processing-step"]')).toHaveClass('h-full', 'min-h-0')
    expect(transformationsSection).toHaveClass('min-h-0', 'flex-1')
    const listContent = container.querySelector('[data-slot="checkbox-list-content"]')

    expect(listContent).toHaveClass('max-h-none', 'min-h-0', 'flex-1')
    expect(listContent).not.toHaveClass('max-h-48')
  })
})
