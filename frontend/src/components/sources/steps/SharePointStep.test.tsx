import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SharePointStep } from './SharePointStep'

const state = vi.hoisted(() => ({
  connected: true,
  available: true,
  statusError: false,
  browseError: false,
  connect: vi.fn(),
  change: vi.fn(),
}))

vi.mock('@/lib/hooks/use-sharepoint', () => ({
  useSharePointStatus: () => ({
    data: { available: state.available, connected: state.connected },
    isPending: false,
    isError: state.statusError,
    refetch: vi.fn(),
  }),
  useConnectSharePoint: () => ({ mutate: state.connect, isPending: false, isError: false }),
  useSharePointSites: () => ({
    data: [{ id: 'site:one', name: 'Research', web_url: null }],
    isPending: false,
    isError: state.browseError,
    refetch: vi.fn(),
  }),
  useSharePointDrives: () => ({
    data: [{ id: 'drive:one', name: 'Documents', kind: 'documentLibrary' }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSharePointChildren: (_driveId: string, folderId?: string) => ({
    data: folderId
      ? [{ id: 'nested', name: 'nested.pdf', kind: 'file', browsable: false, importable: true }]
      : [
        { id: 'file:one', name: 'report.pdf', kind: 'file', browsable: false, importable: true },
        { id: 'unsupported', name: 'archive.zip', kind: 'file', browsable: false, importable: false },
        { id: 'folder:one', name: 'Reports', kind: 'folder', browsable: true, importable: false },
      ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.connected = true
  state.available = true
  state.statusError = false
  state.browseError = false
})

describe('SharePointStep', () => {
  it('keeps unavailable, disconnected, and request-failed states distinct', () => {
    state.available = false
    const view = render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByText('sharepoint.unavailable')).toBeInTheDocument()

    state.available = true
    state.connected = false
    view.rerender(<SharePointStep selection={null} onSelectionChange={state.change} />)
    fireEvent.click(screen.getByRole('button', { name: 'sharepoint.connect' }))
    expect(state.connect).toHaveBeenCalledOnce()

    state.statusError = true
    view.rerender(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByRole('alert')).toHaveTextContent('sharepoint.requestFailed')
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument()
  })

  it('supports browsing, selecting supported files, and importing a nested folder', () => {
    render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByRole('checkbox', { name: 'archive.zip' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'report.pdf' }))
    expect(state.change).toHaveBeenLastCalledWith({ drive_id: 'drive:one', item_ids: ['file:one'] })

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }))
    expect(state.change).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('checkbox', { name: 'sharepoint.importFolder' }))
    expect(state.change).toHaveBeenLastCalledWith({ drive_id: 'drive:one', item_ids: [], folder_id: 'folder:one' })
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByRole('checkbox', { name: 'report.pdf' })).toBeInTheDocument()
  })

  it('shows a retry action on browse failure', () => {
    state.browseError = true
    render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByRole('alert')).toHaveTextContent('sharepoint.requestFailed')
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument()
  })
})
