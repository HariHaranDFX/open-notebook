import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatPanel } from './ChatPanel'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: vi.fn() }),
}))

// Keep the message-content deps light for this composer-focused test.
vi.mock('@/components/sources/MessageActions', () => ({
  MessageActions: () => null,
}))

vi.mock('@/components/sources/SessionManager', () => ({
  SessionManager: () => <div>Session list</div>,
}))

describe('ChatPanel composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom does not implement scrollIntoView (used by the auto-scroll effect).
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  const getTextarea = () => screen.getByRole('textbox') as HTMLTextAreaElement

  it('uses the same flat, edge-aligned surface as the other workbench panes', () => {
    render(
      <ChatPanel
        title="Synthesis"
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
        onCreateSession={vi.fn()}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    )

    const card = screen.getByText('Synthesis').closest('[data-slot="card"]')
    const header = screen.getByText('Synthesis').closest('[data-slot="card-header"]')
    const headerRow = screen.getByText('Synthesis').closest('[data-slot="card-title"]')?.parentElement

    expect(card).toHaveClass('gap-0', 'rounded-none', 'border-0', 'py-0')
    expect(header).toHaveClass('flex', 'h-12', 'items-center', 'border-b', 'bg-card', 'pl-4', 'pr-12', 'py-0')
    expect(headerRow).toHaveClass('h-full', 'w-full', 'flex-nowrap', 'items-center')
    expect(screen.getByRole('button', { name: 'chat.sessions' })).toHaveClass(
      'border-border-strong',
      'bg-card',
    )

    fireEvent.click(screen.getByRole('button', { name: 'chat.sessions' }))
    const sessionsSheet = screen.getByRole('dialog', { name: 'chat.sessionsTitle' })
    const closeButton = within(sessionsSheet).getByRole('button', { name: 'common.close' })
    const footer = closeButton.closest('[data-slot="sheet-footer"]')

    expect(sessionsSheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(closeButton).toBeVisible()
    expect(footer).toHaveClass('flex-row', 'justify-start', 'sm:justify-start')
  })

  it('sends the typed message and clears the input on send-button click', () => {
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: '  hello world  ' } })

    const sendButton = screen.getByRole('button')
    fireEvent.click(sendButton)

    expect(onSendMessage).toHaveBeenCalledTimes(1)
    expect(onSendMessage).toHaveBeenCalledWith('hello world', undefined)
    expect(textarea.value).toBe('')
  })

  it('uses an upward arrow for the shared send action', () => {
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={vi.fn()}
      />
    )

    const sendButton = screen.getByRole('button')

    expect(sendButton.querySelector('.lucide-arrow-up')).toBeInTheDocument()
    expect(sendButton.querySelector('.lucide-send')).not.toBeInTheDocument()
  })

  it('sends on Cmd+Enter on macOS', () => {
    const uaSpy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    )
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'via cmd' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true, ctrlKey: false })

    expect(onSendMessage).toHaveBeenCalledWith('via cmd', undefined)
    expect(textarea.value).toBe('')
    uaSpy.mockRestore()
  })

  it('sends on Ctrl+Enter on non-macOS', () => {
    const uaSpy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    )
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'via ctrl' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true, metaKey: false })

    expect(onSendMessage).toHaveBeenCalledWith('via ctrl', undefined)
    expect(textarea.value).toBe('')
    uaSpy.mockRestore()
  })

  it('does not send while streaming', () => {
    const onSendMessage = vi.fn()
    render(
      <ChatPanel
        messages={[]}
        isStreaming={true}
        contextIndicators={null}
        onSendMessage={onSendMessage}
      />
    )

    const textarea = getTextarea()
    // Textarea is disabled while streaming, but the guard must also hold.
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(onSendMessage).not.toHaveBeenCalled()
  })
})
