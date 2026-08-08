import { useTranslation as useI18nTranslation } from 'react-i18next'
import { useMemo, useCallback } from 'react'
import { emitLanguageChangeEnd, emitLanguageChangeStart } from '@/lib/i18n-events'
import { useBrand } from '@/components/providers/BrandProvider'

/**
 * Thin wrapper around react-i18next's useTranslation hook.
 * Returns the standard t() function along with language utilities.
 */
export function useTranslation() {
  const { t, i18n } = useI18nTranslation()
  const { appName } = useBrand()

  const brandedT = useCallback(
    ((key: Parameters<typeof t>[0], options?: Parameters<typeof t>[1]) =>
      t(key, {
        appName,
        ...(typeof options === 'object' && options !== null ? options : {})
      })) as typeof t,
    [appName, t]
  )

  const setLanguage = useCallback(async (lang: string) => {
    if (lang === i18n.language) {
      return i18n.language
    }

    emitLanguageChangeStart(lang)

    try {
      await i18n.changeLanguage(lang)
      return i18n.language
    } finally {
      emitLanguageChangeEnd(lang)
    }
  }, [i18n])

  return useMemo(() => ({
    t: brandedT,
    i18n,
    language: i18n.language,
    setLanguage
  }), [brandedT, i18n, setLanguage])
}
