'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

import {
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { BrandLogo } from '@/components/common/BrandLogo'
import { useBrand } from '@/components/providers/BrandProvider'
import { MOBILE_DETAIL_ACTIONS_ID } from '@/components/workbench/DetailHeader'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AppSidebar } from './AppSidebar'
import { SetupBanner } from './SetupBanner'

interface AppShellProps {
  children: React.ReactNode
}

const SIDEBAR_STORAGE_KEY = 'open-notebook:sidebar-expanded'
const WIDE_SIDEBAR_QUERY = '(min-width: 1440px)'

export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation()
  const { appName } = useBrand()
  const pathname = usePathname()
  const mainRef = useRef<HTMLElement>(null)
  const hasSidebarPreference = useRef(false)
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean | null>(null)

  const handleSidebarExpandedChange = useCallback((expanded: boolean) => {
    hasSidebarPreference.current = true
    setSidebarExpanded(expanded)

    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded))
    } catch {
      // The control still works when storage is unavailable.
    }
  }, [])

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  useEffect(() => {
    const mediaQuery = window.matchMedia(WIDE_SIDEBAR_QUERY)

    try {
      const savedPreference = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (savedPreference === 'true' || savedPreference === 'false') {
        hasSidebarPreference.current = true
        setSidebarExpanded(savedPreference === 'true')
      } else {
        setSidebarExpanded(mediaQuery.matches)
      }
    } catch {
      setSidebarExpanded(mediaQuery.matches)
    }

    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!hasSidebarPreference.current) setSidebarExpanded(event.matches)
    }

    mediaQuery.addEventListener('change', handleViewportChange)
    return () => mediaQuery.removeEventListener('change', handleViewportChange)
  }, [])

  return (
    <SidebarProvider
      open={sidebarExpanded ?? false}
      onOpenChange={handleSidebarExpandedChange}
      className="h-screen h-dvh overflow-hidden bg-background"
    >
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-[var(--control-radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform duration-[var(--motion-fast)] focus:translate-y-0"
      >
        {t('common.skipToContent')}
      </a>

      <AppSidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header
          data-slot="mobile-app-header"
          className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-border bg-card px-2 sm:px-4 lg:hidden"
        >
          <SidebarTrigger
            aria-label={t('common.openNavigation')}
            className="col-start-1 row-start-1 justify-self-start"
          />
          <div
            data-slot="mobile-app-brand"
            className="col-start-2 row-start-1 flex min-w-0 max-w-[30vw] items-center justify-center gap-1.5 justify-self-center"
          >
            <BrandLogo priority size={28} />
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{appName}</span>
          </div>
          <div
            id={MOBILE_DETAIL_ACTIONS_ID}
            className="col-start-3 row-start-1 flex shrink-0 items-center justify-self-end"
          />
        </header>

        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
        >
          <SetupBanner />
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}
