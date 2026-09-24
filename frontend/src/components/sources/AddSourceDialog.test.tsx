import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import apiClient from '@/lib/api/client'

import { AddSourceDialog } from './AddSourceDialog'

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({ data: [
    { id: 'notebook:one', name: 'Research', description: '' },
    { id: 'notebook:two', name: 'Team', description: '' },
    { id: 'notebook:viewer', name: 'Read only', description: '', access_role: 'viewer' },
  ], isLoading: false }),
}))

vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ data: [], isLoading: false }),
}))

const ordinaryUpload = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/use-sources', () => ({
  useCreateSource: () => ({ mutateAsync: ordinaryUpload, isPending: false }),
}))
vi.mock('@/lib/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const endpoint = '/connectors/sharepoint'
let connection = { available: true, connected: true }
let batchState: 'running' | 'partial' = 'partial'
let recentBatches: { batch_id: string; status: string; total: number; completed: number; failed: number; error: string | null }[] = []

function renderDialog(defaultNotebookId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(<QueryClientProvider client={client}><AddSourceDialog open onOpenChange={vi.fn()} defaultNotebookId={defaultNotebookId} /></QueryClientProvider>)
  return { client, invalidate }
}

async function browse() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'sharepoint.title' }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole('button', { name: 'Research site' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Documents' }))
  await screen.findByRole('checkbox', { name: 'report.pdf' })
}

beforeEach(() => {
  vi.clearAllMocks()
  connection = { available: true, connected: true }
  batchState = 'partial'
  recentBatches = []
  vi.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === `${endpoint}/status`) return { data: connection }
    if (url === `${endpoint}/batches`) return { data: recentBatches }
    if (url === `${endpoint}/sites`) return { data: [{ id: 'site:one', name: 'Research site', web_url: null }] }
    if (url === `${endpoint}/sites/site%3Aone/drives`) return { data: [{ id: 'drive:one', name: 'Documents', kind: 'documentLibrary' }] }
    if (url === `${endpoint}/drives/drive%3Aone/children`) return { data: [
      { id: 'file:one', name: 'report.pdf', kind: 'file', browsable: false, importable: true },
      { id: 'file:two', name: 'notes.docx', kind: 'file', browsable: false, importable: true },
      { id: 'unsupported', name: 'archive.zip', kind: 'file', browsable: false, importable: false },
      { id: 'folder:one', name: 'Reports folder', kind: 'folder', browsable: true, importable: false },
    ] }
    if (url === `${endpoint}/batches/connector_batch%3Aone`) return { data: {
      batch_id: 'connector_batch:one', status: batchState, total: 2, completed: 1, failed: 1, error: null,
      documents: [
        { id: 'document:one', item_id: 'file:one', name: 'report.pdf', source_id: 'source:one', command_id: 'command:one', status: 'queued', error: null },
        { id: 'document:two', item_id: 'file:two', name: 'notes.docx', source_id: null, command_id: null, status: 'failed', error: 'This document could not be imported.' },
      ],
    } }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.mocked(apiClient.post).mockResolvedValue({ data: { batch_id: 'connector_batch:one' } })
})

vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: () => ({ data: undefined }),
}))

// SourceTypeStep (rendered inside AddSourceDialog) now consults useCapabilities
// via TanStack Query -- stub the hook so this test doesn't need a
// QueryClientProvider wrapper.
vi.mock('@/lib/hooks/use-capabilities', () => ({
  useCapabilities: () => ({ data: undefined, isLoading: false, isError: false }),
}))

