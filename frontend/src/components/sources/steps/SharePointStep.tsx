'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useConnectSharePoint, useDisconnectSharePoint, useRetrySharePointBatch, useSharePointChildren, useSharePointDrives, useSharePointRecentBatches, useSharePointSites, useSharePointStatus, useSharePointBatch } from '@/lib/hooks/use-sharepoint'
import type { SharePointSelection } from '@/lib/types/api'

interface SharePointStepProps {
  selection: SharePointSelection | null
  onSelectionChange: (selection: SharePointSelection | null) => void
  onResumeBatch?: (batchId: string) => void
}

export function SharePointStep({ selection, onSelectionChange, onResumeBatch }: SharePointStepProps) {
  const { t } = useTranslation()
  const status = useSharePointStatus()
  const connect = useConnectSharePoint()
  const disconnect = useDisconnectSharePoint()
  const connection = status.data?.status ?? (status.data?.connected ? 'connected' : 'disconnected')
  const recent = useSharePointRecentBatches(connection === 'connected')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [site, setSite] = useState<{ id: string; name: string } | null>(null)
  const [drive, setDrive] = useState<{ id: string; name: string } | null>(null)
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([])
  const resumedBatch = useRef<string | null>(null)
  const connected = connection === 'connected'
  const folder = folders.at(-1)
  const sites = useSharePointSites(query, connected && !site)
  const drives = useSharePointDrives(site?.id ?? '', connected && !drive)
  const children = useSharePointChildren(drive?.id ?? '', folder?.id, connected)
  const active = drive ? children : site ? drives : sites
  const files = (children.data ?? []).filter(item => item.importable)
  const selectedIds = selection?.item_ids ?? []

  const beginConnection = () => connect.mutate(undefined, {
    onSuccess: ({ authorization_url }) => window.location.assign(authorization_url),
  })
  const clearSelection = () => onSelectionChange(null)
  const resumable = useMemo(
    () => (recent.data ?? []).filter(batch => batch.status === 'pending' || batch.status === 'running' || batch.status === 'partial'),
    [recent.data],
  )
  useEffect(() => {
    const active = resumable.find(batch => batch.status === 'pending' || batch.status === 'running')
    if (!active || resumedBatch.current === active.batch_id) return
    resumedBatch.current = active.batch_id
    onResumeBatch?.(active.batch_id)
  }, [onResumeBatch, resumable])

  const confirmDisconnect = () => {
    if (window.confirm(t('sharepoint.disconnectConfirm'))) disconnect.mutate()
  }

  if (status.isPending) return <p role="status">{t('common.loading')}</p>
  if (status.isError) return <div role="alert" className="space-y-3">
    <p>{t('sharepoint.requestFailed')}</p>
    <Button type="button" variant="outline" onClick={() => void status.refetch()}>{t('common.retry')}</Button>
  </div>
  if (!status.data.available) return <p role="status" className="text-sm text-muted-foreground">{t('sharepoint.unavailable')}</p>
  if (connection === 'reauth_required') return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{t('sharepoint.connectDescription')}</p>
    <Button type="button" disabled={connect.isPending} onClick={beginConnection}>{t('sharepoint.reconnect')}</Button>
    {connect.isError && <p role="alert">{t('sharepoint.requestFailed')}</p>}
  </div>
  if (!connected) return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{t('sharepoint.connectDescription')}</p>
    <Button type="button" disabled={connect.isPending} onClick={beginConnection}>{t('sharepoint.connect')}</Button>
    {connect.isError && <p role="alert">{t('sharepoint.requestFailed')}</p>}
  </div>

  return <div className="space-y-4">
    <div className="flex justify-end">
      <Button type="button" variant="outline" onClick={confirmDisconnect}>{t('sharepoint.disconnect')}</Button>
    </div>
    {resumable.length > 0 && <div className="space-y-2">
      <p className="text-sm font-medium">{t('sharepoint.recentImports')}</p>
      {resumable.map(batch => <Button key={batch.batch_id} type="button" variant="outline" onClick={() => onResumeBatch?.(batch.batch_id)}>{t('sharepoint.resume')}</Button>)}
    </div>}
    <nav aria-label={t('sharepoint.location')} className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="ghost" onClick={() => { setSite(null); setDrive(null); setFolders([]); clearSelection() }}>{t('sharepoint.sites')}</Button>
      {site && <Button type="button" variant="ghost" onClick={() => { setDrive(null); setFolders([]); clearSelection() }}>{site.name}</Button>}
      {drive && <Button type="button" variant="ghost" onClick={() => { setFolders([]); clearSelection() }}>{drive.name}</Button>}
      {folders.map((entry, index) => <Button key={entry.id} type="button" variant="ghost" aria-current={index === folders.length - 1 ? 'location' : undefined} onClick={() => { setFolders(folders.slice(0, index + 1)); clearSelection() }}>{entry.name}</Button>)}
    </nav>
    {!site && <div className="space-y-2">
      <Label htmlFor="sharepoint-search">{t('sharepoint.searchSites')}</Label>
      <div className="flex gap-2">
        <Input id="sharepoint-search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setQuery(search.trim()) } }} />
        <Button type="button" variant="outline" onClick={() => setQuery(search.trim())}>{t('common.search')}</Button>
      </div>
    </div>}
    {active.isPending && <p role="status">{t('common.loading')}</p>}
    {active.isError && <div role="alert" className="space-y-3">
      <p>{t('sharepoint.requestFailed')}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void active.refetch()}>{t('common.retry')}</Button>
        <Button type="button" variant="outline" disabled={connect.isPending} onClick={beginConnection}>{t('sharepoint.connect')}</Button>
      </div>
    </div>}
    {!active.isPending && !active.isError && active.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('sharepoint.empty')}</p>}
    {!site && sites.data?.map(entry => <Button className="w-full justify-start whitespace-normal text-start" key={entry.id} type="button" variant="outline" onClick={() => { setSite(entry); clearSelection() }}>{entry.name}</Button>)}
    {site && !drive && drives.data?.map(entry => <Button className="w-full justify-start whitespace-normal text-start" key={entry.id} type="button" variant="outline" onClick={() => { setDrive(entry); clearSelection() }}>{entry.name}</Button>)}
    {drive && !active.isError && <>
      {folder && <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={selection?.folder_id === folder.id} onChange={event => onSelectionChange(event.target.checked ? { drive_id: drive.id, item_ids: [], folder_id: folder.id } : null)} />
        {t('sharepoint.importFolder')}
      </label>}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" disabled={!files.length} checked={files.length > 0 && files.every(file => selectedIds.includes(file.id))} onChange={event => onSelectionChange(event.target.checked ? { drive_id: drive.id, item_ids: files.map(file => file.id) } : null)} />
        {t('sharepoint.selectAll')}
      </label>
      <ul className="divide-y rounded-md border">
        {children.data?.map(item => <li key={item.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
          {item.browsable ? <Button type="button" variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-start" onClick={() => { setFolders([...folders, item]); clearSelection() }}><Folder aria-hidden="true" className="h-4 w-4 shrink-0" />{item.name}</Button> : <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-sm">
            <input type="checkbox" aria-label={item.name} disabled={!item.importable || !!selection?.folder_id} checked={selectedIds.includes(item.id)} onChange={event => onSelectionChange({ drive_id: drive.id, item_ids: event.target.checked ? [...selectedIds, item.id] : selectedIds.filter(id => id !== item.id) })} />
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="break-all">{item.name}</span>
            {!item.importable && <span className="text-xs text-muted-foreground">{t('sharepoint.unsupported')}</span>}
          </label>}
        </li>)}
      </ul>
      <p role="status" className="text-sm text-muted-foreground">{selection?.folder_id ? t('sharepoint.folderHint') : t('sharepoint.selected', { count: selectedIds.length })}</p>
    </>}
  </div>
}

