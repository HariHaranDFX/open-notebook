import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sourcesApi } from '@/lib/api/sources'
import { useSourceLibrary, useSourceStatus } from '@/lib/hooks/use-sources'
import type { SourceListResponse } from '@/lib/types/api'

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: { list: vi.fn(), listLibrary: vi.fn(), status: vi.fn() },
}))

function createWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function source(index: number): SourceListResponse {
  return {
    id: `source:${index}`,
    title: `Source ${index}`,
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  }
}

describe('useSourceLibrary', () => {
  beforeEach(() => {
    vi.mocked(sourcesApi.listLibrary).mockReset()
    vi.mocked(sourcesApi.list).mockReset()
  })

  it('requests the first page without a cursor', async () => {
    vi.mocked(sourcesApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })

    renderHook(
      () => useSourceLibrary({ query: 'evidence', sortBy: 'title', sortOrder: 'asc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(sourcesApi.listLibrary).toHaveBeenCalledWith({
      query: 'evidence',
      sort_by: 'title',
      sort_order: 'asc',
      limit: 30,
    }))
    // First call must NEVER carry an offset — cursor pagination only.
    const call = vi.mocked(sourcesApi.listLibrary).mock.calls[0]?.[0] ?? {}
    expect(call).not.toHaveProperty('offset')
    expect(call).not.toHaveProperty('cursor')
    // And the old array-returning `list` is untouched for the library route.
    expect(sourcesApi.list).not.toHaveBeenCalled()
  })

  it('sends the returned cursor on the next request and flattens both pages', async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => source(index))
    vi.mocked(sourcesApi.listLibrary)
      .mockResolvedValueOnce({ items: firstPage, next_cursor: 'source-cursor-1' })
      .mockResolvedValueOnce({ items: [source(30)], next_cursor: null })

    const { result } = renderHook(
      () => useSourceLibrary({ query: '', sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.sources).toHaveLength(30))
    await act(async () => { await result.current.fetchNextPage() })

    expect(sourcesApi.listLibrary).toHaveBeenLastCalledWith({
      query: '',
      sort_by: 'updated',
      sort_order: 'desc',
      limit: 30,
      cursor: 'source-cursor-1',
    })
    // No call ever carries an offset.
    for (const [args] of vi.mocked(sourcesApi.listLibrary).mock.calls) {
      expect(args).not.toHaveProperty('offset')
    }
    await waitFor(() => expect(result.current.sources).toHaveLength(31))
  })

  it('starts a fresh query without a cursor when the search changes', async () => {
    vi.mocked(sourcesApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })
    let search = 'first'
    const { rerender } = renderHook(
      () => useSourceLibrary({ query: search, sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(sourcesApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      query: 'first',
    })))
    const firstCall = vi.mocked(sourcesApi.listLibrary).mock.calls[0]?.[0] ?? {}
    expect(firstCall).not.toHaveProperty('cursor')

    search = 'second'
    rerender()

    await waitFor(() => expect(sourcesApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      query: 'second',
    })))
    const secondCall = vi.mocked(sourcesApi.listLibrary).mock.calls.at(-1)?.[0] ?? {}
    expect(secondCall).not.toHaveProperty('cursor')
  })

  it('starts a fresh query without a cursor when the sort changes', async () => {
    vi.mocked(sourcesApi.listLibrary).mockResolvedValue({ items: [], next_cursor: null })
    let sortBy: 'updated' | 'title' = 'updated'
    const { rerender } = renderHook(
      () => useSourceLibrary({ query: '', sortBy, sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(sourcesApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      sort_by: 'updated',
    })))

    sortBy = 'title'
    rerender()

    await waitFor(() => expect(sourcesApi.listLibrary).toHaveBeenCalledWith(expect.objectContaining({
      sort_by: 'title',
    })))
    const latest = vi.mocked(sourcesApi.listLibrary).mock.calls.at(-1)?.[0] ?? {}
    expect(latest).not.toHaveProperty('cursor')
  })

  it('refreshes source metadata when processing reaches a terminal state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    vi.mocked(sourcesApi.status).mockResolvedValue({
      status: 'completed',
      message: 'Completed',
    })

    renderHook(
      () => useSourceStatus('source:processing', true, 'running'),
      { wrapper: createWrapper(client) },
    )

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sources'] }))
  })
})
