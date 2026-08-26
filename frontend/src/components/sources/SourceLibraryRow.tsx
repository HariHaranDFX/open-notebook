'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Lightbulb,
  MoreVertical,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react'

import { getSourceResourceKind, ResourceTypeIcon } from '@/components/common/ResourceTypeIcon'
import { ShareSheet } from '@/components/sharing/ShareSheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/hooks/use-auth'
import { useSourceStatus } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceListResponse } from '@/lib/types/api'
import {
  canDeleteSource,
  canEditContent,
  canManageAcl,
} from '@/lib/utils/access-role'
import type { LibraryViewMode } from '@/lib/stores/library-view-store'
import { cn } from '@/lib/utils'
import { formatCompactRelativeTime } from '@/lib/utils/relative-time'

interface SourceLibraryRowProps {
  source: SourceListResponse
  onDelete: (source: SourceListResponse) => void
  onRetry: (sourceId: string) => void
  isRetrying?: boolean
  viewMode?: LibraryViewMode
}

const sourceTypes = {
  link: { label: 'sources.type.link' },
  file: { label: 'sources.type.file' },
  text: { label: 'sources.type.text' },
} as const

const accessRoleLabels = {
  viewer: 'sharing.viewer',
  editor: 'sharing.editor',
  owner: 'sharing.owner',
} as const

function getSourceType(source: SourceListResponse): keyof typeof sourceTypes {
  if (source.asset?.url) return 'link'
  if (source.asset?.file_path) return 'file'
  return 'text'
}

