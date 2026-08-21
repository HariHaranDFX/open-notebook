/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StreamingResponse } from './StreamingResponse'

// useTranslation + next/navigation are mocked globally in setup.ts.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/sources/ChatReferences', () => ({
  ChatReferences: () => <div data-testid="refs" />,
  createReferenceCitationComponent: () => () => null,
}))

const strategy = { reasoning: 'Compare the two studies', searches: [{ term: 'sleep memory', instructions: 'find it' }] }

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('StreamingResponse', () => {
  it('renders the final answer with Copy and Save actions', () => {
    render(<StreamingResponse isStreaming={false} strategy={null} answers={[]} finalAnswer="The answer." onSave={vi.fn()} />)

    expect(screen.getByText('common.finalAnswer')).toBeInTheDocument()
    expect(screen.getByText('The answer.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.copyToClipboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'searchPage.saveToNotebooks' })).toBeInTheDocument()
  })

  it('copies the final answer to the clipboard', () => {
    render(<StreamingResponse isStreaming={false} strategy={null} answers={[]} finalAnswer="Copy me." />)

    fireEvent.click(screen.getByRole('button', { name: 'common.copyToClipboard' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy me.')
  })

  it('calls onSave when Save is clicked', () => {
    const onSave = vi.fn()
    render(<StreamingResponse isStreaming={false} strategy={null} answers={[]} finalAnswer="A." onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'searchPage.saveToNotebooks' }))

    expect(onSave).toHaveBeenCalled()
  })

  it('renders quiet Strategy and intermediate-answer disclosures', () => {
    render(<StreamingResponse isStreaming={false} strategy={strategy} answers={['a1', 'a2']} finalAnswer={null} />)

    expect(screen.getByText('common.strategy')).toBeInTheDocument()
    expect(screen.getByText('common.individualAnswers')).toBeInTheDocument()
  })

  it('shows the progress stepper while streaming without a final answer', () => {
    render(<StreamingResponse isStreaming={true} strategy={null} answers={[]} finalAnswer={null} />)

    // "searchPage.search" only appears as a stepper label here.
    expect(screen.getByText('searchPage.search')).toBeInTheDocument()
  })
})
