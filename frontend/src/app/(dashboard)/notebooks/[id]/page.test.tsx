import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkbenchStore } from '@/lib/stores/workbench-store'
import NotebookPage from './page'

const route = vi.hoisted(() => ({ section: 'notes' }))
const notebookHook = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'notebook%3Aresearch' }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(`section=${route.section}`),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))
vi.mock('../components/NotebookHeader', () => ({
  NotebookHeader: ({ onBack }: { onBack: () => void }) => (
    <header>
      <button type="button" onClick={onBack}>Back to notebooks</button>
      <h1>Research notebook</h1>
    </header>
  ),
}))
vi.mock('../components/SourcesColumn', () => ({
  SourcesColumn: () => <p>Evidence pane</p>,
}))
vi.mock('../components/NotesColumn', () => ({
  NotesColumn: () => <p>Notes pane</p>,
}))
vi.mock('../components/ChatColumn', () => ({
  ChatColumn: () => <p>Synthesis pane</p>,
}))
vi.mock('@/lib/hooks/use-media-query', () => ({
  useIsDesktop: () => false,
  useIsTablet: () => false,
}))
vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebook: notebookHook,
}))
vi.mock('@/lib/hooks/use-sources', () => ({
  useNotebookSources: () => ({
    sources: [
      {
        id: 'source:evidence',
        title: 'Evidence',
        insights_count: 0,
        status: 'completed',
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/use-notes', () => ({
  useNotes: () => ({
    data: [{ id: 'note:one', title: 'Working note', content: 'A note' }],
    isLoading: false,
  }),
}))
vi.mock('@/lib/hooks/use-notebook-chat', () => ({
  useNotebookChat: () => ({
    messages: [],
    isSending: false,
    sessions: [],
    currentSessionId: null,
    currentSession: null,
    loadingSessions: false,
    tokenCount: 120,
    charCount: 480,
    pendingModelOverride: null,
    sendMessage: vi.fn(),
    setModelOverride: vi.fn(),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'workbench.evidence': 'Evidence',
      'workbench.notes': 'Notes',
      'workbench.synthesis': 'Synthesis',
      'workbench.backToNotebooks': 'Back to notebooks',
      'common.contextSummary.label': 'Context',
      'common.contextSummary.empty': 'No context',
      'common.contextSummary.tokens': '120 tokens',
      'common.contextSummary.characters': '480 characters',
      'common.contextModes.insights': 'Insights only',
      'common.contextModes.full': 'Full source',
      'common.contextModes.included': 'Included',
      'notebooks.notFound': 'Notebook not found',
      'notebooks.notFoundDesc': 'This notebook is unavailable.',
    })[key] ?? key,
    language: 'en-US',
  }),
}))

describe('NotebookPage workbench', () => {
  beforeEach(() => {
    push.mockReset()
    route.section = 'notes'
    notebookHook.mockReturnValue({
      data: {
        id: 'notebook:research',
        name: 'Research notebook',
        description: 'Evidence and notes',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-02T00:00:00Z',
        archived: false,
        access_role: 'owner',
      },
      isLoading: false,
    })
    useWorkbenchStore.setState({
      leftWidthByWorkspace: {},
      chatCollapsedByWorkspace: {},
      activePaneByWorkspace: {},
      mobileViewByWorkspace: { 'notebook:notebook:research': 'panel' },
      hasHydrated: true,
    })
  })

  it('opens the requested resource pane without losing the workbench model', async () => {
    render(<NotebookPage />)

    expect(screen.getByTestId('detail-workspace')).toHaveClass(
      'flex',
      'min-h-0',
      'min-w-0',
      'flex-1',
      'overflow-hidden',
    )
    expect(screen.getByTestId('detail-workspace')).not.toHaveClass('p-4', 'lg:p-6')
    expect(screen.getByRole('tab', { name: 'navigation.sources 1' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Notes 1' })).toBeVisible()
    await waitFor(() => expect(screen.getByText('Notes pane')).toBeVisible())
  })

  it('offers a safe return when the notebook no longer exists', () => {
    notebookHook.mockReturnValue({ data: undefined, isLoading: false })

    render(<NotebookPage />)

    expect(screen.getByText('Notebook not found')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to notebooks' })).toHaveAttribute(
      'href',
      '/notebooks',
    )
  })

  it('returns to the notebook library from the integrated header', () => {
    render(<NotebookPage />)

    screen.getByRole('button', { name: 'Back to notebooks' }).click()

    expect(push).toHaveBeenCalledWith('/notebooks')
  })
})
