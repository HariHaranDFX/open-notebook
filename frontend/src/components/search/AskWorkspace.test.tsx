/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AskWorkspace } from './AskWorkspace'
import { useAsk } from '@/lib/hooks/use-ask'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useResourcePreview } from '@/lib/hooks/use-resource-preview'

// useTranslation is mocked globally in setup.ts (t returns the key string).
vi.mock('@/lib/hooks/use-ask', () => ({ useAsk: vi.fn() }))
vi.mock('@/lib/hooks/use-models', () => ({ useModelDefaults: vi.fn(), useModels: vi.fn() }))
vi.mock('@/lib/hooks/use-resource-preview', () => ({ useResourcePreview: vi.fn() }))
vi.mock('@/components/workbench/ResearchWorkbench', () => ({
  ResearchWorkbench: ({ chat, panes }: any) => (
    <div>{chat}{panes.map((p: any) => <div key={p.id}>{p.content}</div>)}</div>
  ),
}))
vi.mock('./StreamingResponse', () => ({
  StreamingResponse: ({ onReferenceClick, onSave, finalAnswer }: any) => (
    <div data-testid="synthesis">
      {finalAnswer}
      <button type="button" onClick={() => onReferenceClick?.('source', 'abc')}>open-ref</button>
      {onSave && <button type="button" onClick={onSave}>save-answer</button>}
    </div>
  ),
}))
vi.mock('./AdvancedModelsDialog', () => ({ AdvancedModelsDialog: () => null }))
vi.mock('./SaveToNotebooksDialog', () => ({
  SaveToNotebooksDialog: ({ open }: any) => (open ? <div data-testid="save-dialog" /> : null),
}))
vi.mock('@/components/common/ResourcePreview', () => ({
  ResourcePreview: ({ type, id }: any) => <div data-testid="resource-preview">{type}:{id}</div>,
}))

const baseAsk = {
  isStreaming: false,
  strategy: null,
  answers: [] as string[],
  finalAnswer: null as string | null,
  error: null as string | null,
  cancelled: false,
  sendAsk: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}

beforeEach(() => {
  vi.mocked(useAsk).mockReturnValue({ ...baseAsk } as any)
  vi.mocked(useModelDefaults).mockReturnValue({ data: { default_chat_model: 'm', default_embedding_model: 'e' }, isLoading: false } as any)
  vi.mocked(useModels).mockReturnValue({ data: [{ id: 'm', name: 'GPT' }] } as any)
  vi.mocked(useResourcePreview).mockReturnValue({ type: null, id: null, openPreview: vi.fn(), closePreview: vi.fn() } as any)
})

describe('AskWorkspace', () => {
  it('submits the question through sendAsk with the default models', () => {
    const sendAsk = vi.fn()
    vi.mocked(useAsk).mockReturnValue({ ...baseAsk, sendAsk } as any)
    render(<AskWorkspace />)

    fireEvent.change(screen.getByLabelText('common.accessibility.enterQuestion'), { target: { value: 'why?' } })
    fireEvent.click(screen.getByRole('button', { name: 'searchPage.ask' }))

    expect(sendAsk).toHaveBeenCalledWith('why?', { strategy: 'm', answer: 'm', finalAnswer: 'm' })
  })

  it('shows Cancel while streaming and calls cancel', () => {
    const cancel = vi.fn()
    vi.mocked(useAsk).mockReturnValue({ ...baseAsk, isStreaming: true, cancel } as any)
    render(<AskWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(cancel).toHaveBeenCalled()
  })

  it('shows Retry after a cancelled request and calls retry', () => {
    const retry = vi.fn()
    vi.mocked(useAsk).mockReturnValue({ ...baseAsk, cancelled: true, retry } as any)
    render(<AskWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    expect(retry).toHaveBeenCalled()
  })

  it('saves the answer from the response, opening the save dialog', () => {
    vi.mocked(useAsk).mockReturnValue({ ...baseAsk, finalAnswer: 'the answer' } as any)
    render(<AskWorkspace />)

    expect(screen.queryByTestId('save-dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'save-answer' }))
    expect(screen.getByTestId('save-dialog')).toBeInTheDocument()
  })

  it('opens a citation into the preview pane instead of a modal', () => {
    const openPreview = vi.fn()
    vi.mocked(useResourcePreview).mockReturnValue({ type: null, id: null, openPreview, closePreview: vi.fn() } as any)
    vi.mocked(useAsk).mockReturnValue({ ...baseAsk, finalAnswer: 'answer with a ref' } as any)
    render(<AskWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: 'open-ref' }))

    expect(openPreview).toHaveBeenCalledWith('source', 'abc')
  })
})
