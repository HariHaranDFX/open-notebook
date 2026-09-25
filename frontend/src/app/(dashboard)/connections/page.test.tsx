import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryViewStore } from '@/lib/stores/library-view-store'

import ConnectionsPage from './page'

const state = vi.hoisted(() => ({
  available: true,
  connected: false,
  connectionStatus: 'disconnected' as 'connected' | 'reauth_required' | 'disconnected',
  pending: false,
  error: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

vi.mock('@/components/layout/PageFrame', () => ({
  PageFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/hooks/use-sharepoint', () => ({
  useSharePointStatus: () => ({
    data: state.pending || state.error ? undefined : {
      available: state.available,
      connected: state.connected,
      status: state.connectionStatus,
    },
    isPending: state.pending,
    isError: state.error,
    refetch: state.refetch,
  }),
  useConnectSharePoint: () => ({ mutate: state.connect, isPending: false, isError: false }),
  useDisconnectSharePoint: () => ({ mutate: state.disconnect, isPending: false }),
}))

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.available = true
    state.connected = false
    state.connectionStatus = 'disconnected'
    state.pending = false
    state.error = false
    useLibraryViewStore.setState({ connections: 'list', hasHydrated: true })
  })

  it('connects SharePoint from the list and switches to cards', () => {
    render(<ConnectionsPage />)
    expect(screen.getByRole('group', { name: 'common.viewMode' })).toBeInTheDocument()
    expect(document.querySelector('[data-view-mode="list"]')).toBeInTheDocument()
    expect(screen.getByText('sharepoint.notConnected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'sharepoint.connect' }))
    expect(state.connect).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'common.cardView' }))
    expect(document.querySelector('[data-view-mode="card"]')).toBeInTheDocument()
  })

  it('asks before disconnecting a connected account', () => {
    state.connected = true
    state.connectionStatus = 'connected'
    render(<ConnectionsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'sharepoint.disconnect' }))
    expect(state.disconnect).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/sharepoint.disconnectMicrosoft/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'sharepoint.disconnect' }))
    expect(state.disconnect).toHaveBeenCalledOnce()
  })

  it('reconnects when consent must be renewed', () => {
    state.connectionStatus = 'reauth_required'
    render(<ConnectionsPage />)
    expect(screen.getByText('sharepoint.needsReconnect')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'sharepoint.reconnect' }))
    expect(state.connect).toHaveBeenCalledOnce()
  })

  it('shows unavailable without a connect action', () => {
    state.available = false
    render(<ConnectionsPage />)
    expect(screen.getByText('sharepoint.unavailableStatus')).toBeInTheDocument()
    expect(screen.getByText('sharepoint.unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sharepoint.connect' })).not.toBeInTheDocument()
  })

  it('retries when the status request fails', () => {
    state.error = true
    render(<ConnectionsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(state.refetch).toHaveBeenCalledOnce()
  })
})
