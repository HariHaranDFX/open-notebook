import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { sharingApi } from '@/lib/api/sharing'
import {
  useEntraGroupSearch,
  useLinkEntraGroup,
  useSyncEntraGroups,
} from './use-sharing'

vi.mock('@/lib/api/sharing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/sharing')>(
    '@/lib/api/sharing',
  )
  return {
    ...actual,
    sharingApi: {
      ...actual.sharingApi,
      searchEntraGroups: vi.fn(),
      linkEntraGroup: vi.fn(),
      syncEntraGroups: vi.fn(),
    },
  }
})

vi.mock('@/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  Wrapper.displayName = 'TestQueryWrapper'
  return Wrapper
}

describe('Entra group hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('useEntraGroupSearch calls sharingApi.searchEntraGroups with the query', async () => {
    ;(sharingApi.searchEntraGroups as ReturnType<typeof vi.fn>).mockResolvedValue([
      { entra_group_oid: 'e1', display_name: 'Eng', description: null },
    ])
    const { result } = renderHook(() => useEntraGroupSearch('eng'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(sharingApi.searchEntraGroups).toHaveBeenCalledWith('eng')
    expect(result.current.data?.[0].entra_group_oid).toBe('e1')
  })

  it('useEntraGroupSearch fires on empty query too (browse mode) and skips when disabled', async () => {
    // Empty query is now a valid "browse-top-25" call — the hook fires
    // whenever `enabled` is true (default) so the picker seeds the list
    // on open.
    ;(sharingApi.searchEntraGroups as ReturnType<typeof vi.fn>).mockResolvedValue([])
    renderHook(() => useEntraGroupSearch('   '), {
      wrapper: wrapper(),
    })
    await waitFor(() =>
      expect(sharingApi.searchEntraGroups).toHaveBeenCalledWith('')
    )

    // But callers that pass `enabled=false` (e.g. dialog closed) skip
    // Graph entirely — no wasted calls on page mount.
    ;(sharingApi.searchEntraGroups as ReturnType<typeof vi.fn>).mockClear()
    const disabled = renderHook(() => useEntraGroupSearch('   ', false), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe('idle'))
    expect(sharingApi.searchEntraGroups).not.toHaveBeenCalled()
  })

  it('useLinkEntraGroup posts and invalidates groups cache on success', async () => {
    ;(sharingApi.linkEntraGroup as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'g1',
      name: 'Eng',
      description: null,
      source: 'entra',
      entra_group_oid: 'e1',
      member_count: 0,
    })
    const { result } = renderHook(() => useLinkEntraGroup(), {
      wrapper: wrapper(),
    })
    const linked = await result.current.mutateAsync({ entra_group_oid: 'e1' })
    expect(sharingApi.linkEntraGroup).toHaveBeenCalledWith({
      entra_group_oid: 'e1',
    })
    expect(linked.source).toBe('entra')
  })

  it('useSyncEntraGroups returns command_id from the endpoint', async () => {
    ;(sharingApi.syncEntraGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
      command_id: 'cmd-42',
    })
    const { result } = renderHook(() => useSyncEntraGroups(), {
      wrapper: wrapper(),
    })
    const res = await result.current.mutateAsync()
    expect(sharingApi.syncEntraGroups).toHaveBeenCalled()
    expect(res.command_id).toBe('cmd-42')
  })
})