export function SharePointBatchProgress({ batch, notebookIds = [] }: { batch: ReturnType<typeof useSharePointBatch>; notebookIds?: string[] }) {
  const { t } = useTranslation()
  const retry = useRetrySharePointBatch(notebookIds)
  const labels = {
    pending: t('sharepoint.pending'), running: t('common.processing'), completed: t('common.completed'),
    partial: t('sharepoint.partial'), failed: t('common.failed'), queued: t('sharepoint.queued'), skipped: t('sharepoint.skipped'),
  }
  return <div className="space-y-4">
    {batch.isPending && <p role="status">{t('common.loading')}</p>}
    {batch.isError && <div role="alert"><p>{t('sharepoint.requestFailed')}</p><Button type="button" variant="outline" onClick={() => void batch.refetch()}>{t('common.retry')}</Button></div>}
    {batch.data && <>
      <div role="status" className="space-y-2">
        <p className="font-medium">{labels[batch.data.status]}</p>
        <p className="text-sm text-muted-foreground">{t('sharepoint.progress', { completed: batch.data.completed, failed: batch.data.failed, total: batch.data.total })}</p>
        {/import limit/i.test(batch.data.error ?? '') && <p>{t('sharepoint.limitReached')} {batch.data.error}</p>}
      </div>
      {batch.data.error && !/import limit/i.test(batch.data.error) && <p role="alert" className="text-sm text-destructive">{batch.data.error}</p>}
      {(batch.data.status === 'partial' || batch.data.status === 'failed') && batch.data.failed > 0 && (
        <Button type="button" disabled={retry.isPending} onClick={() => retry.mutate(batch.data!.batch_id)}>{t('sharepoint.retryFailed')}</Button>
      )}
      <p className="text-sm text-muted-foreground">{t('sharepoint.processingHint')}</p>
      <ul className="divide-y rounded-md border">
        {batch.data.documents.map(document => <li key={document.id} className="space-y-1 p-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="break-all">{document.name}</span><span>{labels[document.status]}</span></div>
          {document.error && <p className="text-sm text-destructive">{document.error}</p>}
        </li>)}
      </ul>
    </>}
  </div>
}
