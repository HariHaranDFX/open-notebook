/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResourcePreview } from './ResourcePreview'
import { useSource } from '@/lib/hooks/use-sources'
import { useNote } from '@/lib/hooks/use-notes'
import { useInsight } from '@/lib/hooks/use-insights'

// useTranslation is mocked globally in setup.ts (t returns the key string).
vi.mock('@/lib/hooks/use-sources', () => ({ useSource: vi.fn() }))
vi.mock('@/lib/hooks/use-notes', () => ({ useNote: vi.fn() }))
vi.mock('@/lib/hooks/use-insights', () => ({ useInsight: vi.fn() }))
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const idle = { data: undefined, isLoading: false, isError: false, error: null }
const axiosError = (status: number) => ({ isAxiosError: true, response: { status } })

beforeEach(() => {
  vi.mocked(useSource).mockReturnValue(idle as any)
  vi.mocked(useNote).mockReturnValue(idle as any)
  vi.mocked(useInsight).mockReturnValue(idle as any)
})

describe('ResourcePreview', () => {
  it('fetches the matching resource by its full record id', () => {
    render(<ResourcePreview type="note" id="1" onClose={vi.fn()} />)

    expect(useNote).toHaveBeenCalledWith('note:1', { enabled: true })
  })

  it('shows a spinner while the resource is loading', () => {
    vi.mocked(useNote).mockReturnValue({ ...idle, isLoading: true } as any)
    render(<ResourcePreview type="note" id="note:1" onClose={vi.fn()} />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('renders the resource content with type label, authorship, title, and body', () => {
    vi.mocked(useNote).mockReturnValue({
      ...idle,
      data: { id: 'note:1', title: 'My Note', content: 'Body text', note_type: 'ai' },
    } as any)
    render(<ResourcePreview type="note" id="note:1" onClose={vi.fn()} />)

    expect(screen.getByText('My Note')).toBeInTheDocument()
    expect(screen.getByText('common.note')).toBeInTheDocument()
    expect(screen.getByText('common.aiGenerated')).toBeInTheDocument()
    expect(screen.getByText('Body text')).toBeInTheDocument()
  })

  it('shows an unavailable message when the resource is missing (404)', () => {
    vi.mocked(useSource).mockReturnValue({ ...idle, isError: true, error: axiosError(404) } as any)
    render(<ResourcePreview type="source" id="source:1" onClose={vi.fn()} />)

    expect(screen.getByText('common.itemNotFound')).toBeInTheDocument()
  })

  it('shows a no-access message when the resource is forbidden (403)', () => {
    vi.mocked(useSource).mockReturnValue({ ...idle, isError: true, error: axiosError(403) } as any)
    render(<ResourcePreview type="source" id="source:1" onClose={vi.fn()} />)

    expect(screen.getByText('apiErrors.forbidden')).toBeInTheDocument()
  })

  it('calls onClose when the close action is used', () => {
    const onClose = vi.fn()
    render(<ResourcePreview type="source" id="source:1" onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))

    expect(onClose).toHaveBeenCalled()
  })
})
