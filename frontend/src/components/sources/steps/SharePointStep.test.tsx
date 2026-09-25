import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SharePointBatchProgress, SharePointStep } from './SharePointStep'

const state = vi.hoisted(() => ({
  connected: true,
  available: true,
  connectionStatus: undefined as 'connected' | 'reauth_required' | 'disconnected' | undefined,
  statusError: false,
  browseError: false,
  recent: [] as { batch_id: string; status: string }[],
  childrenPending: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  retry: vi.fn(),
  resume: vi.fn(),
  change: vi.fn(),
}))

vi.mock('@/lib/hooks/use-sharepoint', () => ({
  useSharePointStatus: () => ({
    data: { available: state.available, connected: state.connected, status: state.connectionStatus },
    isPending: false,
    isError: state.statusError,
    refetch: vi.fn(),
  }),
  useConnectSharePoint: () => ({ mutate: state.connect, isPending: false, isError: false }),
  useDisconnectSharePoint: () => ({ mutate: state.disconnect, isPending: false }),
  useSharePointRecentBatches: () => ({ data: state.recent, isPending: false }),
  useRetrySharePointBatch: () => ({ mutate: state.retry, isPending: false }),
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
    isPending: state.childrenPending,
    isError: false,
    refetch: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.connected = true
  state.available = true
  state.connectionStatus = undefined
  state.statusError = false
  state.browseError = false
  state.recent = []
  state.childrenPending = false
})

describe('SharePointStep', () => {
  it('keeps unavailable, disconnected, and request-failed states distinct', () => {
    state.available = false
    const view = render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByText('sharepoint.unavailable')).toBeInTheDocument()

    state.available = true
    state.connected = false
    view.rerender(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByRole('link', { name: 'sharepoint.manageConnection' })).toHaveAttribute('href', '/connections')
    expect(state.connect).not.toHaveBeenCalled()

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
    fireEvent.click(screen.getByText('report.pdf'))
    expect(state.change).toHaveBeenLastCalledWith({ drive_id: 'drive:one', item_ids: ['file:one'] })

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }))
    expect(state.change).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('checkbox', { name: 'sharepoint.importFolder' }))
    expect(state.change).toHaveBeenLastCalledWith({ drive_id: 'drive:one', item_ids: [], folder_id: 'folder:one' })
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByRole('checkbox', { name: 'report.pdf' })).toBeInTheDocument()
  })

  it('centers a loader in the file list while a folder is loading', () => {
    state.childrenPending = true
    render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
  })

  it('links to Connections when consent must be renewed', () => {
    state.connected = false
    state.connectionStatus = 'reauth_required'
    render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByRole('link', { name: 'sharepoint.manageConnection' })).toHaveAttribute('href', '/connections')
    expect(screen.queryByRole('button', { name: 'sharepoint.connect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'sharepoint.disconnect' })).not.toBeInTheDocument()
  })

  it('resumes an in-progress batch from the owner list and leaves a partial batch for the user', () => {
    state.recent = [{ batch_id: 'connector_batch:active', status: 'running' }]
    const view = render(<SharePointStep selection={null} onSelectionChange={state.change} onResumeBatch={state.resume} />)
    expect(state.resume).toHaveBeenCalledWith('connector_batch:active')

    state.recent = [{ batch_id: 'connector_batch:partial', status: 'partial' }]
    state.resume.mockClear()
    view.rerender(<SharePointStep selection={null} onSelectionChange={state.change} onResumeBatch={state.resume} />)
    expect(state.resume).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'sharepoint.resume' }))
    expect(state.resume).toHaveBeenCalledWith('connector_batch:partial')
  })

  it('shows a retry action on browse failure', () => {
    state.browseError = true
    render(<SharePointStep selection={null} onSelectionChange={state.change} />)
    expect(screen.getByRole('alert')).toHaveTextContent('sharepoint.requestFailed')
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'sharepoint.manageConnection' })).toHaveAttribute('href', '/connections')
  })
})

describe('SharePointBatchProgress', () => {
  it('retries failed items and shows the folder limit in the status', () => {
    render(<SharePointBatchProgress notebookIds={['notebook:one']} batch={{
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        batch_id: 'connector_batch:one',
        status: 'failed',
        total: 1001,
        completed: 0,
        failed: 1,
        error: 'SharePoint folder exceeds the 1,000-item import limit. Choose a smaller folder.',
        documents: [],
      },
    } as never} />)
    expect(screen.getByRole('status')).toHaveTextContent('sharepoint.limitReached')
    expect(screen.getByRole('status')).toHaveTextContent('1,000')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    fireEvent.click(screen.getByRole('button', { name: 'sharepoint.retryFailed' }))
    expect(state.retry).toHaveBeenCalledWith('connector_batch:one')
  })
})
