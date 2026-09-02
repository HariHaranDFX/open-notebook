import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sourcesApi } from '@/lib/api/sources'
import { useSourceLibrary, useSourceStatus } from '@/lib/hooks/use-sources'
import type { SourceListResponse } from '@/lib/types/api'

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: { list: vi.fn(), status: vi.fn() },
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
  beforeEach(() => vi.mocked(sourcesApi.list).mockReset())

  it('requests the first filtered and sorted page', async () => {
    vi.mocked(sourcesApi.list).mockResolvedValue([])

    renderHook(
      () => useSourceLibrary({ query: 'evidence', sortBy: 'title', sortOrder: 'asc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(sourcesApi.list).toHaveBeenCalledWith({
      query: 'evidence',
      sort_by: 'title',
      sort_order: 'asc',
      limit: 30,
      offset: 0,
    }))
  })

  it('loads the next page at the next offset', async () => {
    vi.mocked(sourcesApi.list)
      .mockResolvedValueOnce(Array.from({ length: 30 }, (_, index) => source(index)))
      .mockResolvedValueOnce([source(30)])

    const { result } = renderHook(
      () => useSourceLibrary({ query: '', sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.sources).toHaveLength(30))
    await act(async () => { await result.current.fetchNextPage() })

    expect(sourcesApi.list).toHaveBeenLastCalledWith({
      query: '',
      sort_by: 'updated',
      sort_order: 'desc',
      limit: 30,
      offset: 30,
    })
    await waitFor(() => expect(result.current.sources).toHaveLength(31))
  })

  it('starts a fresh query when the search changes', async () => {
    vi.mocked(sourcesApi.list).mockResolvedValue([])
    let search = 'first'
    const { rerender } = renderHook(
      () => useSourceLibrary({ query: search, sortBy: 'updated', sortOrder: 'desc' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(sourcesApi.list).toHaveBeenCalledWith(expect.objectContaining({
      query: 'first',
      offset: 0,
    })))
    search = 'second'
    rerender()

    await waitFor(() => expect(sourcesApi.list).toHaveBeenCalledWith(expect.objectContaining({
      query: 'second',
      offset: 0,
    })))
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
