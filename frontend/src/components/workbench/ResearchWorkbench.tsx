'use client'

import { useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsDesktop, useIsTablet } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  TABLET_LEFT_PANEL_WIDTH,
  type WorkbenchPaneId,
  useWorkbenchStore,
} from '@/lib/stores/workbench-store'
import { cn } from '@/lib/utils'
import { PaneResizer } from './PaneResizer'

export type { WorkbenchPaneId } from '@/lib/stores/workbench-store'

export interface WorkbenchPane {
  id: WorkbenchPaneId
  label: string
  icon: ComponentType<{ className?: string }>
  content: ReactNode
  count?: number
  // Optional control shown at the right of the tab bar while this pane is active
  // (e.g. a close button for the preview pane).
  action?: ReactNode
}

interface ResearchWorkbenchProps {
  workspaceKey: string
  panes: WorkbenchPane[]
  chat: ReactNode
  panelLabel?: string
}

function PaneTabs({
  workspaceKey,
  panes,
}: Pick<ResearchWorkbenchProps, 'workspaceKey' | 'panes'>) {
  const storedActivePane = useWorkbenchStore(state => state.activePaneByWorkspace[workspaceKey])
  const setActivePane = useWorkbenchStore(state => state.setActivePane)
  const activePane = panes.some(pane => pane.id === storedActivePane)
    ? storedActivePane
    : panes[0]?.id

  if (!activePane) return null

  const activePaneAction = panes.find(pane => pane.id === activePane)?.action

  return (
    <Tabs
      value={activePane}
      onValueChange={value => setActivePane(workspaceKey, value as WorkbenchPaneId)}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <TabsList className="h-12 w-full justify-start rounded-none border-x-0 border-t-0 border-b border-border bg-card px-2 py-0">
        {panes.map(pane => {
          const Icon = pane.icon
          return (
            <TabsTrigger
              key={pane.id}
              value={pane.id}
              className="h-12 flex-none rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Icon className="size-4" />
              <span>{pane.label}</span>
              {pane.count !== undefined && (
                <Badge
                  variant="secondary"
                  className="pointer-events-none min-w-6 px-1.5 tabular-nums"
                >
                  {pane.count}
                </Badge>
              )}
            </TabsTrigger>
          )
        })}
        {activePaneAction && (
          <span className="ml-auto flex items-center pr-1">{activePaneAction}</span>
        )}
      </TabsList>
      {panes.map(pane => (
        <TabsContent
          key={pane.id}
          value={pane.id}
          className="relative min-h-0 flex-1 overflow-hidden"
        >
          <section role="region" aria-label={pane.label} className="absolute inset-0 min-h-0 overflow-hidden">
            {pane.content}
          </section>
        </TabsContent>
      ))}
    </Tabs>
  )
}

export function ResearchWorkbench({
  workspaceKey,
  panes,
  chat,
  panelLabel = 'Panel',
}: ResearchWorkbenchProps) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const isTablet = useIsTablet()
  const hasHydrated = useWorkbenchStore(state => state.hasHydrated)
  const storedWidth = useWorkbenchStore(state => state.leftWidthByWorkspace[workspaceKey])
  const collapsed = useWorkbenchStore(state => state.chatCollapsedByWorkspace[workspaceKey] ?? false)
  const mobileView = useWorkbenchStore(state => state.mobileViewByWorkspace[workspaceKey] ?? 'chat')
  const setLeftWidth = useWorkbenchStore(state => state.setLeftWidth)
  const setChatCollapsed = useWorkbenchStore(state => state.setChatCollapsed)
  const setMobileView = useWorkbenchStore(state => state.setMobileView)
  const [width, setWidth] = useState(storedWidth ?? (isTablet ? TABLET_LEFT_PANEL_WIDTH : DEFAULT_LEFT_PANEL_WIDTH))

  useEffect(() => {
    if (!hasHydrated) void useWorkbenchStore.persist.rehydrate()
  }, [hasHydrated])

  useEffect(() => {
    setWidth(storedWidth ?? (isTablet ? TABLET_LEFT_PANEL_WIDTH : DEFAULT_LEFT_PANEL_WIDTH))
  }, [isTablet, storedWidth])

  if (panes.length === 0) return null

  if (!isDesktop) {
    return (
      <div data-testid="workbench-compact" className="flex h-full min-h-0 min-w-0 w-full flex-col gap-3 overflow-hidden">
        <Tabs
          value={mobileView}
          onValueChange={value => setMobileView(workspaceKey, value as 'chat' | 'panel')}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="grid h-11 w-full grid-cols-2 bg-muted p-1">
            <TabsTrigger value="chat">{t('common.chat')}</TabsTrigger>
            <TabsTrigger value="panel" className="min-w-0 truncate">{panelLabel}</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="min-h-0 flex-1 overflow-hidden border border-border bg-background">
            {chat}
          </TabsContent>
          <TabsContent value="panel" className="min-h-0 flex-1 overflow-hidden border border-border bg-background">
            <PaneTabs workspaceKey={workspaceKey} panes={panes} />
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div data-testid="workbench-desktop" className="flex h-full min-h-0 w-full overflow-hidden border-y border-r border-border bg-background">
      <div
        className={cn('min-w-0 overflow-hidden', collapsed ? 'flex-1' : 'shrink-0')}
        style={collapsed ? undefined : { width }}
      >
        <PaneTabs workspaceKey={workspaceKey} panes={panes} />
      </div>
      {!collapsed && (
        <PaneResizer
          width={width}
          leftLabel={panelLabel}
          rightLabel={t('common.chat')}
          onResize={setWidth}
          onResizeEnd={next => setLeftWidth(workspaceKey, next)}
        />
      )}
      {collapsed ? (
        <Button
          data-testid="workbench-chat-rail"
          variant="ghost"
          aria-expanded="false"
          aria-label={t('workbench.expandChat')}
          className="h-full w-11 shrink-0 rounded-none border-l border-border px-0"
          onClick={() => setChatCollapsed(workspaceKey, false)}
        >
          <span className="flex h-full flex-col items-center gap-4 py-3">
            <ChevronLeft className="size-4" />
            <span className="flex items-center gap-2 [writing-mode:vertical-rl]">
              <MessageSquare className="size-4" />
              {t('common.chat')}
            </span>
          </span>
        </Button>
      ) : (
        <div className="relative min-w-80 flex-1 overflow-hidden">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('workbench.collapseChat')}
            className="absolute right-2 top-2 z-20"
            onClick={() => setChatCollapsed(workspaceKey, true)}
          >
            <ChevronRight className="size-4" />
          </Button>
          {chat}
        </div>
      )}
    </div>
  )
}
