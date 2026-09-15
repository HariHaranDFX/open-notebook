import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notebooksApi } from '@/lib/api/notebooks'
import { useNotebookLibrary, useNotebooks } from '@/lib/hooks/use-notebooks'
import type { NotebookResponse } from '@/lib/types/api'

vi.mock('@/lib/api/notebooks', () => ({
  notebooksApi: { list: vi.fn(), listLibrary: vi.fn() },
}))

function createWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function notebook(index: number): NotebookResponse {
  return {
    id: `notebook:${index}`,
    name: `Notebook ${index}`,
    description: '',
    archived: false,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    source_count: 0,
    note_count: 0,
  }
}

describe('useNotebooks', () => {
  beforeEach(() => vi.mocked(notebooksApi.list).mockReset())

  it('passes the selected server ordering to the notebooks API', async () => {
    vi.mocked(notebooksApi.list).mockResolvedValue([])

    renderHook(() => useNotebooks(false, 'name asc'), { wrapper: createWrapper() })

    await waitFor(() => expect(notebooksApi.list).toHaveBeenCalledWith({
      archived: false,
      order_by: 'name asc',
    }))
  })
})

describe('useNotebookLibrary', () => {
  beforeEach(() => {
    vi.mocked(notebooksApi.listLibrary).mockReset()
    vi.mocked(notebooksApi.list).mockReset()
  })

  it('requests the first page without a cursor', async () => {
    vi.mocked(notebooksApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })

    renderHook(
      () => useNotebookLibrary({ archived: false, query: 'research', sortBy: 'name', sortOrder: 'asc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith({
      archived: false,
      query: 'research',
      sort_by: 'name',
      sort_order: 'asc',
      limit: 30,
    }))
    const call = vi.mocked(notebooksApi.listLibrary).mock.calls[0]?.[0] ?? {}
    expect(call).not.toHaveProperty('cursor')
    // The complete-list API stays untouched — dialogs still consume it.
    expect(notebooksApi.list).not.toHaveBeenCalled()
  })

  it('sends the returned cursor on the next request and flattens both pages', async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => notebook(index))
    vi.mocked(notebooksApi.listLibrary)
      .mockResolvedValueOnce({ items: firstPage, next_cursor: 'nb-cursor-1' })
      .mockResolvedValueOnce({ items: [notebook(30)], next_cursor: null })

    const { result } = renderHook(
      () => useNotebookLibrary({ archived: false, query: '', sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.notebooks).toHaveLength(30))
    await act(async () => { await result.current.fetchNextPage() })

    expect(notebooksApi.listLibrary).toHaveBeenLastCalledWith({
      archived: false,
      query: '',
      sort_by: 'updated',
      sort_order: 'desc',
      limit: 30,
      cursor: 'nb-cursor-1',
    })
    await waitFor(() => expect(result.current.notebooks).toHaveLength(31))
  })

  it('starts a fresh query without a cursor when the search changes', async () => {
    vi.mocked(notebooksApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })
    let search = 'first'
    const { rerender } = renderHook(
      () => useNotebookLibrary({ archived: false, query: search, sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      query: 'first',
    })))
    const firstCall = vi.mocked(notebooksApi.listLibrary).mock.calls[0]?.[0] ?? {}
    expect(firstCall).not.toHaveProperty('cursor')

    search = 'second'
    rerender()

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      query: 'second',
    })))
    const secondCall = vi.mocked(notebooksApi.listLibrary).mock.calls.at(-1)?.[0] ?? {}
    expect(secondCall).not.toHaveProperty('cursor')
  })

  it('starts a fresh query without a cursor when the sort changes', async () => {
    vi.mocked(notebooksApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })
    let sortBy: 'updated' | 'name' = 'updated'
    const { rerender } = renderHook(
      () => useNotebookLibrary({ archived: false, query: '', sortBy, sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      sort_by: 'updated',
    })))

    sortBy = 'name'
    rerender()

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      sort_by: 'name',
    })))
    const latest = vi.mocked(notebooksApi.listLibrary).mock.calls.at(-1)?.[0] ?? {}
    expect(latest).not.toHaveProperty('cursor')
  })

  it('starts a fresh query when the archived flag flips', async () => {
    vi.mocked(notebooksApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })
    let archived = false
    const { rerender } = renderHook(
      () => useNotebookLibrary({ archived, query: '', sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      archived: false,
    })))

    archived = true
    rerender()

    await waitFor(() => expect(notebooksApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      archived: true,
    })))
    const latest = vi.mocked(notebooksApi.listLibrary).mock.calls.at(-1)?.[0] ?? {}
    expect(latest).not.toHaveProperty('cursor')
  })
})
