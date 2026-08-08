'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AppSidebar } from './AppSidebar'
import { SetupBanner } from './SetupBanner'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation()
  const pathname = usePathname()
  const mainRef = useRef<HTMLElement>(null)
  const [navigationOpen, setNavigationOpen] = useState(false)

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-[var(--control-radius)] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-transform duration-[var(--motion-fast)] focus:translate-y-0"
      >
        {t('common.skipToContent')}
      </a>

      <aside className="hidden h-full shrink-0 lg:block">
        <AppSidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.openNavigation')}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent className="p-0">
              <SheetTitle className="sr-only">{t('common.appName')}</SheetTitle>
              <SheetDescription className="sr-only">{t('common.openNavigation')}</SheetDescription>
              <AppSidebar mode="drawer" onNavigate={() => setNavigationOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="truncate text-sm font-semibold text-foreground">{t('common.appName')}</span>
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
    </div>
  )
}
