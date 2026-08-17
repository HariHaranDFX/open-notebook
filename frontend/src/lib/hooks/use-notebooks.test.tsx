import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notebooksApi } from '@/lib/api/notebooks'
import { useNotebooks } from '@/lib/hooks/use-notebooks'

vi.mock('@/lib/api/notebooks', () => ({
  notebooksApi: { list: vi.fn() },
}))

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
