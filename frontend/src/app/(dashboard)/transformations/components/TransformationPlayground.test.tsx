import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TransformationPlayground } from './TransformationPlayground'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-transformations', () => ({
  useExecuteTransformation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/components/common/ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}))

const summarize: Transformation = {
  id: 'transformation:1',
  name: 'summarize',
  title: 'Summarize',
  description: 'Summarize the content',
  prompt: 'Summarize this',
  apply_default: false,
  model_id: null,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

const deletedTransformation: Transformation = {
  ...summarize,
  id: 'transformation:2',
  name: 'archived',
  title: 'Archived',
  deleted_at: '2026-01-02T00:00:00Z',
}

describe('TransformationPlayground', () => {
  it('renders the selector placeholder when no transformation id is requested', () => {
    render(<TransformationPlayground transformations={[summarize]} />)

    expect(screen.getByText('transformations.selectToStart')).toBeInTheDocument()
    expect(screen.queryByText('transformations.notFound')).not.toBeInTheDocument()
  })

  it('resolves and preselects the transformation matching the URL id', () => {
    render(
      <TransformationPlayground
        transformations={[summarize]}
        selectedTransformationId="transformation:1"
      />
    )

    expect(screen.getByText('summarize')).toBeInTheDocument()
    expect(screen.queryByText('transformations.notFound')).not.toBeInTheDocument()
  })

  it('shows a recoverable not-found state for an unknown transformation id', () => {
    const onBackToLibrary = vi.fn()
    render(
      <TransformationPlayground
        transformations={[summarize]}
        selectedTransformationId="transformation:missing"
        onBackToLibrary={onBackToLibrary}
      />
    )

    expect(screen.getByText('transformations.notFound')).toBeInTheDocument()
    expect(screen.getByText('transformations.notFoundDesc')).toBeInTheDocument()

    fireEvent.click(screen.getByText('transformations.backToLibrary'))
    expect(onBackToLibrary).toHaveBeenCalledTimes(1)
  })

  it('shows a recoverable not-found state for a deleted transformation id', () => {
    render(
      <TransformationPlayground
        transformations={[summarize, deletedTransformation]}
        selectedTransformationId="transformation:2"
      />
    )

    expect(screen.getByText('transformations.notFound')).toBeInTheDocument()
  })

  it('does not show not-found while the transformation list is still loading', () => {
    render(
      <TransformationPlayground
        transformations={undefined}
        selectedTransformationId="transformation:1"
      />
    )

    expect(screen.queryByText('transformations.notFound')).not.toBeInTheDocument()
  })
})
