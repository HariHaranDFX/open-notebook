/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchWorkspace } from './SearchWorkspace'
import { useSearch } from '@/lib/hooks/use-search'
import { useModelDefaults } from '@/lib/hooks/use-models'
import { useResourcePreview } from '@/lib/hooks/use-resource-preview'

// useTranslation is mocked globally in setup.ts (t returns the key string).
vi.mock('@/lib/hooks/use-search', () => ({ useSearch: vi.fn() }))
vi.mock('@/lib/hooks/use-models', () => ({ useModelDefaults: vi.fn() }))
vi.mock('@/lib/hooks/use-resource-preview', () => ({ useResourcePreview: vi.fn() }))
vi.mock('@/components/common/ResourcePreview', () => ({
  ResourcePreview: ({ type, id }: { type: string; id: string }) => (
    <div data-testid="resource-preview">{type}:{id}</div>
  ),
}))

const result = {
  id: 'source:abc',
  parent_id: 'source:abc',
  title: 'Cell Biology',
  final_score: 0.95,
  matches: [],
  created: '',
  updated: '',
}

beforeEach(() => {
  vi.mocked(useSearch).mockReturnValue({ mutate: vi.fn(), data: undefined, isPending: false, isError: false } as any)
  vi.mocked(useModelDefaults).mockReturnValue({ data: { default_embedding_model: 'emb' }, isLoading: false } as any)
  vi.mocked(useResourcePreview).mockReturnValue({ type: null, id: null, openPreview: vi.fn(), closePreview: vi.fn() } as any)
})

describe('SearchWorkspace', () => {
  it('renders result rows with title, score, and type', () => {
    vi.mocked(useSearch).mockReturnValue({
      mutate: vi.fn(),
      data: { results: [result], total_count: 1, search_type: 'text' },
      isPending: false,
      isError: false,
    } as any)
    render(<SearchWorkspace />)

    expect(screen.getByText('Cell Biology')).toBeInTheDocument()
    expect(screen.getByText('0.95')).toBeInTheDocument()
    expect(screen.getByText('common.source')).toBeInTheDocument()
  })

  it('disables vector search and warns when no embedding model exists', () => {
    vi.mocked(useModelDefaults).mockReturnValue({ data: {}, isLoading: false } as any)
    render(<SearchWorkspace />)

    expect(screen.getByText('searchPage.vectorSearchWarning')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'searchPage.vectorSearch' })).toBeDisabled()
  })

  it('shows an empty state when the search returns no results', () => {
    vi.mocked(useSearch).mockReturnValue({
      mutate: vi.fn(),
      data: { results: [], total_count: 0, search_type: 'text' },
      isPending: false,
      isError: false,
    } as any)
    render(<SearchWorkspace />)

    expect(screen.getByText('searchPage.noResultsFor')).toBeInTheDocument()
  })

  it('shows an error state whose retry re-runs the search', () => {
    const mutate = vi.fn()
    vi.mocked(useSearch).mockReturnValue({ mutate, data: undefined, isPending: false, isError: true } as any)
    render(<SearchWorkspace />)

    fireEvent.change(screen.getByLabelText('common.accessibility.enterSearch'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))

    expect(mutate).toHaveBeenCalled()
  })

  it('opens a clicked result into the preview via openPreview', () => {
    const openPreview = vi.fn()
    vi.mocked(useResourcePreview).mockReturnValue({ type: null, id: null, openPreview, closePreview: vi.fn() } as any)
    vi.mocked(useSearch).mockReturnValue({
      mutate: vi.fn(),
      data: { results: [result], total_count: 1, search_type: 'text' },
      isPending: false,
      isError: false,
    } as any)
    render(<SearchWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Cell Biology/ }))

    expect(openPreview).toHaveBeenCalledWith('source', 'abc')
  })

  it('renders the preview pane when a preview is open in the URL', () => {
    vi.mocked(useResourcePreview).mockReturnValue({ type: 'source', id: 'abc', openPreview: vi.fn(), closePreview: vi.fn() } as any)
    render(<SearchWorkspace />)

    expect(screen.getByTestId('resource-preview')).toHaveTextContent('source:abc')
  })
})
