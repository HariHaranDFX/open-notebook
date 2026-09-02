/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useResourcePreview } from './use-resource-preview'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}))

describe('useResourcePreview', () => {
  const pushMock = vi.fn()
  const pathnameMock = '/search'

  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({ push: pushMock } as any)
    vi.mocked(usePathname).mockReturnValue(pathnameMock)
    pushMock.mockClear()
  })

  it('reports a closed preview when no params are present', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as any)
    const { result } = renderHook(() => useResourcePreview())

    expect(result.current.type).toBeNull()
    expect(result.current.id).toBeNull()
  })

  it('reads a valid preview from the URL', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('preview=note&previewId=note:1') as any
    )
    const { result } = renderHook(() => useResourcePreview())

    expect(result.current.type).toBe('note')
    expect(result.current.id).toBe('note:1')
  })

  it('treats an invalid preview type as a closed preview', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('preview=bogus&previewId=x') as any
    )
    const { result } = renderHook(() => useResourcePreview())

    expect(result.current.type).toBeNull()
    expect(result.current.id).toBeNull()
  })

  it('opens a preview while preserving existing mode and query params', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('mode=ask&q=hello') as any
    )
    const { result } = renderHook(() => useResourcePreview())

    act(() => {
      result.current.openPreview('source', 'source:1')
    })

    expect(pushMock).toHaveBeenCalledWith(
      '/search?mode=ask&q=hello&preview=source&previewId=source%3A1',
      { scroll: false }
    )
  })

  it('closes a preview by removing only its two params', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('mode=ask&q=hello&preview=note&previewId=note%3A1') as any
    )
    const { result } = renderHook(() => useResourcePreview())

    act(() => {
      result.current.closePreview()
    })

    expect(pushMock).toHaveBeenCalledWith('/search?mode=ask&q=hello', { scroll: false })
  })
})