describe('AddSourceDialog', () => {
  it('uses a compact full-height sheet layout with the actions pinned to the bottom', () => {
    renderDialog()

    const sheet = screen.getByRole('dialog', { name: 'sources.addNew' })
    expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    const header = sheet.querySelector('[data-slot="sheet-header"]')
    const footer = sheet.querySelector('[data-slot="sheet-footer"]')
    const form = sheet.querySelector('form')

    expect(screen.queryByRole('button', { name: 'common.done' })).not.toBeInTheDocument()
    expect(sheet).toHaveClass('flex', 'flex-col', 'overflow-hidden')
    expect(sheet).not.toHaveClass('overflow-y-auto')
    expect(header).toHaveClass('py-2.5')
    expect(header).not.toHaveClass('pr-14')
    expect(header).not.toHaveClass('pt-6')
    expect(form).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col')
    expect(footer).toHaveClass('py-2')
    expect(footer).not.toHaveClass('bg-muted')
  })

  it('reopens an in-progress import after refresh from the owner batch list', async () => {
    batchState = 'running'
    recentBatches = [{ batch_id: 'connector_batch:one', status: 'running', total: 2, completed: 0, failed: 0, error: null }]
    renderDialog()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'sharepoint.title' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('common.processing')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith(`${endpoint}/batches`, { params: { limit: 20 } })
  })

  it('displays unavailable connector status and prevents advancing without a selection', async () => {
    connection = { available: false, connected: false }
    renderDialog()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'sharepoint.title' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('sharepoint.unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()
    expect(ordinaryUpload).not.toHaveBeenCalled()
  })

  it('clears a hidden SharePoint selection when switching source types', async () => {
    renderDialog()
    await browse()
    fireEvent.click(screen.getByRole('checkbox', { name: 'report.pdf' }))
    expect(screen.getByRole('button', { name: 'common.next' })).toBeEnabled()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'sources.addUrl' }), { button: 0, ctrlKey: false })
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'sharepoint.title' }), { button: 0, ctrlKey: false })
    expect(screen.getByRole('button', { name: 'common.next' })).toBeDisabled()
  })

  it('does not offer or submit a read-only default notebook for SharePoint imports', async () => {
    renderDialog('notebook:viewer')
    await browse()
    fireEvent.click(screen.getByRole('checkbox', { name: 'report.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    expect(screen.queryByRole('checkbox', { name: 'Read only' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(`${endpoint}/import`, expect.objectContaining({ notebook_ids: [] })))
  })

  it('keeps monitoring a running batch after the progress sheet closes', async () => {
    batchState = 'running'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    function Shell() {
      const [open, setOpen] = useState(true)
      return <QueryClientProvider client={client}>
        <button type="button" onClick={() => setOpen(true)}>Reopen</button>
        <AddSourceDialog open={open} onOpenChange={setOpen} defaultNotebookId="notebook:one" />
      </QueryClientProvider>
    }
    render(<Shell />)
    await browse()
    fireEvent.click(screen.getByRole('checkbox', { name: 'report.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
    expect(await screen.findByText('common.processing')).toBeInTheDocument()
    const close = screen.getByRole('dialog').querySelector('[data-slot="sheet-footer"] button')
    expect(close).not.toBeNull()
    fireEvent.click(close!)
    expect(screen.queryByText('common.processing')).not.toBeInTheDocument()
    batchState = 'partial'
    await client.invalidateQueries({ queryKey: ['sharepoint', 'batch', 'connector_batch:one'] })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sources'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notebooks', 'notebook:one'] })
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(await screen.findByText('sharepoint.partial')).toBeInTheDocument()
  })

  it.each(['single', 'multiple', 'folder'])('imports %s selection through the connector with selected notebooks and shows partial results', async (mode) => {
    const { invalidate } = renderDialog('notebook:one')
    await browse()
    expect(screen.getByRole('checkbox', { name: 'archive.zip' })).toBeDisabled()
    if (mode === 'single') fireEvent.click(screen.getByRole('checkbox', { name: 'report.pdf' }))
    if (mode === 'multiple') fireEvent.click(screen.getByRole('checkbox', { name: 'sharepoint.selectAll' }))
    if (mode === 'folder') {
      fireEvent.click(screen.getByRole('button', { name: 'Reports folder' }))
      fireEvent.click(await screen.findByRole('checkbox', { name: 'sharepoint.importFolder' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Team' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(`${endpoint}/import`, {
      drive_id: 'drive:one',
      ...(mode === 'folder' ? { folder_id: 'folder:one', item_ids: [] } : { item_ids: mode === 'single' ? ['file:one'] : ['file:one', 'file:two'] }),
      notebook_ids: ['notebook:one', 'notebook:two'], transformations: [], embed: false,
    }))
    expect(ordinaryUpload).not.toHaveBeenCalled()
    expect(await screen.findByText('sharepoint.partial')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('sharepoint.queued')).toBeInTheDocument()
    expect(screen.getByText('This document could not be imported.')).toBeInTheDocument()
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sources'] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notebooks', 'notebook:one'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notebooks', 'notebook:two'] })
  })
})
