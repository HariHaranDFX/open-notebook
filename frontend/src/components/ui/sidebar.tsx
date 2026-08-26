'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { PanelLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

type SidebarContextValue = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.')
  return context
}

export function SidebarProvider({
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [openMobile, setOpenMobile] = React.useState(false)
  const open = controlledOpen ?? internalOpen

  const setOpen = React.useCallback((nextOpen: boolean) => {
    onOpenChange?.(nextOpen)
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
  }, [controlledOpen, onOpenChange])

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile((current) => !current)
    else setOpen(!open)
  }, [isMobile, open, setOpen])

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]')
        || Boolean(target?.closest('[contenteditable="true"], [role="dialog"]'))

      if (
        event.repeat
        || event.altKey
        || event.shiftKey
        || event.key.toLowerCase() !== 'b'
        || (!event.ctrlKey && !event.metaKey)
        || isEditing
        || window.innerWidth < 1024
      ) return

      event.preventDefault()
      setOpen(!open)
    }

    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [open, setOpen])

  const state: SidebarContextValue['state'] = open ? 'expanded' : 'collapsed'
  const value = React.useMemo(() => ({
    state,
    open,
    setOpen,
    openMobile,
    setOpenMobile,
    isMobile,
    toggleSidebar,
  }), [state, open, setOpen, openMobile, isMobile, toggleSidebar])

  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider delayDuration={300}>
        <div
          data-slot="sidebar-wrapper"
          style={{
            '--sidebar-width': '15rem',
            '--sidebar-width-icon': '4rem',
            ...style,
          } as React.CSSProperties}
          className={cn('flex min-h-svh w-full', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

export function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<'aside'>) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
  const { t } = useTranslation()

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent className="flex w-[min(320px,calc(100vw-24px))] flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>{t('navigation.nav')}</SheetTitle>
            <SheetDescription>{t('navigation.nav')}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
          <SheetFooter className="border-t border-sidebar-border p-2">
            <Button variant="ghost" onClick={() => setOpenMobile(false)}>
              {t('common.closeNavigation')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      data-slot="sidebar"
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
      className={cn(
        'group/sidebar relative hidden h-full w-(--sidebar-width) shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-[var(--motion-standard)] lg:flex',
        state === 'collapsed' && 'w-(--sidebar-width-icon)',
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  )
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex shrink-0 flex-col', className)} {...props} />
}

export function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)} {...props} />
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('flex shrink-0 flex-col', className)} {...props} />
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('flex min-w-0 flex-col', className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'h2'>) {
  const { state, isMobile } = useSidebar()
  if (state === 'collapsed' && !isMobile) return null
  return <h2 data-slot="sidebar-group-label" className={className} {...props} />
}

export function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" className={cn('min-w-0', className)} {...props} />
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex min-w-0 flex-col gap-1', className)} {...props} />
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative min-w-0', className)} {...props} />
}

export function SidebarMenuButton({
  asChild = false,
  isActive = false,
  tooltip,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: React.ReactNode
}) {
  const { state, isMobile } = useSidebar()
  const collapsed = state === 'collapsed' && !isMobile
  const classes = cn(
    'flex h-9 min-w-0 items-center gap-2 overflow-hidden rounded-[var(--control-radius)] px-3 text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
    collapsed ? 'mx-auto size-9 justify-center p-0' : 'w-full',
    isActive && 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
    className,
  )

  const Comp = asChild ? Slot : 'button'
  const button = <Comp className={classes} {...props}>{children}</Comp>

  if (!tooltip) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" hidden={!collapsed}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function SidebarTrigger({
  className,
  children,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={className}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      {children ?? <PanelLeft />}
    </Button>
  )
}

export function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-rail"
      tabIndex={-1}
      aria-hidden="true"
      onClick={toggleSidebar}
      className={cn('absolute inset-y-0 right-0 hidden w-2 translate-x-1/2 cursor-col-resize hover:after:bg-sidebar-border lg:block after:absolute after:inset-y-0 after:left-1/2 after:w-px', className)}
      {...props}
    />
  )
}
