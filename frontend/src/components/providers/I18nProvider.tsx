'use client'

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '@/lib/i18n'
import { LanguageLoadingOverlay } from '@/components/common/LanguageLoadingOverlay'

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const { i18n } = useTranslation()
  const activeLanguage = i18n.resolvedLanguage || i18n.language || 'en-US'

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    document.documentElement.lang = activeLanguage
  }, [activeLanguage])

  // Avoid hydration mismatch by waiting for mount
  if (!mounted) {
    return <div style={{ visibility: 'hidden' }}>{children}</div>
  }

  return (
    <>
      <LanguageLoadingOverlay />
      {children}
    </>
  )
}
