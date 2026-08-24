'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, Clock,
  RefreshCw, Check, CalendarClock, ShieldCheck,
} from 'lucide-react'
import { embeddingApi } from '@/lib/api/embedding'
import type { RebuildEmbeddingsRequest, RebuildStatusResponse } from '@/lib/api/embedding'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

export function RebuildEmbeddings() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'existing' | 'all'>('existing')
  const [includeSources, setIncludeSources] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeInsights, setIncludeInsights] = useState(true)
  const [commandId, setCommandId] = useState<string | null>(null)
  const [status, setStatus] = useState<RebuildStatusResponse | null>(null)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  const rebuildMutation = useMutation({
    mutationFn: async (request: RebuildEmbeddingsRequest) => embeddingApi.rebuildEmbeddings(request),
    onSuccess: (data) => {
      setCommandId(data.command_id)
      startPolling(data.command_id)
    },
  })

  const startPolling = (cmdId: string) => {
    if (pollingInterval) clearInterval(pollingInterval)
    const interval = setInterval(async () => {
      try {
        const statusData = await embeddingApi.getRebuildStatus(cmdId)
        setStatus(statusData)
        if (statusData.status === 'completed' || statusData.status === 'failed') stopPolling()
      } catch (error) {
        console.error('Failed to fetch rebuild status:', error)
      }
    }, 5000)
    setPollingInterval(interval)
  }

  const stopPolling = useCallback(() => {
    if (pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
  }, [pollingInterval])

  useEffect(() => () => stopPolling(), [stopPolling])

  const handleStartRebuild = () => {
    rebuildMutation.mutate({
      mode,
      include_sources: includeSources,
      include_notes: includeNotes,
      include_insights: includeInsights,
    })
  }

  const handleReset = () => {
    stopPolling()
    setCommandId(null)
    setStatus(null)
    rebuildMutation.reset()
  }

  const isAnyTypeSelected = includeSources || includeNotes || includeInsights
  const isRebuildActive = commandId && status && (status.status === 'queued' || status.status === 'running')

  const progressData = status?.progress
  const stats = status?.stats
  const totalItems = progressData?.total_items ?? progressData?.total ?? 0
  const processedItems = progressData?.processed_items ?? progressData?.processed ?? 0
  const derivedProgressPercent = progressData?.percentage ?? (totalItems > 0 ? (processedItems / totalItems) * 100 : 0)
  const progressPercent = Number.isFinite(derivedProgressPercent) ? derivedProgressPercent : 0
  const sourcesProcessed = stats?.sources_processed ?? stats?.sources ?? 0
  const notesProcessed = stats?.notes_processed ?? stats?.notes ?? 0
  const insightsProcessed = stats?.insights_processed ?? stats?.insights ?? 0
  const failedItems = stats?.failed_items ?? stats?.failed ?? 0
  const computedDuration = status?.started_at && status?.completed_at
    ? (new Date(status.completed_at).getTime() - new Date(status.started_at).getTime()) / 1000
    : undefined
  const processingTimeSeconds = stats?.processing_time ?? computedDuration

  const chip = (active: boolean, onToggle: () => void, label: string) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onToggle}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-border text-muted-foreground hover:text-foreground'
      )}
    >
      {active && <Check className="size-3.5" />}
      {label}
    </button>
  )

  const faqItem = (Icon: typeof Clock, question: string, answer: string) => (
    <div className="flex gap-3 border-t border-border/40 py-3 first:border-t-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{question}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{answer}</p>
      </div>
    </div>
  )

  return (
    <section>
      <div className="overflow-hidden rounded-lg border border-border/60">
        <div className="border-b border-border/40 px-4 py-3.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <RefreshCw className="size-4 text-muted-foreground" />
            {t('advanced.rebuildEmbeddings')}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{t('advanced.rebuildEmbeddingsDesc')}</p>
        </div>

        <div className="space-y-5 px-4 py-4">
          {!isRebuildActive && (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="mode" className="text-sm font-medium">{t('advanced.rebuild.mode')}</Label>
                  <Select value={mode} onValueChange={(value) => setMode(value as 'existing' | 'all')}>
                    <SelectTrigger id="mode" className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing">{t('advanced.rebuild.existing')}</SelectItem>
                      <SelectItem value="all">{t('advanced.rebuild.all')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {mode === 'existing' ? t('advanced.rebuild.existingDesc') : t('advanced.rebuild.allDesc')}
                </p>
              </div>

              <div className="space-y-2.5" role="group" aria-labelledby="include-label">
                <span id="include-label" className="text-sm font-medium">{t('advanced.rebuild.include')}</span>
                <div className="flex flex-wrap gap-2">
                  {chip(includeSources, () => setIncludeSources((v) => !v), t('navigation.sources'))}
                  {chip(includeNotes, () => setIncludeNotes((v) => !v), t('common.notes'))}
                  {chip(includeInsights, () => setIncludeInsights((v) => !v), t('common.insights'))}
                </div>
                {!isAnyTypeSelected && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{t('advanced.rebuild.selectOneError')}</AlertDescription>
                  </Alert>
                )}
              </div>

              <Button onClick={handleStartRebuild} disabled={!isAnyTypeSelected || rebuildMutation.isPending} className="w-full">
                {rebuildMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />{t('advanced.rebuild.starting')}</>
                ) : (
                  <><RefreshCw className="h-4 w-4" />{t('advanced.rebuild.startBtn')}</>
                )}
              </Button>

              {rebuildMutation.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {t('advanced.rebuild.failed')}: {(rebuildMutation.error as Error)?.message || t('common.error')}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {status && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {status.status === 'queued' && <Clock className="h-5 w-5 text-yellow-500" />}
                  {status.status === 'running' && <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />}
                  {status.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                  {status.status === 'failed' && <XCircle className="h-5 w-5 text-red-500" />}
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {status.status === 'queued' && t('advanced.rebuild.queued')}
                      {status.status === 'running' && t('advanced.rebuild.running')}
                      {status.status === 'completed' && t('advanced.rebuild.completed')}
                      {status.status === 'failed' && t('advanced.rebuild.failed')}
                    </span>
                    {status.status === 'running' && (
                      <span className="text-sm text-muted-foreground">{t('advanced.rebuild.leavePageHint')}</span>
                    )}
                  </div>
                </div>
                {(status.status === 'completed' || status.status === 'failed') && (
                  <Button variant="outline" size="sm" onClick={handleReset}>{t('advanced.rebuild.startNew')}</Button>
                )}
              </div>

              {progressData && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{t('common.progress')}</span>
                    <span className="font-medium">
                      {t('advanced.rebuild.itemsProcessed', { processed: processedItems.toString(), total: totalItems.toString(), percent: progressPercent.toFixed(1) })}
                    </span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                  {failedItems > 0 && (
                    <p className="text-sm text-yellow-600">{t('advanced.rebuild.failedItems', { count: failedItems })}</p>
                  )}
                </div>
              )}

              {stats && (
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-1"><p className="text-sm text-muted-foreground">{t('navigation.sources')}</p><p className="text-2xl font-bold">{sourcesProcessed}</p></div>
                  <div className="space-y-1"><p className="text-sm text-muted-foreground">{t('common.notes')}</p><p className="text-2xl font-bold">{notesProcessed}</p></div>
                  <div className="space-y-1"><p className="text-sm text-muted-foreground">{t('common.insights')}</p><p className="text-2xl font-bold">{insightsProcessed}</p></div>
                  <div className="space-y-1"><p className="text-sm text-muted-foreground">{t('advanced.rebuild.time')}</p><p className="text-2xl font-bold">{processingTimeSeconds !== undefined ? `${processingTimeSeconds.toFixed(1)}s` : '—'}</p></div>
                </div>
              )}

              {status.error_message && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{status.error_message}</AlertDescription>
                </Alert>
              )}

              {status.started_at && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>{t('common.created', { time: new Date(status.started_at).toLocaleString() })}</p>
                  {status.completed_at && <p>{t('notebooks.updated')}: {new Date(status.completed_at).toLocaleString()}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/60 px-4 py-1.5">
        {faqItem(CalendarClock, t('advanced.rebuild.whenToRebuild'), t('advanced.rebuild.whenToRebuildAns'))}
        {faqItem(Clock, t('advanced.rebuild.howLong'), t('advanced.rebuild.howLongAns'))}
        {faqItem(ShieldCheck, t('advanced.rebuild.isSafe'), t('advanced.rebuild.isSafeAns'))}
      </div>
    </section>
  )
}
