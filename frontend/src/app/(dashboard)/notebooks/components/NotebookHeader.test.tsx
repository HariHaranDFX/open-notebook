import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotebookHeader } from './NotebookHeader'

const mutate = vi.fn()

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useUpdateNotebook: () => ({ mutate, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ isAdmin: false }),
}))

vi.mock('./NotebookDeleteDialog', () => ({
  NotebookDeleteDialog: () => null,
}))

vi.mock('@/components/sharing/ShareSheet', () => ({
  ShareSheet: () => null,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: (props: React.ComponentProps<'button'>) => <button role="menuitem" {...props} />,
}))

describe('NotebookHeader', () => {
  beforeEach(() => mutate.mockReset())

  it('keeps the notebook return action inside the notebook header', () => {
    const onBack = vi.fn()

    render(
      <NotebookHeader
        notebook={{
          id: 'notebook:research',
          name: 'Research notebook',
          description: 'Evidence and notes',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-02T00:00:00Z',
          archived: false,
          access_role: 'viewer',
          source_count: 1,
          note_count: 2,
        }}
        onBack={onBack}
      />,
    )

    const title = screen.getByRole('heading', { name: 'Research notebook' })
    const backButton = screen.getByRole('button', {
      name: 'workbench.backToNotebooks',
    })
    const headerLayout = title.closest('[data-slot="detail-header-layout"]')

    expect(backButton.closest('header')).toContainElement(title)
    expect(headerLayout).toContainElement(screen.getByText('Evidence and notes'))
    expect(headerLayout).toHaveClass(
      'grid',
      'lg:grid-cols-[minmax(0,1fr)_auto]',
      'lg:items-center',
    )
    expect(title.closest('header')).not.toHaveClass('border-b')
    backButton.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('places the notebook return action immediately before Share with matching styling', () => {
    render(
      <NotebookHeader
        notebook={{
          id: 'notebook:research',
          name: 'Research notebook',
          description: 'Evidence and notes',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-02T00:00:00Z',
          archived: false,
          access_role: 'owner',
          source_count: 1,
          note_count: 2,
        }}
        onBack={vi.fn()}
      />,
    )

    const backButton = screen.getByRole('button', {
      name: 'workbench.backToNotebooks',
    })
    const shareButton = screen.getByRole('button', { name: 'sharing.share' })

    expect(backButton.parentElement).toBe(shareButton.parentElement)
    expect(backButton.nextElementSibling).toBe(shareButton)
    expect(backButton.className).toBe(shareButton.className)
  })

  it('uses the vertical overflow icon for notebook actions', () => {
    render(
      <NotebookHeader
        notebook={{
          id: 'notebook:research',
          name: 'Research notebook',
          description: 'Evidence and notes',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-02T00:00:00Z',
          archived: false,
          access_role: 'owner',
          source_count: 1,
          note_count: 2,
        }}
        onBack={vi.fn()}
      />,
    )

    const actionsButton = screen.getByRole('button', { name: 'common.actions' })
    expect(actionsButton.querySelector('svg')).toHaveClass('lucide-ellipsis-vertical')
    expect(actionsButton).toHaveClass('border-border-strong', 'bg-card')
  })

  it('requires confirmation before changing the notebook archive state', () => {
    render(
      <NotebookHeader
        notebook={{
          id: 'notebook:research',
          name: 'Research notebook',
          description: 'Evidence and notes',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-02T00:00:00Z',
          archived: false,
          access_role: 'owner',
          source_count: 1,
          note_count: 2,
        }}
        onBack={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'notebooks.archive' }))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('notebooks.archiveConfirmTitle')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'notebooks.archive' }))

    expect(mutate).toHaveBeenCalledWith({
      id: 'notebook:research',
      data: { archived: true },
    })
  })
})
