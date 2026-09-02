'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export type PreviewResourceType = 'source' | 'note' | 'source_insight'

export interface ResourcePreviewState {
  type: PreviewResourceType | null
  id: string | null
  openPreview: (type: PreviewResourceType, id: string) => void
  closePreview: () => void
}

const PREVIEW_TYPES: readonly PreviewResourceType[] = ['source', 'note', 'source_insight']

function isPreviewType(value: string | null): value is PreviewResourceType {
  return value !== null && (PREVIEW_TYPES as readonly string[]).includes(value)
}

/**
 * URL-backed resource preview state (`?preview=<type>&previewId=<id>`). Opening a
 * preview keeps every other query param (e.g. `mode`, `q`) so the answer/results
 * stay put; closing removes only its own two params. An invalid `preview` value
 * resolves to a closed preview. No store — the URL is the single source of truth.
 */
export function useResourcePreview(): ResourcePreviewState {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const rawType = searchParams?.get('preview') ?? null
  const type = isPreviewType(rawType) ? rawType : null
  const id = type ? searchParams?.get('previewId') ?? null : null

  const openPreview = useCallback(
    (previewType: PreviewResourceType, previewId: string) => {
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('preview', previewType)
      params.set('previewId', previewId)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, searchParams, pathname]
  )

  const closePreview = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('preview')
    params.delete('previewId')
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [router, searchParams, pathname])

  return { type, id, openPreview, closePreview }
}
