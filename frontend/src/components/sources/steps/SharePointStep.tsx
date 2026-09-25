'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, FileText, Folder, Loader2, XCircle } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useRetrySharePointBatch, useSharePointChildren, useSharePointDrives, useSharePointRecentBatches, useSharePointSites, useSharePointStatus, useSharePointBatch } from '@/lib/hooks/use-sharepoint'
import type { SharePointSelection } from '@/lib/types/api'

interface SharePointStepProps {
  selection: SharePointSelection | null
  onSelectionChange: (selection: SharePointSelection | null) => void
  onResumeBatch?: (batchId: string) => void
}

export function SharePointStep({ selection, onSelectionChange, onResumeBatch }: SharePointStepProps) {
  const { t } = useTranslation()
  const status = useSharePointStatus()
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

  const crumbs = [
    { key: 'sites', label: t('sharepoint.sites'), onClick: () => { setSite(null); setDrive(null); setFolders([]); clearSelection() } },
    ...(site ? [{ key: site.id, label: site.name, onClick: () => { setDrive(null); setFolders([]); clearSelection() } }] : []),
    ...(drive ? [{ key: drive.id, label: drive.name, onClick: () => { setFolders([]); clearSelection() } }] : []),
    ...folders.map((entry, index) => ({ key: entry.id, label: entry.name, onClick: () => { setFolders(folders.slice(0, index + 1)); clearSelection() } })),
  ]
  const toggleFile = (itemId: string, checked: boolean) => {
    if (!drive) return
    onSelectionChange({
      drive_id: drive.id,
      item_ids: checked ? [...selectedIds, itemId] : selectedIds.filter(id => id !== itemId),
    })
  }

  if (status.isPending) return <p role="status">{t('common.loading')}</p>
  if (status.isError) return <div role="alert" className="space-y-3">
    <p>{t('sharepoint.requestFailed')}</p>
    <Button type="button" variant="outline" onClick={() => void status.refetch()}>{t('common.retry')}</Button>
  </div>
  if (!status.data.available) return <p role="status" className="text-sm text-muted-foreground">{t('sharepoint.unavailable')}</p>
  if (!connected) return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{t('sharepoint.connectDescription')}</p>
    <Button type="button" variant="outline" asChild>
      <Link href="/connections">{t('sharepoint.manageConnection')}</Link>
    </Button>
  </div>

  return <div className="space-y-4">
    {resumable.length > 0 && <div className="space-y-2">
      <p className="text-sm font-medium">{t('sharepoint.recentImports')}</p>
      {resumable.map(batch => <Button key={batch.batch_id} type="button" variant="outline" onClick={() => onResumeBatch?.(batch.batch_id)}>{t('sharepoint.resume')}</Button>)}
    </div>}
    <nav aria-label={t('sharepoint.location')}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1
          return <li key={crumb.key} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {current
              ? <span aria-current="location" className="truncate font-medium">{crumb.label}</span>
              : <button type="button" className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={crumb.onClick}>{crumb.label}</button>}
          </li>
        })}
      </ol>
    </nav>
    {!site && <div className="space-y-2">
      <Label htmlFor="sharepoint-search">{t('sharepoint.searchSites')}</Label>
      <div className="flex gap-2">
        <Input id="sharepoint-search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setQuery(search.trim()) } }} />
        <Button type="button" variant="outline" onClick={() => setQuery(search.trim())}>{t('common.search')}</Button>
      </div>
    </div>}
    {active.isPending && !drive && <div role="status" aria-label={t('common.loading')} className="flex min-h-40 items-center justify-center"><LoadingSpinner /></div>}
    {active.isError && <div role="alert" className="space-y-3">
      <p>{t('sharepoint.requestFailed')}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void active.refetch()}>{t('common.retry')}</Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/connections">{t('sharepoint.manageConnection')}</Link>
        </Button>
      </div>
    </div>}
    {!active.isPending && !active.isError && active.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('sharepoint.empty')}</p>}
    {!site && sites.data?.map(entry => <Button className="w-full justify-start whitespace-normal text-start" key={entry.id} type="button" variant="outline" onClick={() => { setSite(entry); clearSelection() }}>{entry.name}</Button>)}
    {site && !drive && drives.data?.map(entry => <Button className="w-full justify-start whitespace-normal text-start" key={entry.id} type="button" variant="outline" onClick={() => { setDrive(entry); clearSelection() }}>{entry.name}</Button>)}
    {drive && !active.isError && <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        {folder && <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={selection?.folder_id === folder.id} onChange={event => onSelectionChange(event.target.checked ? { drive_id: drive.id, item_ids: [], folder_id: folder.id } : null)} />
          {t('sharepoint.importFolder')}
        </label>}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" disabled={!files.length} checked={files.length > 0 && files.every(file => selectedIds.includes(file.id))} onChange={event => onSelectionChange(event.target.checked ? { drive_id: drive.id, item_ids: files.map(file => file.id) } : null)} />
          {t('sharepoint.selectAll')}
        </label>
      </div>
      {active.isPending ? (
        <div role="status" aria-label={t('common.loading')} className="flex min-h-48 items-center justify-center rounded-md border"><LoadingSpinner /></div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border">
          {children.data?.map(item => <li key={item.id}>
            {item.browsable ? <button type="button" className="flex min-h-11 w-full items-center gap-3 px-3 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => { setFolders([...folders, item]); clearSelection() }}><Folder aria-hidden="true" className="h-4 w-4 shrink-0" />{item.name}</button> : <label className={`flex min-h-11 w-full items-center gap-3 px-3 text-sm ${item.importable && !selection?.folder_id ? 'cursor-pointer hover:bg-muted' : ''} ${selectedIds.includes(item.id) ? 'bg-accent' : ''}`}>
              <input type="checkbox" className="size-4 shrink-0" aria-label={item.name} disabled={!item.importable || !!selection?.folder_id} checked={selectedIds.includes(item.id)} onChange={event => toggleFile(item.id, event.target.checked)} />
              <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 break-all">{item.name}</span>
              {!item.importable && <span className="text-xs text-muted-foreground">{t('sharepoint.unsupported')}</span>}
            </label>}
          </li>)}
        </ul>
      )}
      <p role="status" className="text-sm text-muted-foreground">{selection?.folder_id ? t('sharepoint.folderHint') : t('sharepoint.selected', { count: selectedIds.length })}</p>
    </>}
  </div>
}

