import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useAddSourcesToNotebook, useRemoveSourceFromNotebook } from '@/lib/hooks/use-sources'
import { NotebookAssociations } from './NotebookAssociations'

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: vi.fn(),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useAddSourcesToNotebook: vi.fn(),
  useRemoveSourceFromNotebook: vi.fn(),
}))

describe('NotebookAssociations', () => {
  beforeEach(() => {
    vi.mocked(useNotebooks).mockReturnValue({
      data: [{
        id: 'notebook:research',
        name: 'Research collection with a descriptive notebook title',
        description: 'A detailed notebook description that remains readable in the list.',
        archived: false,
      }],
      isLoading: false,
    } as ReturnType<typeof useNotebooks>)
    vi.mocked(useAddSourcesToNotebook).mockReturnValue({
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof useAddSourcesToNotebook>)
    vi.mocked(useRemoveSourceFromNotebook).mockReturnValue({
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof useRemoveSourceFromNotebook>)
  })

  it('keeps the heading and flat notebook rows in one visual container', () => {
    render(
      <NotebookAssociations
        sourceId="source:research"
        currentNotebookIds={[]}
      />
    )

    const section = screen.getByText('sources.manageNotebooks').closest(
      '[data-slot="notebook-associations"]',
    )
    const notebookList = section?.querySelector('[data-slot="scroll-area"]')
    const notebookTitle = screen.getByText('Research collection with a descriptive notebook title')
    const notebookDescription = screen.getByText(
      'A detailed notebook description that remains readable in the list.',
    )
    const notebookRow = notebookTitle.closest('[data-slot="notebook-association-row"]')

    expect(section).toContainElement(notebookTitle)
    expect(section?.querySelector('[data-slot="card"]')).not.toBeInTheDocument()
    expect(section).toHaveClass(
      'rounded-[var(--control-radius)]',
      'overflow-hidden',
    )
    expect(notebookList).toBeInTheDocument()
    expect(notebookList).toHaveClass('h-[min(20rem,40dvh)]')
    expect(notebookRow).not.toHaveClass('rounded-[var(--surface-radius)]', 'border')
    expect(notebookTitle).toHaveClass('font-semibold', 'break-words')
    expect(notebookTitle).not.toHaveClass('truncate')
    expect(notebookDescription).toHaveClass('line-clamp-2')
  })

  it('places pending notebook actions in the supplied sheet footer', () => {
    const actionsContainer = document.createElement('div')
    document.body.appendChild(actionsContainer)

    render(
      <NotebookAssociations
        sourceId="source:research"
        currentNotebookIds={[]}
        actionsContainer={actionsContainer}
      />
    )

    expect(within(actionsContainer).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'Research collection with a descriptive notebook title',
    }))
    expect(
      within(actionsContainer).getByRole('button', { name: 'common.cancel' }),
    ).toBeInTheDocument()
    expect(
      within(actionsContainer).getByRole('button', { name: 'common.saveChanges' }),
    ).toBeInTheDocument()

    actionsContainer.remove()
  })
})
