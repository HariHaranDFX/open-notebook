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
    const heading = screen.getByText('sources.manageNotebooks')
    const description = screen.getByText('sources.manageNotebooksDesc')
    const notebookList = section?.querySelector('[data-slot="scroll-area"]')
    const notebookViewport = notebookList?.querySelector('[data-slot="scroll-area-viewport"]')
    const notebookTitle = screen.getByText('Research collection with a descriptive notebook title')
    const notebookDescription = screen.getByText(
      'A detailed notebook description that remains readable in the list.',
    )
    const notebookRow = notebookTitle.closest('[data-slot="notebook-association-row"]')

    expect(section).toContainElement(notebookTitle)
    expect(heading.parentElement).toHaveClass('min-w-0')
    expect(heading.parentElement).not.toHaveClass('flex', 'items-center')
    expect(heading.parentElement).toContainElement(description)
    expect(description).toHaveClass('mt-1')
    expect(description).not.toHaveClass('truncate')
    expect(section?.querySelector('[data-slot="card"]')).not.toBeInTheDocument()
    expect(section).toHaveClass(
      'rounded-[var(--control-radius)]',
      'overflow-hidden',
    )
    expect(notebookList).toBeInTheDocument()
    expect(notebookList).toHaveClass('h-[min(20rem,40dvh)]')
    expect(notebookViewport).toHaveClass('[&>div]:!block')
    expect(notebookRow).not.toHaveClass('rounded-[var(--surface-radius)]', 'border')
    expect(notebookRow).toHaveAttribute('role', 'checkbox')
    expect(notebookRow).toHaveAttribute('tabindex', '0')
    expect(notebookTitle.parentElement).toHaveClass('flex', 'min-w-0')
    expect(notebookTitle).toHaveClass('min-w-0', 'flex-1', 'truncate', 'font-semibold')
    expect(notebookTitle).not.toHaveClass('break-words')
    expect(notebookTitle).toHaveAttribute(
      'title',
      'Research collection with a descriptive notebook title',
    )
    expect(notebookDescription).toHaveClass('truncate', 'text-muted-foreground')
    expect(notebookDescription).not.toHaveClass('line-clamp-2')
    expect(notebookDescription).toHaveAttribute(
      'title',
      'A detailed notebook description that remains readable in the list.',
    )

    fireEvent.click(notebookRow!)
    expect(notebookRow).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(notebookRow!, { key: ' ' })
    expect(notebookRow).toHaveAttribute('aria-checked', 'false')
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
