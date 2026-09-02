import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from './I18nProvider'

let language = 'en-US'

vi.mock('@/lib/i18n', () => ({}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language, resolvedLanguage: language },
  }),
}))
vi.mock('@/components/common/LanguageLoadingOverlay', () => ({
  LanguageLoadingOverlay: () => null,
}))

describe('I18nProvider', () => {
  beforeEach(() => {
    language = 'en-US'
    document.documentElement.lang = 'en'
  })

  it('keeps the document language synchronized with the active locale', async () => {
    const { rerender } = render(<I18nProvider>content</I18nProvider>)

    await waitFor(() => expect(document.documentElement.lang).toBe('en-US'))

    language = 'zh-CN'
    rerender(<I18nProvider>content</I18nProvider>)

    await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'))
  })
})
