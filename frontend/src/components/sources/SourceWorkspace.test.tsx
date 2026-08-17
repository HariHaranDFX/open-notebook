import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SourceDetailPage from '@/app/(dashboard)/sources/[id]/page'
import { SourceWorkspace } from './SourceWorkspace'

const useSourceChat = vi.fn()
const researchWorkbench = vi.fn()
const push = vi.fn()
const clearReturnTo = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'source%3Aalpha' }),
  useRouter: () => ({ push }),
}))

vi.mock('@/lib/hooks/use-navigation', () => ({
  useNavigation: () => ({
    getReturnPath: () => '/sources?view=list',
    getReturnLabel: () => 'Return to sources',
    clearReturnTo,
  }),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}))

vi.mock('@/lib/hooks/use-source-chat', () => ({
  useSourceChat: (sourceId: string) => useSourceChat(sourceId),
}))

vi.mock('@/components/workbench/ResearchWorkbench', () => ({
  ResearchWorkbench: (props: {
    workspaceKey: string
    panes: Array<{ id: string; label: string; content: React.ReactNode }>
    chat: React.ReactNode
  }) => {
    researchWorkbench(props)
    return (
      <div data-testid="research-workbench" data-workspace-key={props.workspaceKey}>
        {props.panes.map(pane => (
          <section key={pane.id} aria-label={pane.label}>
            {pane.content}
          </section>
        ))}
        <section aria-label="workbench.sourceChat">{props.chat}</section>
      </div>
    )
  },
}))

vi.mock('./SourceDetailContent', () => ({
  SourceDetailContent: ({
    renderWorkspace,
    onClose,
    showBackButton,
  }: {
    renderWorkspace: (panes: {
      content: React.ReactNode
      insights: React.ReactNode
      details: React.ReactNode
      insightCount: number
    }) => React.ReactNode
    onClose?: () => void
    showBackButton?: boolean
  }) => (
    <>
      {showBackButton && (
        <header>
          <button type="button" onClick={onClose}>
            workbench.backToSources
          </button>
        </header>
      )}
      {renderWorkspace({
        content: <div>Source content</div>,
        insights: <div>Source insights</div>,
        details: <div>Source details</div>,
        insightCount: 1,
      })}
    </>
  ),
}))

vi.mock('./ChatPanel', () => ({
  ChatPanel: () => <div>Source conversation</div>,
}))

describe('SourceWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSourceChat.mockReturnValue({
      messages: [],
      isStreaming: false,
      contextIndicators: null,
      currentSession: null,
      currentSessionId: null,
      sessions: [],
      loadingSessions: false,
      sendMessage: vi.fn(),
      updateSession: vi.fn(),
      createSession: vi.fn(),
      switchSession: vi.fn(),
      deleteSession: vi.fn(),
    })
  })

  it('renders content, insights, and source chat through one source workspace', () => {
    render(<SourceWorkspace sourceId="source:alpha" onClose={vi.fn()} />)

    expect(screen.getByTestId('research-workbench')).toHaveAttribute(
      'data-workspace-key',
      'source:source:alpha',
    )
    expect(screen.getByRole('region', { name: 'workbench.content' })).toHaveTextContent(
      'Source content',
    )
    expect(screen.getByRole('region', { name: 'workbench.insights' })).toHaveTextContent(
      'Source insights',
    )
    expect(screen.getByText('Source insights').parentElement).toHaveClass(
      'absolute',
      'inset-0',
      'min-h-0',
      'overflow-y-auto',
    )
    expect(screen.getByRole('region', { name: 'workbench.sourceChat' })).toHaveTextContent(
      'Source conversation',
    )
    expect(screen.getByText('Source conversation').parentElement).not.toHaveClass('p-3')
    expect(useSourceChat).toHaveBeenCalledTimes(1)
    expect(useSourceChat).toHaveBeenCalledWith('source:alpha')
  })

  it('shows the insight count on the Insights tab', () => {
    render(<SourceWorkspace sourceId="source:alpha" />)

    const props = researchWorkbench.mock.calls[0][0]
    expect(props.panes.find((pane: { id: string }) => pane.id === 'notes')).toMatchObject({
      count: 1,
    })
  })

  it('keeps the app shell and preserves return-path navigation on the direct route', () => {
    render(<SourceDetailPage />)

    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.getByTestId('detail-workspace')).toHaveClass(
      'flex',
      'min-h-0',
      'min-w-0',
      'flex-1',
      'overflow-hidden',
    )
    expect(screen.getByTestId('detail-workspace')).not.toHaveClass(
      'px-4',
      'py-5',
      'sm:px-6',
      'lg:px-8',
    )
    fireEvent.click(screen.getByRole('button', { name: 'workbench.backToSources' }))
    expect(push).toHaveBeenCalledWith('/sources?view=list')
    expect(clearReturnTo).toHaveBeenCalledTimes(1)
  })
})
