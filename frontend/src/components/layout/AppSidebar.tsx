'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { TFunction } from 'i18next'
import {
  Book,
  Bot,
  Check,
  ChevronsUpDown,
  Command,
  FileText,
  Languages,
  LogOut,
  Mic,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shuffle,
  Sun,
  Users,
  Wrench,
} from 'lucide-react'

import { BrandLogo } from '@/components/common/BrandLogo'
import { useBrand } from '@/components/providers/BrandProvider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAuth } from '@/lib/hooks/use-auth'
import { useCreateDialogs } from '@/lib/hooks/use-create-dialogs'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useTheme } from '@/lib/stores/theme-store'
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
      { name: t('navigation.advanced'), href: '/settings/advanced', icon: Wrench, adminOnly: true },
    ],
  },
] as const

const languageOptions = [
  ['en-US', 'common.english'],
  ['ca-ES', 'common.catalan'],
  ['zh-CN', 'common.chinese'],
  ['zh-TW', 'common.traditionalChinese'],
  ['pt-BR', 'common.portuguese'],
  ['ja-JP', 'common.japanese'],
  ['fr-FR', 'common.french'],
  ['ru-RU', 'common.russian'],
  ['bn-IN', 'common.bengali'],
  ['es-ES', 'common.spanish'],
  ['de-DE', 'common.german'],
  ['pl-PL', 'common.polish'],
  ['tr-TR', 'common.turkish'],
] as const

type CreateTarget = 'source' | 'notebook' | 'podcast'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U'
}

