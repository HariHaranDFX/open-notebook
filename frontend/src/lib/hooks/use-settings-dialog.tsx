'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { SettingsDialog, type SettingsTab } from '@/components/settings/SettingsDialog'

interface SettingsDialogContextType {
  openSettings: (tab?: SettingsTab) => void
}

const SettingsDialogContext = createContext<SettingsDialogContextType | null>(null)

/** Renders the single global admin settings modal and lets any descendant open it. */
export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<SettingsTab>('general')

  const openSettings = useCallback((next: SettingsTab = 'general') => {
    setTab(next)
    setOpen(true)
  }, [])

  return (
    <SettingsDialogContext.Provider value={{ openSettings }}>
      {children}
      <SettingsDialog open={open} onOpenChange={setOpen} defaultTab={tab} />
    </SettingsDialogContext.Provider>
  )
}

export function useSettingsDialog() {
  const context = useContext(SettingsDialogContext)
  if (!context) {
    throw new Error('useSettingsDialog must be used within a SettingsDialogProvider')
  }
  return context
}
