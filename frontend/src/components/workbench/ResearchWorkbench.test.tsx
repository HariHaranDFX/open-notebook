import { fireEvent, render, screen, within } from '@testing-library/react'
import { FileText, StickyNote } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkbenchStore } from '@/lib/stores/workbench-store'
import { ResearchWorkbench, type WorkbenchPane } from './ResearchWorkbench'

const viewport = vi.hoisted(() => ({ desktop: true, tablet: false }))

vi.mock('@/lib/hooks/use-media-query', () => ({
  useIsDesktop: () => viewport.desktop,
  useIsTablet: () => viewport.tablet,
}))

const panes: WorkbenchPane[] = [
  { id: 'evidence', label: 'Sources', count: 2, icon: FileText, content: <p>Sources body</p> },
  { id: 'notes', label: 'Notes', count: 1, icon: StickyNote, content: <p>Notes body</p> },
]

describe('ResearchWorkbench', () => {
  beforeEach(() => {
    viewport.desktop = true
    viewport.tablet = false
    localStorage.clear()
    useWorkbenchStore.setState({
      leftWidthByWorkspace: {},
      chatCollapsedByWorkspace: {},
      activePaneByWorkspace: {},
      mobileViewByWorkspace: {},
      hasHydrated: true,
    })
  })

  it('shows a tabbed research panel, one resizer, and chat on desktop', () => {
    render(
      <ResearchWorkbench workspaceKey="notebook:one" panes={panes} chat={<p>Chat body</p>} />,
    )

    expect(screen.getByTestId('workbench-desktop')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByText('Sources body')).toBeVisible()
    expect(screen.queryByText('Notes body')).not.toBeInTheDocument()
    expect(screen.getByText('Chat body')).toBeVisible()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    expect(screen.getByRole('tablist')).toHaveClass('h-12', 'bg-card')
    const sourcesCount = within(screen.getByRole('tab', { name: 'Sources 2' })).getByText('2')
    expect(sourcesCount).toHaveAttribute('data-slot', 'badge')
    expect(sourcesCount).toHaveClass('min-w-6', 'tabular-nums')
    expect(screen.getByRole('button', { name: 'workbench.collapseChat' })).toHaveClass(
      'border-border-strong',
      'bg-card',
      'size-8',
      'top-2',
    )
  })

  it('contains scrollable pane content within the workbench viewport', () => {
    render(
      <ResearchWorkbench workspaceKey="notebook:one" panes={panes} chat={<p>Chat body</p>} />,
    )

    const sourcesRegion = screen.getByRole('region', { name: 'Sources' })

    expect(sourcesRegion.parentElement).toHaveClass('relative', 'overflow-hidden')
    expect(sourcesRegion).toHaveClass('absolute', 'inset-0', 'overflow-hidden')
  })

  it('collapses chat to an accessible rail and restores it', () => {
    render(
      <ResearchWorkbench workspaceKey="notebook:one" panes={panes} chat={<p>Chat body</p>} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workbench.collapseChat' }))
    expect(screen.queryByText('Chat body')).not.toBeInTheDocument()
    expect(screen.getByTestId('workbench-chat-rail')).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'workbench.expandChat' }))
    expect(screen.getByText('Chat body')).toBeVisible()
  })

  it('uses a two-choice segmented view below the split breakpoint', () => {
    viewport.desktop = false
    render(
      <ResearchWorkbench
        workspaceKey="notebook:one"
        panes={panes}
        chat={<p>Chat body</p>}
        panelLabel="Sources & Notes"
      />,
    )

    expect(screen.getByTestId('workbench-compact')).toHaveClass(
      'min-w-0',
      'w-full',
      'overflow-hidden',
    )
    expect(screen.getByText('Chat body')).toBeVisible()
    expect(screen.queryByText('Sources body')).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sources & Notes' }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByText('Sources body')).toBeVisible()
    expect(screen.queryByText('Chat body')).not.toBeInTheDocument()
  })
})
