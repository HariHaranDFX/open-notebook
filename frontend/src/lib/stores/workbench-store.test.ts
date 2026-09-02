import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_LEFT_PANEL_WIDTH,
  MAX_LEFT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  clampLeftPanelWidth,
  useWorkbenchStore,
} from './workbench-store'

describe('research workbench preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkbenchStore.setState({
      leftWidthByWorkspace: {},
      chatCollapsedByWorkspace: {},
      activePaneByWorkspace: {},
      mobileViewByWorkspace: {},
      hasHydrated: true,
    })
  })

  it('starts from the handoff desktop panel width', () => {
    expect(DEFAULT_LEFT_PANEL_WIDTH).toBe(460)
  })

  it('clamps the research panel to the handoff resize limits', () => {
    expect(clampLeftPanelWidth(100)).toBe(MIN_LEFT_PANEL_WIDTH)
    expect(clampLeftPanelWidth(900)).toBe(MAX_LEFT_PANEL_WIDTH)
  })

  it('keeps layout and active views isolated by workspace', () => {
    const store = useWorkbenchStore.getState()
    store.setLeftWidth('notebook:one', 520)
    store.setChatCollapsed('notebook:one', true)
    store.setActivePane('notebook:one', 'notes')
    store.setMobileView('notebook:one', 'panel')

    expect(useWorkbenchStore.getState().leftWidthByWorkspace).toEqual({
      'notebook:one': 520,
    })
    expect(useWorkbenchStore.getState().chatCollapsedByWorkspace).toEqual({
      'notebook:one': true,
    })
    expect(useWorkbenchStore.getState().activePaneByWorkspace).toEqual({
      'notebook:one': 'notes',
    })
    expect(useWorkbenchStore.getState().mobileViewByWorkspace).toEqual({
      'notebook:one': 'panel',
    })
    expect(useWorkbenchStore.getState().leftWidthByWorkspace['notebook:two']).toBeUndefined()
  })

  it('persists only workspace layout state under the dedicated storage key', () => {
    const store = useWorkbenchStore.getState()
    store.setLeftWidth('source:one', 400)
    store.setChatCollapsed('source:one', true)
    store.setActivePane('source:one', 'evidence')
    store.setMobileView('source:one', 'chat')

    expect(useWorkbenchStore.persist.getOptions().name).toBe('research-workbench-storage')
    const persisted = JSON.parse(localStorage.getItem('research-workbench-storage') ?? '{}')
    expect(persisted.state).toEqual({
      leftWidthByWorkspace: { 'source:one': 400 },
      chatCollapsedByWorkspace: { 'source:one': true },
      activePaneByWorkspace: { 'source:one': 'evidence' },
      mobileViewByWorkspace: { 'source:one': 'chat' },
    })
  })
})
