'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { TFunction } from 'i18next'
import {
  Book,
  Bot,
  Command,
  FileText,
  LogOut,
  Mic,
  Plus,
  Search,
  Settings,
  Shuffle,
  Users,
  Wrench,
} from 'lucide-react'

import { LanguageToggle } from '@/components/common/LanguageToggle'
import { BrandLogo } from '@/components/common/BrandLogo'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { useBrand } from '@/components/providers/BrandProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAuth } from '@/lib/hooks/use-auth'
import { useCreateDialogs } from '@/lib/hooks/use-create-dialogs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { isNavItemActive } from './nav-active'

const getNavigation = (t: TFunction) => [
  {
    title: t('navigation.collect'),
    items: [
      { name: t('navigation.sources'), href: '/sources', icon: FileText },
    ],
  },
  {
    title: t('navigation.process'),
    items: [
      { name: t('navigation.notebooks'), href: '/notebooks', icon: Book },
      { name: t('navigation.askAndSearch'), href: '/search', icon: Search },
    ],
  },
  {
    title: t('navigation.create'),
    items: [
      { name: t('navigation.podcasts'), href: '/podcasts', icon: Mic },
      { name: t('navigation.transformations'), href: '/transformations', icon: Shuffle },
    ],
  },
  {
    title: t('navigation.manage'),
    items: [
      { name: t('navigation.models'), href: '/settings/api-keys', icon: Bot, adminOnly: true },
      { name: t('navigation.groups'), href: '/settings/groups', icon: Users, adminOnly: true },
      { name: t('navigation.settings'), href: '/settings', icon: Settings, adminOnly: true },
      { name: t('navigation.advanced'), href: '/advanced', icon: Wrench, adminOnly: true },
    ],
  },
] as const

type CreateTarget = 'source' | 'notebook' | 'podcast'

interface AppSidebarProps {
  mode?: 'persistent' | 'drawer'
  onNavigate?: () => void
}

export function AppSidebar({ mode = 'persistent', onNavigate }: AppSidebarProps) {
  const { t } = useTranslation()
  const { appName } = useBrand()
  const { logout, isAdmin } = useAuth()
  const pathname = usePathname()
  const { openSourceDialog, openNotebookDialog, openPodcastDialog } = useCreateDialogs()
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [isMac, setIsMac] = useState(true)
  const isDrawer = mode === 'drawer'

  const navigation = getNavigation(t)
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => isAdmin || !('adminOnly' in item && item.adminOnly)
      ),
    }))
    .filter((section) => section.items.length > 0)
  const navHrefs = navigation.flatMap((section) => section.items.map((item) => item.href))

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'))
  }, [])

  const handleCreateSelection = (target: CreateTarget) => {
    setCreateMenuOpen(false)

    if (target === 'source') openSourceDialog()
    if (target === 'notebook') openNotebookDialog()
    if (target === 'podcast') openPodcastDialog()
  }

  const labelClass = isDrawer ? '' : 'hidden min-[1440px]:inline'
  const sectionClass = isDrawer ? '' : 'hidden min-[1440px]:block'

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'app-sidebar flex h-full flex-col border-r border-sidebar-border',
          isDrawer ? 'w-full' : 'w-[72px] min-[1440px]:w-64'
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border',
            isDrawer ? 'px-4 pr-12' : 'justify-center px-3 min-[1440px]:justify-start min-[1440px]:px-4'
          )}
        >
          <BrandLogo priority />
          <span className={cn('truncate text-base font-semibold text-white', labelClass)}>
            {appName}
          </span>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label={appName}>
          <div className="mb-3">
            <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      className={cn(
                        'w-full border-0 bg-primary text-primary-foreground hover:bg-primary/90',
                        isDrawer ? 'justify-start' : 'justify-center px-2 min-[1440px]:justify-start min-[1440px]:px-3'
                      )}
                      aria-label={t('common.create')}
                    >
                      <Plus className="size-4" />
                      <span className={labelClass}>{t('common.create')}</span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                {!isDrawer && (
                  <TooltipContent side="right" className="min-[1440px]:hidden">
                    {t('common.create')}
                  </TooltipContent>
                )}
              </Tooltip>
              <DropdownMenuContent
                align={isDrawer ? 'start' : 'end'}
                side={isDrawer ? 'bottom' : 'right'}
                className="w-48"
              >
                <DropdownMenuItem onSelect={() => handleCreateSelection('source')} className="gap-2">
                  <FileText className="size-4" />
                  {t('common.source')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleCreateSelection('notebook')} className="gap-2">
                  <Book className="size-4" />
                  {t('common.notebook')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleCreateSelection('podcast')} className="gap-2">
                  <Mic className="size-4" />
                  {t('common.podcast')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {navigation.map((section, index) => (
            <div key={section.title}>
              {index > 0 && <Separator className="my-3 bg-sidebar-border" />}
              <h2
                className={cn(
                  'mb-2 px-3 text-xs font-semibold uppercase tracking-[0.08em] text-sidebar-foreground',
                  sectionClass
                )}
              >
                {section.title}
              </h2>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = isNavItemActive(pathname, item.href, navHrefs)
                  const link = (
                    <Button
                      asChild
                      variant="ghost"
                      className={cn(
                        'sidebar-menu-item w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        isDrawer ? 'justify-start' : 'justify-center px-2 min-[1440px]:justify-start min-[1440px]:px-4',
                        isActive && 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                      )}
                    >
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <item.icon className="size-4" />
                        <span className={labelClass}>{item.name}</span>
                      </Link>
                    </Button>
                  )

                  if (isDrawer) return <div key={item.name}>{link}</div>

                  return (
                    <Tooltip key={item.name}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right" className="min-[1440px]:hidden">
                        {item.name}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-sidebar-border p-2 min-[1440px]:p-3">
          <div className={cn('px-3 py-1.5 text-xs text-sidebar-foreground', sectionClass)}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Command className="size-3" />
                {t('common.quickActions')}
              </span>
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center rounded-[var(--surface-radius)] border border-sidebar-border px-1.5 font-mono text-[10px] font-medium">
                {isMac ? '⌘K' : 'Ctrl+K'}
              </kbd>
            </div>
            <p className="mt-1 text-xs text-sidebar-foreground/80">{t('common.quickActionsDesc')}</p>
          </div>

          {isDrawer ? (
            <>
              <ThemeToggle />
              <LanguageToggle />
            </>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild><div className="min-[1440px]:hidden"><ThemeToggle iconOnly /></div></TooltipTrigger>
                <TooltipContent side="right" className="min-[1440px]:hidden">{t('common.theme')}</TooltipContent>
              </Tooltip>
              <div className="hidden min-[1440px]:block"><ThemeToggle /></div>
              <Tooltip>
                <TooltipTrigger asChild><div className="min-[1440px]:hidden"><LanguageToggle iconOnly /></div></TooltipTrigger>
                <TooltipContent side="right" className="min-[1440px]:hidden">{t('common.language')}</TooltipContent>
              </Tooltip>
              <div className="hidden min-[1440px]:block"><LanguageToggle /></div>
            </>
          )}

          <Button
            variant="outline"
            className={cn(
              'sidebar-menu-item w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isDrawer ? 'justify-start' : 'justify-center px-2 min-[1440px]:justify-start min-[1440px]:px-4'
            )}
            onClick={logout}
            aria-label={t('common.signOut')}
          >
            <LogOut className="size-4" />
            <span className={labelClass}>{t('common.signOut')}</span>
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
