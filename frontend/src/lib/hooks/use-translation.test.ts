import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { BrandProvider } from '@/components/providers/BrandProvider'
import type { BrandConfig } from '@/lib/types/brand'
// Ensure we are testing the real implementation
vi.unmock('@/lib/hooks/use-translation')
import { useTranslation } from './use-translation'
import { useTranslation as useI18nTranslation } from 'react-i18next'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: vi.fn()
}))

describe('useTranslation Hook', () => {
  const changeLanguageMock = vi.fn()
  const atlasBrand: BrandConfig = {
    appName: 'Atlas Research',
    logoUrl: '/brand/atlas.svg',
    actionLight: '#275E91',
    actionDark: '#74A9D6',
  }
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(BrandProvider, { brand: atlasBrand }, children)

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useI18nTranslation as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'common.appName') return String(options?.appName ?? '{{appName}}')
        if (key === 'auth.loginDesc') return `Sign in to ${options?.appName ?? '{{appName}}'}`
        return key
      },
      i18n: {
        language: 'en-US',
        changeLanguage: changeLanguageMock,
      },
    })
  })

  it('should return standard t() function for translations', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper })
    expect(result.current.language).toBe('en-US')
    expect(result.current.t('common.appName')).toBe('Atlas Research')
    expect(result.current.t('auth.loginDesc')).toBe('Sign in to Atlas Research')
  })

  it('preserves an explicit appName interpolation value', () => {
    const { result } = renderHook(() => useTranslation(), { wrapper })
    expect(result.current.t('auth.loginDesc', { appName: 'Explicit Name' })).toBe('Sign in to Explicit Name')
  })

  it('should allow changing language via setLanguage', () => {
    const { result } = renderHook(() => useTranslation())

    act(() => {
      result.current.setLanguage('zh-CN')
    })

    expect(changeLanguageMock).toHaveBeenCalledWith('zh-CN')
  })
})

describe('brand identity audit', () => {
  it('keeps user-visible production identity out of source and locale strings', () => {
    const srcDir = path.resolve(__dirname, '../..')
    const occurrences: string[] = []

    for (const relativePath of fs.readdirSync(srcDir, { recursive: true }) as string[]) {
      if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx')) continue
      if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx')) continue

      const normalizedPath = relativePath.replaceAll('\\', '/')
      const lines = fs.readFileSync(path.join(srcDir, relativePath), 'utf8').split(/\r?\n/)

      lines.forEach((line, index) => {
        if (!line.includes('Open Notebook')) return
        const isDevelopmentFallback = normalizedPath === 'components/providers/BrandProvider.tsx'
        const isUpstreamDocumentationLabel = normalizedPath.includes('lib/locales/') && line.includes('docLink:')
        if (!isDevelopmentFallback && !isUpstreamDocumentationLabel) {
          occurrences.push(`${normalizedPath}:${index + 1}`)
        }
      })
    }

    expect(occurrences).toEqual([])
  })
})
