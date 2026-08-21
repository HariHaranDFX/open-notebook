import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TransformationCard } from './TransformationCard'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-transformations', () => ({
  useDeleteTransformation: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreTransformation: () => ({ mutate: vi.fn(), isPending: false }),
}))

const readOnlyTransformation: Transformation = {
  id: 'transformation:1',
  name: 'summarize',
  title: 'Summarize',
  description: 'Summarize the content',
  prompt: 'Summarize this: {{content}}',
  apply_default: false,
  model_id: null,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  can_edit: false,
}

describe('TransformationCard', () => {
  it('lets a non-editor reveal the read-only prompt but shows no edit control', () => {
    render(<TransformationCard transformation={readOnlyTransformation} onEdit={vi.fn()} />)

    // Prompt is not shown until the user expands the disclosure.
    expect(screen.queryByText('Summarize this: {{content}}')).not.toBeInTheDocument()
    expect(screen.queryByText('common.edit')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('transformations.systemPrompt'))

    expect(screen.getByText('Summarize this: {{content}}')).toBeInTheDocument()
    expect(screen.queryByText('common.edit')).not.toBeInTheDocument()
  })

  it('shows the edit control for a transformation the user can edit', () => {
    render(
      <TransformationCard
        transformation={{ ...readOnlyTransformation, can_edit: true }}
        onEdit={vi.fn()}
      />
    )

    expect(screen.getByText('common.edit')).toBeInTheDocument()
  })
})