const batchStatusTone = {
  pending: { icon: Clock3, className: 'border-info/40 bg-info-surface text-info', iconClass: 'text-info', spin: false },
  running: { icon: Loader2, className: 'border-info/40 bg-info-surface text-info', iconClass: 'text-info', spin: true },
  queued: { icon: Clock3, className: 'border-info/40 bg-info-surface text-info', iconClass: 'text-info', spin: false },
  completed: { icon: CheckCircle2, className: 'border-success/40 bg-success-surface text-success', iconClass: 'text-success', spin: false },
  partial: { icon: AlertTriangle, className: 'border-warning/40 bg-warning-surface text-warning', iconClass: 'text-warning', spin: false },
  failed: { icon: XCircle, className: 'border-error/40 bg-error-surface text-error', iconClass: 'text-error', spin: false },
  skipped: { icon: AlertTriangle, className: 'border-warning/40 bg-warning-surface text-warning', iconClass: 'text-warning', spin: false },
} as const

export function SharePointBatchProgress({ batch, notebookIds = [] }: { batch: ReturnType<typeof useSharePointBatch>; notebookIds?: string[] }) {
  const { t } = useTranslation()
  const retry = useRetrySharePointBatch(notebookIds)
  const labels = {
    pending: t('sharepoint.pending'), running: t('common.processing'), completed: t('common.completed'),
    partial: t('sharepoint.partial'), failed: t('common.failed'), queued: t('sharepoint.queued'), skipped: t('sharepoint.skipped'),
  }
  const data = batch.data
  const settled = data ? data.completed + data.failed : 0
  const progress = data && data.total > 0 ? Math.round((settled / data.total) * 100) : 0
  const tone = data ? batchStatusTone[data.status] : batchStatusTone.pending
  const StatusIcon = tone.icon
  return <div className="space-y-4">
    {batch.isPending && <p role="status">{t('common.loading')}</p>}
    {batch.isError && <div role="alert"><p>{t('sharepoint.requestFailed')}</p><Button type="button" variant="outline" onClick={() => void batch.refetch()}>{t('common.retry')}</Button></div>}
    {data && <>
      <div role="status" className="space-y-4 rounded-md border bg-card p-4">
        <div className="flex items-center gap-3">
          <StatusIcon aria-hidden="true" className={`h-5 w-5 shrink-0 ${tone.iconClass} ${tone.spin ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          <div className="min-w-0">
            <p className="font-medium">{labels[data.status]}</p>
            <p className="text-sm text-muted-foreground">{t('sharepoint.progress', { completed: data.completed, failed: data.failed, total: data.total })}</p>
          </div>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('sharepoint.progress', { completed: data.completed, failed: data.failed, total: data.total })}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-2 rounded-full bg-primary transition-all duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 text-success">
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
              {data.completed} {t('common.completed')}
            </span>
            {data.failed > 0 && (
              <span className="flex items-center gap-1.5 text-error">
                <XCircle aria-hidden="true" className="h-4 w-4" />
                {data.failed} {t('common.failed')}
              </span>
            )}
          </div>
          <span className="tabular-nums text-muted-foreground">{settled} / {data.total}</span>
        </div>
        {/import limit/i.test(data.error ?? '') && <p>{t('sharepoint.limitReached')} {data.error}</p>}
        {data.error && !/import limit/i.test(data.error) && <p role="alert" className="text-sm text-error">{data.error}</p>}
        {(data.status === 'partial' || data.status === 'failed') && data.failed > 0 && (
          <Button type="button" disabled={retry.isPending} onClick={() => retry.mutate(data.batch_id)}>{t('sharepoint.retryFailed')}</Button>
        )}
        <p className="text-sm text-muted-foreground">{t('sharepoint.processingHint')}</p>
        <ul className="space-y-2">
          {data.documents.map(document => {
            const documentTone = batchStatusTone[document.status]
            const DocumentIcon = documentTone.icon
            return <li key={document.id} className="space-y-1 rounded-md border px-3 py-2">
              <div className="flex min-h-11 items-center gap-3">
                <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-all text-sm">{document.name}</span>
                <Badge variant="outline" className={documentTone.className}>
                  <DocumentIcon className={documentTone.spin ? 'animate-spin motion-reduce:animate-none' : undefined} />
                  {labels[document.status]}
                </Badge>
              </div>
              {document.error && <p className="text-sm text-error">{document.error}</p>}
            </li>
          })}
        </ul>
      </div>
    </>}
  </div>
}
