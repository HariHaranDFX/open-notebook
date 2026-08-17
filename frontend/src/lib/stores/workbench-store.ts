'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WorkbenchPaneId = 'evidence' | 'notes'
export type WorkbenchMobileView = 'chat' | 'panel'

export const MIN_LEFT_PANEL_WIDTH = 280
export const MAX_LEFT_PANEL_WIDTH = 680
export const DEFAULT_LEFT_PANEL_WIDTH = 460
export const TABLET_LEFT_PANEL_WIDTH = 340

interface WorkbenchStore {
  leftWidthByWorkspace: Record<string, number>
  chatCollapsedByWorkspace: Record<string, boolean>
  activePaneByWorkspace: Record<string, WorkbenchPaneId>
  mobileViewByWorkspace: Record<string, WorkbenchMobileView>
  hasHydrated: boolean
  setLeftWidth: (workspaceKey: string, width: number) => void
  setChatCollapsed: (workspaceKey: string, collapsed: boolean) => void
  setActivePane: (workspaceKey: string, pane: WorkbenchPaneId) => void
  setMobileView: (workspaceKey: string, view: WorkbenchMobileView) => void
  setHasHydrated: (hasHydrated: boolean) => void
}

export function clampLeftPanelWidth(width: number): number {
  return Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(MAX_LEFT_PANEL_WIDTH, width))
}

export const useWorkbenchStore = create<WorkbenchStore>()(
  persist(
    set => ({
      leftWidthByWorkspace: {},
      chatCollapsedByWorkspace: {},
      activePaneByWorkspace: {},
      mobileViewByWorkspace: {},
      hasHydrated: false,
      setLeftWidth: (workspaceKey, width) => set(state => ({
        leftWidthByWorkspace: {
          ...state.leftWidthByWorkspace,
          [workspaceKey]: clampLeftPanelWidth(width),
        },
      })),
      setChatCollapsed: (workspaceKey, collapsed) => set(state => ({
        chatCollapsedByWorkspace: {
          ...state.chatCollapsedByWorkspace,
          [workspaceKey]: collapsed,
        },
      })),
      setActivePane: (workspaceKey, pane) => set(state => ({
        activePaneByWorkspace: {
          ...state.activePaneByWorkspace,
          [workspaceKey]: pane,
        },
      })),
      setMobileView: (workspaceKey, view) => set(state => ({
        mobileViewByWorkspace: {
          ...state.mobileViewByWorkspace,
          [workspaceKey]: view,
        },
      })),
      setHasHydrated: hasHydrated => set({ hasHydrated }),
    }),
    {
      name: 'research-workbench-storage',
      skipHydration: true,
      partialize: ({
        leftWidthByWorkspace,
        chatCollapsedByWorkspace,
        activePaneByWorkspace,
        mobileViewByWorkspace,
      }) => ({
        leftWidthByWorkspace,
        chatCollapsedByWorkspace,
        activePaneByWorkspace,
        mobileViewByWorkspace,
      }),
      onRehydrateStorage: () => state => state?.setHasHydrated(true),
    },
  ),
)
