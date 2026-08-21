import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TransformationsList } from './TransformationsList'
import { Transformation } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('./TransformationEditorDialog', () => ({
  TransformationEditorDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="transformation-editor-dialog" /> : null,
}))

vi.mock('./TransformationCard', () => ({
  TransformationCard: ({
    transformation,
    onPlayground,
    onEdit,
  }: {
    transformation: Transformation
    onPlayground?: () => void
    onEdit?: () => void
  }) => (
    <div data-testid="transformation-card">
      <span>{transformation.name}</span>
      {onPlayground && (
        <button onClick={onPlayground}>transformations.testInPlayground</button>
      )}
      {onEdit && <button onClick={onEdit}>common.edit</button>}
    </div>
  ),
}))

const mockTransformation: Transformation = {
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

const secondTransformation: Transformation = {
  ...mockTransformation,
  id: 'transformation:2',
  name: 'extract',
  title: 'Extract',
}

describe('TransformationsList', () => {
  it('opens the editor dialog from the empty state create button', () => {
    render(<TransformationsList transformations={[]} isLoading={false} />)

    fireEvent.click(screen.getByText('transformations.createNew'))

    expect(screen.getByTestId('transformation-editor-dialog')).toBeInTheDocument()
  })

  it('opens the editor dialog from the list header create button', () => {
    render(<TransformationsList transformations={[mockTransformation]} isLoading={false} />)

    fireEvent.click(screen.getByText('transformations.createNew'))

    expect(screen.getByTestId('transformation-editor-dialog')).toBeInTheDocument()
  })

  it('calls onPlayground with the selected row transformation, not a stale one', () => {
    const onPlayground = vi.fn()
    render(
      <TransformationsList
        transformations={[mockTransformation, secondTransformation]}
        isLoading={false}
        onPlayground={onPlayground}
      />
    )

    const buttons = screen.getAllByText('transformations.testInPlayground')
    fireEvent.click(buttons[1])

    expect(onPlayground).toHaveBeenCalledTimes(1)
    expect(onPlayground).toHaveBeenCalledWith(secondTransformation)
  })

  it('omits the playground action when onPlayground is not provided', () => {
    render(<TransformationsList transformations={[mockTransformation]} isLoading={false} />)

    expect(screen.queryByText('transformations.testInPlayground')).not.toBeInTheDocument()
  })
})
