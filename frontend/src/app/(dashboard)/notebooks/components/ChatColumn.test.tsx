import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatColumn } from './ChatColumn'
import type { useNotebookChat } from '@/lib/hooks/use-notebook-chat'
vi.mock('@/components/sources/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />
}))

function createChatMock() {
  return {
    messages: [],
    isSending: false,
    tokenCount: 0,
    charCount: 0,
    sessions: [],
    currentSessionId: null,
  } as unknown as ReturnType<typeof useNotebookChat>
}

describe('ChatColumn', () => {
  const baseProps = {
    notebookId: 'test-notebook',
    chat: createChatMock(),
    contextStats: {
      sourcesInsights: 0,
      sourcesFull: 0,
      notesCount: 0,
    },
  }

  it('shows loading spinner when fetching data', () => {
    render(<ChatColumn {...baseProps} isLoading />)

    // Should show loading spinner
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders chat panel when data is loaded', () => {
    render(<ChatColumn {...baseProps} isLoading={false} />)

    // Should show chat panel
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument()
  })
})