export function AppSidebar() {
  const { t, language, setLanguage } = useTranslation()
  const { appName } = useBrand()
  const { logout, isAdmin, user } = useAuth()
  const { theme, setTheme } = useTheme()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const pathname = usePathname()
  const { openSourceDialog, openNotebookDialog, openPodcastDialog } = useCreateDialogs()
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [isMac, setIsMac] = useState(true)

  const navigation = getNavigation(t)
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => isAdmin || !('adminOnly' in item && item.adminOnly)
      ),
    }))
    .filter((section) => section.items.length > 0)
  const navHrefs = navigation.flatMap((section) => section.items.map((item) => item.href))
  const showLabels = isMobile || state === 'expanded'
  const displayName = user?.displayName ?? t('sharing.user')
  const email = user?.email ?? ''
  const avatarText = initials(displayName)
  const toggleLabel = state === 'expanded'
    ? t('common.collapseNavigation')
    : t('common.expandNavigation')
  const shortcut = isMac ? '⌘B' : 'Ctrl+B'

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'))
  }, [])

  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false)
  }

  const handleCreateSelection = (target: CreateTarget) => {
    setCreateMenuOpen(false)
    closeMobileSidebar()
    if (target === 'source') openSourceDialog()
    if (target === 'notebook') openNotebookDialog()
    if (target === 'podcast') openPodcastDialog()
  }

  const isLanguageActive = (code: string) => {
    if (code === 'zh-CN') {
      return language === 'zh' || language === 'zh-CN' || language?.startsWith('zh-Hans')
    }
    if (code === 'zh-TW') {
      return language === 'zh-TW' || language?.startsWith('zh-Hant')
    }
    return language === code || language?.startsWith(code.split('-')[0])
  }

  return (
    <Sidebar aria-label={appName}>
      <SidebarHeader className="h-14 border-b border-sidebar-border">
        <div className={cn(
          'flex h-full items-center gap-2',
          showLabels ? 'pl-4 pr-2' : 'justify-center px-1',
        )}>
          {!showLabels ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger
                  className="group relative size-11 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-offset-sidebar"
                  aria-label={toggleLabel}
                  aria-expanded={false}
                  aria-keyshortcuts="Control+B Meta+B"
                >
                  <BrandLogo
                    priority
                    size={32}
                    className="transition-opacity duration-[var(--motion-standard)] group-hover:opacity-0 group-focus-visible:opacity-0"
                  />
                  <PanelLeftOpen className="absolute size-5 opacity-0 transition-opacity duration-[var(--motion-standard)] group-hover:opacity-100 group-focus-visible:opacity-100" />
                </SidebarTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>{toggleLabel}</span>
                <kbd className="font-mono text-[10px] opacity-75">{shortcut}</kbd>
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <BrandLogo priority size={36} />
              <span className="truncate text-base font-semibold text-foreground">{appName}</span>
              {!isMobile && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarTrigger
                      className="relative ml-auto text-sidebar-foreground after:absolute after:-inset-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-offset-sidebar"
                      aria-label={toggleLabel}
                      aria-expanded
                      aria-keyshortcuts="Control+B Meta+B"
                    >
                      <PanelLeftClose className="size-5" />
                    </SidebarTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    <span>{toggleLabel}</span>
                    <kbd className="font-mono text-[10px] opacity-75">{shortcut}</kbd>
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent
        role="navigation"
        aria-label={appName}
        className={showLabels ? 'px-2 py-3' : 'px-1 py-2'}
      >
        <SidebarGroup className={showLabels ? 'pb-2' : 'pb-1'}>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton
                        className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                        aria-label={t('common.create')}
                      >
                        <Plus />
                        <span className={showLabels ? '' : 'sr-only'}>{t('common.create')}</span>
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" hidden={showLabels}>{t('common.create')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align={isMobile ? 'start' : 'end'}
                  side={isMobile ? 'bottom' : 'right'}
                  className="w-48"
                >
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => handleCreateSelection('source')}>
                      <FileText />
                      {t('common.source')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleCreateSelection('notebook')}>
                      <Book />
                      {t('common.notebook')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleCreateSelection('podcast')}>
                      <Mic />
                      {t('common.podcast')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {navigation.map((section) => (
          <SidebarGroup key={section.title} className={showLabels ? 'py-2' : 'py-1'}>
            <SidebarGroupLabel className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.08em] text-sidebar-foreground">
              {section.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive = isNavItemActive(pathname, item.href, navHrefs)
                  return (
                    <SidebarMenuItem key={item.name}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.name}>
                        <Link
                          href={item.href}
                          onClick={closeMobileSidebar}
                          aria-current={isActive ? 'page' : undefined}
                        >
                          <item.icon />
                          <span className={showLabels ? '' : 'sr-only'}>{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {showLabels && (
          <SidebarGroup className="mt-auto pt-2">
            <div
              data-testid="quick-actions-banner"
              className="rounded-[var(--surface-radius)] border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-xs text-sidebar-foreground"
            >
              <div className="flex items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--control-radius)] bg-sidebar-primary/10 text-sidebar-accent-foreground">
                  <Command className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 font-medium text-sidebar-accent-foreground">
                    <span>{t('common.quickActions')}</span>
                    <kbd className="pointer-events-none inline-flex h-5 shrink-0 select-none items-center rounded-[var(--surface-radius)] border border-sidebar-border bg-sidebar px-1.5 font-mono text-[10px] font-medium text-sidebar-foreground">
                      {isMac ? '⌘K' : 'Ctrl+K'}
                    </kbd>
                  </div>
                  <p className="mt-0.5 leading-relaxed text-sidebar-foreground/80">{t('common.quickActionsDesc')}</p>
                </div>
              </div>
            </div>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className={cn(
        'border-t border-sidebar-border',
        showLabels ? 'px-2 py-1' : 'p-1',
      )}>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      className={cn(
                        'cursor-pointer bg-transparent data-[state=open]:bg-sidebar-accent',
                        showLabels && 'h-12 px-2',
                      )}
                      aria-label={displayName}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--control-radius)] bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                        {avatarText}
                      </span>
                      <span className={cn('min-w-0 flex-1', showLabels ? 'grid text-left leading-tight' : 'sr-only')}>
                        <span className="truncate font-semibold">{displayName}</span>
                        {email && <span className="truncate text-xs font-normal text-sidebar-foreground/80">{email}</span>}
                      </span>
                      {showLabels && <ChevronsUpDown className="ml-auto" />}
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right" hidden={showLabels}>{displayName}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                className="relative left-2 w-64 max-w-[calc(100vw-24px)]"
                side="top"
                align="end"
                sideOffset={8}
              >
                <DropdownMenuLabel className="p-2 font-normal">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--control-radius)] bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                      {avatarText}
                    </span>
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate font-semibold">{displayName}</span>
                      {email && <span className="truncate text-xs text-muted-foreground">{email}</span>}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/settings" onClick={closeMobileSidebar}>
                        <Settings />
                        {t('navigation.settings')}
                      </Link>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2 [&>svg]:size-4 [&>svg]:shrink-0">
                      {theme === 'dark' ? <Moon /> : theme === 'system' ? <Monitor /> : <Sun />}
                      <span>{t('common.theme')}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="relative -top-2">
                      <DropdownMenuItem onSelect={() => setTheme('light')}>
                        <Sun />
                        <span>{t('common.light')}</span>
                        {theme === 'light' && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setTheme('dark')}>
                        <Moon />
                        <span>{t('common.dark')}</span>
                        {theme === 'dark' && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setTheme('system')}>
                        <Monitor />
                        <span>{t('common.system')}</span>
                        {theme === 'system' && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="gap-2 [&>svg]:size-4 [&>svg]:shrink-0"
                      aria-label={t('navigation.language')}
                    >
                      <Languages />
                      <span>{t('common.language')}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="relative -top-2 max-h-80 overflow-y-auto">
                      {languageOptions.map(([code, label]) => (
                        <DropdownMenuItem key={code} onSelect={() => setLanguage(code)}>
                          <span>{t(label)}</span>
                          {isLanguageActive(code) && (
                            <Check className="ml-auto" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
                  <LogOut />
                  {t('common.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