export function SourceLibraryRow({
  source,
  onDelete,
  onRetry,
  isRetrying = false,
  viewMode = 'list',
}: SourceLibraryRowProps) {
  const { t, language } = useTranslation()
  const { isAdmin } = useAuth()
  const [showShareDialog, setShowShareDialog] = useState(false)
  const initialStatus = source.status ?? (source.command_id ? 'new' : 'completed')
  const shouldPoll = ['new', 'queued', 'running'].includes(initialStatus)
  const {
    data: statusData,
    isError: statusError,
    isFetching: statusFetching,
    refetch: refetchStatus,
  } = useSourceStatus(source.id, shouldPoll, initialStatus)
  const status = statusData?.status ?? initialStatus
  const role = source.access_role
  const roleLabel = role ? t(accessRoleLabels[role]) : null
  const canEdit = canEditContent(role)
  const canDelete = canDeleteSource(role)
  const canShare = canManageAcl(role, isAdmin)
  const sourceType = sourceTypes[getSourceType(source)]
  const resourceKind = getSourceResourceKind(source.asset)

  const statusConfig = statusError
    ? { label: t('sources.statusUnavailable'), icon: AlertTriangle, className: 'border-warning/40 bg-warning-surface text-warning' }
    : status === 'completed'
    ? { label: t('sources.statusCompleted'), icon: CheckCircle2, className: 'border-success/40 bg-success-surface text-success' }
    : status === 'failed'
      ? { label: t('sources.statusFailed'), icon: AlertTriangle, className: 'border-error/40 bg-error-surface text-error' }
      : status === 'running'
        ? { label: t('sources.statusProcessing'), icon: Loader2, className: 'border-info/40 bg-info-surface text-info' }
        : status === 'new' || status === 'queued'
          ? { label: t('sources.statusQueued'), icon: Clock3, className: 'border-info/40 bg-info-surface text-info' }
          : status === 'partial'
            ? { label: t('sources.statusPartial'), icon: AlertTriangle, className: 'border-warning/40 bg-warning-surface text-warning' }
            : { label: t('sources.statusUnavailable'), icon: AlertTriangle, className: 'border-warning/40 bg-warning-surface text-warning' }
  const StatusIcon = statusConfig.icon
  const isFailed = status === 'failed'
  const statusUnavailable = statusError || !['completed', 'failed', 'running', 'new', 'queued', 'partial'].includes(status)
  const hasMenuActions = canShare || canDelete
  const identityBadges = (
    <>
      <Badge variant="outline">{t(sourceType.label)}</Badge>
      {roleLabel && (
        <Badge
          variant="outline"
          aria-label={`${t('sources.accessRole')}: ${roleLabel}`}
        >
          {roleLabel}
        </Badge>
      )}
    </>
  )
  const statusBadges = (
    <>
      <Badge variant="outline" className={statusConfig.className}>
        <StatusIcon className={cn('size-3', status === 'running' && 'animate-spin')} />
        {statusConfig.label}
      </Badge>
      {!isFailed && (
        <Badge variant="secondary">
          {source.embedded ? t('sources.embedded') : t('sources.notEmbedded')}
        </Badge>
      )}
    </>
  )
  const recoveryControls = (
    <>
      {isFailed && canEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRetry(source.id)}
          disabled={isRetrying}
          className="relative z-10"
        >
          <RefreshCw className={cn(isRetrying && 'animate-spin')} />
          {t('common.retry')}
        </Button>
      )}

      {statusUnavailable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetchStatus()}
          disabled={statusFetching}
          className="relative z-10"
        >
          <RefreshCw className={cn(statusFetching && 'animate-spin')} />
          {t('common.retry')}
        </Button>
      )}
    </>
  )

  return (
    <>
      <article
        data-view-mode={viewMode}
        className={cn(
          'group relative grid min-w-0 bg-card transition-colors duration-[var(--motion-standard)] hover:bg-secondary/60',
          viewMode === 'card'
            ? 'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-3 rounded-[var(--surface-radius)] border border-border p-3'
            : 'grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 border-b border-border px-2 py-2 last:border-b-0 sm:px-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-3',
        )}
      >
        <div className="col-start-1 row-start-1 min-w-0">
          {viewMode === 'card' && (
            <div data-testid="source-card-state" className="flex min-w-0 flex-wrap items-center gap-2">
              {statusBadges}
              {recoveryControls}
            </div>
          )}
          <div className={cn('flex min-w-0 items-center gap-1', viewMode === 'card' && 'mt-3')}>
            <ResourceTypeIcon kind={resourceKind} />
            <Link
              href={`/sources/${encodeURIComponent(source.id)}`}
              title={source.title || t('sources.untitledSource')}
              className="min-w-0 flex-1 truncate rounded-sm font-semibold leading-snug text-foreground outline-none transition-colors after:absolute after:inset-0 after:rounded-[var(--surface-radius)] after:content-[''] group-hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
            >
              {source.title || t('sources.untitledSource')}
            </Link>
          </div>
          {source.asset?.url && (
            <p className="mt-0.5 truncate pl-8 text-sm text-muted-foreground">{source.asset.url}</p>
          )}
        </div>

        <div
          data-testid={viewMode === 'card' ? 'source-card-metadata' : undefined}
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-2',
            viewMode === 'card'
              ? 'col-span-2 row-start-2 self-end border-t border-border pt-3'
              : 'col-span-2 row-start-2 pl-8 md:col-span-1 md:row-start-auto md:justify-end md:pl-0',
          )}
        >
          {identityBadges}
          {viewMode === 'list' && statusBadges}
          <Badge
            variant="outline"
            className="gap-1 tabular-nums"
            aria-label={`${t('common.insights')}: ${source.insights_count || 0}`}
            title={t('common.insights')}
          >
            <Lightbulb />
            <span>{source.insights_count || 0}</span>
          </Badge>
          {viewMode === 'list' && recoveryControls}
          <time
            dateTime={source.updated}
            title={source.updated}
            className={cn('ml-auto text-xs text-muted-foreground', viewMode === 'card' && 'self-end')}
          >
            {formatCompactRelativeTime(source.updated, language)}
          </time>
        </div>

        {hasMenuActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.actions')}
                className={cn(
                  'relative z-10 col-start-2 row-start-1 self-start justify-self-end',
                  viewMode === 'list' && 'md:col-start-auto md:row-start-auto md:self-auto',
                )}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canShare && (
                <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                  <Share2 />
                  {t('sharing.share')}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(source)}
                  variant="destructive"
                >
                  <Trash2 />
                  {t('sources.deleteSource')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </article>

      <ShareSheet
        resourceType="source"
        resourceId={source.id}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        canManage={canShare}
        accessSummary={source.access_summary}
      />
    </>
  )
}
