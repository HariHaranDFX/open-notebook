'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { sourcesApi } from '@/lib/api/sources'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useSource, useUpdateSource, useDeleteSource } from '@/lib/hooks/use-sources'
import { insightsApi, SourceInsightResponse } from '@/lib/api/insights'
import { transformationsApi } from '@/lib/api/transformations'
import { embeddingApi } from '@/lib/api/embedding'
import { SourceDetailResponse } from '@/lib/types/api'
import { Transformation } from '@/lib/types/transformations'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { ContentUnavailable } from '@/components/common/ContentUnavailable'
import { isForbiddenError, isNotFoundError } from '@/lib/utils/error-handler'
import { InlineEdit } from '@/components/common/InlineEdit'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Link as LinkIcon,
  Upload,
  AlignLeft,
  Download,
  MoreVertical,
  Trash2,
  Database,
  MessageSquare,
  Share2,
  ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { SourceInsightDialog } from '@/components/sources/SourceInsightDialog'
import { ShareSheet } from '@/components/sharing/ShareSheet'
import { SourceContentPane } from '@/components/sources/SourceContentPane'
import { SourceInsightsPane } from '@/components/sources/SourceInsightsPane'
import { DetailHeader, DetailHeaderActions } from '@/components/workbench/DetailHeader'
import { WorkspaceSkeleton } from '@/components/workbench/WorkspaceSkeleton'
import { useAuth } from '@/lib/hooks/use-auth'
import { getDateLocale } from '@/lib/utils/date-locale'
import {
  canDeleteSource,
  canEditContent,
  canManageAcl,
} from '@/lib/utils/access-role'

export interface SourceDetailWorkspacePanes {
  content: ReactNode
  insights: ReactNode
  details: ReactNode
  insightCount: number
}

interface SourceDetailContentProps {
  sourceId: string
  showChatButton?: boolean
  onChatClick?: () => void
  onClose?: () => void
  showBackButton?: boolean
  renderWorkspace?: (panes: SourceDetailWorkspacePanes) => ReactNode
}

const safeExternalHref = (url: string | null | undefined): string | null => {
  if (!url) return null

  try {
    const parsedUrl = new URL(url)
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : null
  } catch {
    return null
  }
}

export function SourceDetailContent(props: SourceDetailContentProps) {
  // Remount per source so all per-source UI state (active tab, transient
  // flags, insight selection…) resets on navigation, without parents needing
  // to key the component. The source data itself is cached by React Query, so
  // remounting is cheap: a cached source renders immediately.
  return <SourceDetailContentInner key={props.sourceId} {...props} />
}

function SourceDetailContentInner({
  sourceId,
  showChatButton = false,
  onChatClick,
  onClose,
  showBackButton = false,
  renderWorkspace,
}: SourceDetailContentProps) {
  const { t, language } = useTranslation()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [insights, setInsights] = useState<SourceInsightResponse[]>([])
  const [transformations, setTransformations] = useState<Transformation[]>([])
  const [selectedTransformation, setSelectedTransformation] = useState<string>('')
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [creatingInsight, setCreatingInsight] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [isDownloadingFile, setIsDownloadingFile] = useState(false)
  const [fileAvailable, setFileAvailable] = useState<boolean | null>(null)
  const [selectedInsight, setSelectedInsight] = useState<SourceInsightResponse | null>(null)
  const [insightToDelete, setInsightToDelete] = useState<string | null>(null)
  const [deletingInsight, setDeletingInsight] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [detailsFooterActions, setDetailsFooterActions] = useState<HTMLDivElement | null>(null)

  // A 404 means the source was deleted (e.g. a dangling chat/ask reference) —
  // handled by the shared "content no longer exists" state. The global query
  // client never retries 404s, so the not-found state shows immediately.
  const { data: source, isPending, error: loadQueryError, refetch: refetchSource } = useSource(sourceId)
  const loadError = loadQueryError
    ? (isForbiddenError(loadQueryError) ? 'forbidden' : isNotFoundError(loadQueryError) ? 'not-found' : 'error')
    : null
  const updateSource = useUpdateSource()
  const deleteSource = useDeleteSource()

  // file_available comes from the source payload; downloads may flip it later,
  // so keep it as local state synced from the query data.
  useEffect(() => {
    setFileAvailable(typeof source?.file_available === 'boolean' ? source.file_available : null)
  }, [source?.file_available])

  const fetchInsights = useCallback(async () => {
    try {
      setLoadingInsights(true)
      const data = await insightsApi.listForSource(sourceId)
      setInsights(data)
    } catch (err) {
      console.error('Failed to fetch insights:', err)
    } finally {
      setLoadingInsights(false)
    }
  }, [sourceId])

  const fetchTransformations = useCallback(async () => {
    try {
      const data = await transformationsApi.list()
      setTransformations(data.filter((t) => !t.deleted_at))
    } catch (err) {
      console.error('Failed to fetch transformations:', err)
    }
  }, [])

  useEffect(() => {
    if (sourceId) {
      void fetchInsights()
      void fetchTransformations()
    }
  }, [fetchInsights, fetchTransformations, sourceId])

  const createInsight = async () => {
    if (!selectedTransformation) {
      toast.error(t('sources.selectTransformation'))
      return
    }

    try {
      setCreatingInsight(true)
      const response = await insightsApi.create(sourceId, {
        transformation_id: selectedTransformation
      })
      // Show toast for async operation
      toast.success(t('sources.insightGenerationStarted'))
      setSelectedTransformation('')

      // Poll for command completion if we have a command_id
      if (response.command_id) {
        // Poll in background (don't block UI)
        insightsApi.waitForCommand(response.command_id, {
          maxAttempts: 120, // Up to 4 minutes (120 * 2s)
          intervalMs: 2000
        }).then(success => {
          if (success) {
            void fetchInsights()
            // Invalidate sources queries so notebook page refreshes with updated insights_count
            queryClient.invalidateQueries({ queryKey: ['sources'] })
          }
        }).catch(err => {
          console.error('Error waiting for insight command:', err)
        })
      } else {
        // Fallback: refresh after delay if no command_id
        setTimeout(() => {
          void fetchInsights()
          // Also invalidate sources queries
          queryClient.invalidateQueries({ queryKey: ['sources'] })
        }, 5000)
      }
    } catch (err) {
      console.error('Failed to create insight:', err)
      toast.error(t('common.error'))
    } finally {
      setCreatingInsight(false)
    }
  }

  const handleDeleteInsight = async (e?: React.MouseEvent) => {
    e?.preventDefault()
    if (!insightToDelete) return

    try {
      setDeletingInsight(true)
      await insightsApi.delete(insightToDelete)
      toast.success(t('common.success'))
      setInsightToDelete(null)
      await fetchInsights()
    } catch (err) {
      console.error('Failed to delete insight:', err)
      toast.error(t('common.error'))
    } finally {
      setDeletingInsight(false)
    }
  }

  const handleUpdateTitle = async (title: string) => {
    if (!source || title === source.title) return

    try {
      await updateSource.mutateAsync({ id: sourceId, data: { title } })
      // The mutation invalidates the source queries (list + detail); patch the
      // detail cache immediately so the title doesn't flash back while the
      // refetch is in flight.
      queryClient.setQueryData<SourceDetailResponse>(
        QUERY_KEYS.source(sourceId),
        (previous) => (previous ? { ...previous, title } : previous)
      )
    } catch (err) {
      // The mutation hook already shows an error toast.
      console.error('Failed to update source title:', err)
      await refetchSource()
    }
  }

  const handleEmbedContent = async () => {
    if (!source) return

    try {
      setIsEmbedding(true)
      const response = await embeddingApi.embedContent(sourceId, 'source')
      toast.success(response.message || t('common.success'))
      await refetchSource()
    } catch (err) {
      console.error('Failed to embed content:', err)
      toast.error(t('common.error'))
    } finally {
      setIsEmbedding(false)
    }
  }

  const extractFilename = (pathOrUrl: string | undefined, fallback: string) => {
    if (!pathOrUrl) {
      return fallback
    }
    const segments = pathOrUrl.split(/[/\\]/)
    return segments.pop() || fallback
  }

  const parseContentDisposition = (header?: string | null) => {
    if (!header) {
      return null
    }
    const match = header.match(/filename\*?=([^;]+)/i)
    if (!match) {
      return null
    }
    const value = match[1].trim()
    if (value.toLowerCase().startsWith("utf-8''")) {
      return decodeURIComponent(value.slice(7))
    }
    return value.replace(/^["']|["']$/g, '')
  }

  const handleDownloadFile = async () => {
    if (!source?.asset?.file_path || isDownloadingFile || fileAvailable === false) {
      return
    }

    try {
      setIsDownloadingFile(true)
      const response = await sourcesApi.downloadFile(source.id)
      const filenameFromHeader = parseContentDisposition(
        response.headers?.['content-disposition'] as string | undefined
      )
      const fallbackName = extractFilename(source.asset.file_path, `source-${source.id}`)
      const filename = filenameFromHeader || fallbackName

      const blobUrl = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
      setFileAvailable(true)
      toast.success(t('common.success'))
    } catch (err) {
      console.error('Failed to download file:', err)
      if (isNotFoundError(err)) {
        setFileAvailable(false)
        toast.error(t('sources.fileUnavailable'))
      } else {
        toast.error(t('common.error'))
      }
    } finally {
      setIsDownloadingFile(false)
    }
  }

  const getSourceIcon = () => {
    if (!source) return null
    if (source.asset?.url) return <LinkIcon className="h-5 w-5" />
    if (source.asset?.file_path) return <Upload className="h-5 w-5" />
    return <AlignLeft className="h-5 w-5" />
  }

  const getSourceType = () => {
    if (!source) return 'unknown'
    if (source.asset?.url) return 'link'
    if (source.asset?.file_path) return 'file'
    return 'text'
  }

  const externalHref = useMemo(() => safeExternalHref(source?.asset?.url), [source?.asset?.url])

  const handleCopyUrl = useCallback(() => {
    if (source?.asset?.url) {
      navigator.clipboard.writeText(source.asset.url)
      setCopied(true)
      toast.success(t('sources.urlCopied'))
      setTimeout(() => setCopied(false), 2000)
    }
  }, [source, t])

  const handleOpenExternal = useCallback(() => {
    if (externalHref) {
      window.open(externalHref, '_blank', 'noopener,noreferrer')
    }
  }, [externalHref])

  const getYouTubeVideoId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }
    return null
  }

  const youTubeVideoId = useMemo(() => {
    if (!externalHref) return null
    return getYouTubeVideoId(externalHref)
  }, [externalHref])

  const handleDelete = async () => {
    if (!source) return

    if (confirm(t('sources.deleteSourceConfirm') || t('common.confirm'))) {
      try {
        // The mutation hook shows the toasts and invalidates the source
        // queries, so a reopened dialog can't serve the deleted source from
        // the cache.
        await deleteSource.mutateAsync(source.id)
        onClose?.()
      } catch (error) {
        console.error('Failed to delete source:', error)
      }
    }
  }

  if (isPending) {
    return renderWorkspace ? <WorkspaceSkeleton kind="source" /> : (
      <div className="flex h-full items-center justify-center p-8">
        <LoadingSpinner />
      </div>
    )
  }

  // A definitive 404 always wins, even when React Query still holds stale
  // data from before the source was deleted (retained data on a failed
  // refetch). A transient refetch error over good cached data does not
  // replace the rendered source.
  if (loadError === 'not-found' || !source) {
    return (
      <ContentUnavailable
        variant={loadError ?? 'error'}
        onClose={onClose}
      />
    )
  }

  const canEdit = canEditContent(source.access_role)
  const canDelete = canDeleteSource(source.access_role)
  const hasPrimaryMenuActions = Boolean(renderWorkspace || source.asset?.file_path)
  const contentPane = (
    <SourceContentPane
      source={source}
      sourceId={sourceId}
      section="content"
      externalHref={externalHref}
      youTubeVideoId={youTubeVideoId}
      copied={copied}
      isEmbedding={isEmbedding}
      isDownloadingFile={isDownloadingFile}
      fileAvailable={fileAvailable}
      canEdit={canEdit}
      onEmbedContent={() => void handleEmbedContent()}
      onCopyUrl={handleCopyUrl}
      onOpenExternal={handleOpenExternal}
      onDownloadFile={() => void handleDownloadFile()}
      onRefresh={() => void refetchSource()}
    />
  )
  const insightsPane = (
    <SourceInsightsPane
      insights={insights}
      transformations={transformations}
      selectedTransformation={selectedTransformation}
      loadingInsights={loadingInsights}
      creatingInsight={creatingInsight}
      canEdit={canEdit}
      onTransformationChange={setSelectedTransformation}
      onCreateInsight={() => void createInsight()}
      onViewInsight={setSelectedInsight}
      onDeleteInsight={setInsightToDelete}
    />
  )
  const detailsPane = (
    <SourceContentPane
      source={source}
      sourceId={sourceId}
      section="details"
      externalHref={externalHref}
      youTubeVideoId={youTubeVideoId}
      copied={copied}
      isEmbedding={isEmbedding}
      isDownloadingFile={isDownloadingFile}
      fileAvailable={fileAvailable}
      canEdit={canEdit}
      showDetailsHeader={!renderWorkspace}
      detailsVariant={renderWorkspace ? 'sheet' : 'default'}
      notebookActionsContainer={renderWorkspace ? detailsFooterActions : undefined}
      onEmbedContent={() => void handleEmbedContent()}
      onCopyUrl={handleCopyUrl}
      onOpenExternal={handleOpenExternal}
      onDownloadFile={() => void handleDownloadFile()}
      onRefresh={() => void refetchSource()}
    />
  )

  return (
    <div
      className={renderWorkspace
        ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
        : 'flex h-full min-h-0 min-w-0 flex-col'}
    >
      <DetailHeader
        className={renderWorkspace ? 'border-b-0 px-4 pb-3 pt-3 sm:px-6 lg:pt-4' : 'px-4 sm:px-6'}
      >
        <div
          data-slot="detail-header-layout"
          className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
        >
          <div className="min-w-0 space-y-1">
            {canEditContent(source.access_role) ? (
              <InlineEdit
                value={source.title || ''}
                onSave={handleUpdateTitle}
                className="rounded-[var(--control-radius)] border border-transparent font-serif text-lg font-semibold leading-tight hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                inputClassName="h-8 rounded-[var(--control-radius)] border-border-strong bg-card px-2 font-serif text-base font-semibold leading-normal focus:ring-ring"
                placeholder={t('sources.titlePlaceholder')}
                emptyText={t('sources.untitledSource')}
              />
            ) : (
              <h1 className="truncate font-serif text-lg font-semibold leading-tight">
                {source.title || t('sources.untitledSource')}
              </h1>
            )}
            <p className="text-sm text-muted-foreground">
              {t('sources.id')}: {source.id}
            </p>
          </div>
          <DetailHeaderActions>
            {/* Chat with source button - only in modal */}
            {showChatButton && onChatClick && (
              <Button variant="outline" size="sm" onClick={onChatClick}>
                <MessageSquare className="h-4 w-4 mr-2" />
                {t('chat.chatWith', { name: t('navigation.sources') })}
              </Button>
            )}

            {showBackButton && onClose && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                aria-label={t('common.back')}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden md:inline">{t('common.back')}</span>
              </Button>
            )}

            {canManageAcl(source.access_role, isAdmin) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowShareDialog(true)}
                aria-label={t('sharing.share')}
              >
                <Share2 className="h-4 w-4" />
                <span className="hidden md:inline">{t('sharing.share')}</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('common.actions')}
                  title={t('common.actions')}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hasPrimaryMenuActions && (
                  <DropdownMenuGroup>
                    {renderWorkspace && (
                      <DropdownMenuItem onClick={() => setShowDetailsDialog(true)}>
                        <AlignLeft className="mr-2 h-4 w-4" />
                        {t('sources.details')}
                      </DropdownMenuItem>
                    )}
                    {source.asset?.file_path && (
                      <DropdownMenuItem
                        onClick={handleDownloadFile}
                        disabled={isDownloadingFile || fileAvailable === false}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {fileAvailable === false
                          ? t('sources.fileUnavailable')
                          : isDownloadingFile
                            ? t('sources.preparing')
                            : t('sources.downloadFile')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                )}
                {canEdit && (
                  <>
                    {hasPrimaryMenuActions && <DropdownMenuSeparator />}
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={handleEmbedContent}
                        disabled={isEmbedding || source.embedded}
                      >
                        <Database className="mr-2 h-4 w-4" />
                        {isEmbedding ? t('sources.embedding') : source.embedded ? t('sources.alreadyEmbedded') : t('sources.embedContent')}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </>
                )}
                {canDelete && (
                  <>
                    {(hasPrimaryMenuActions || canEdit) && <DropdownMenuSeparator />}
                    <DropdownMenuGroup>
                      <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('sources.deleteSource')}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </DetailHeaderActions>
          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            <Badge variant="secondary" className="gap-1.5">
              {getSourceIcon()}
              {getSourceType()}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {t('common.created', {
                time: formatDistanceToNow(new Date(source.created), {
                  addSuffix: true,
                  locale: getDateLocale(language),
                }),
              })}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {t('common.updated', {
                time: formatDistanceToNow(new Date(source.updated), {
                  addSuffix: true,
                  locale: getDateLocale(language),
                }),
              })}
            </Badge>
          </div>
        </div>
      </DetailHeader>

      <div className={renderWorkspace ? 'flex min-h-0 flex-1 overflow-hidden' : 'flex-1 overflow-y-auto px-2'}>
        {renderWorkspace ? renderWorkspace({ content: contentPane, insights: insightsPane, details: detailsPane, insightCount: insights.length }) : (
          <Tabs defaultValue="content" className="w-full">
          <TabsList className="grid w-full grid-cols-3 sticky top-0 z-10">
            <TabsTrigger value="content">{t('sources.content')}</TabsTrigger>
            <TabsTrigger value="insights">
              {t('common.insights')} {insights.length > 0 && `(${insights.length})`}
            </TabsTrigger>
            <TabsTrigger value="details">{t('sources.details')}</TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="mt-6">
            {contentPane}
          </TabsContent>

          <TabsContent value="insights" className="mt-6">
            {insightsPane}
          </TabsContent>

          <TabsContent value="details" className="mt-6">
            {detailsPane}
          </TabsContent>
          </Tabs>
        )}
      </div>

      {renderWorkspace && (
        <Sheet open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
          <SheetContent showCloseButton={false} className="flex w-full max-w-[calc(100vw-1.5rem)] flex-col gap-0 p-0 sm:max-w-2xl">
            <SheetHeader className="flex-row items-center justify-between gap-4 border-b border-border px-6 py-4">
              <SheetTitle>{t('sources.details')}</SheetTitle>
              <Badge variant={source.embedded ? 'default' : 'secondary'} className="text-xs">
                {source.embedded ? t('sources.embedded') : t('sources.notEmbedded')}
              </Badge>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {detailsPane}
            </div>
            <SheetFooter className="flex-row items-center border-t border-border px-6 py-3 sm:justify-start">
              <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
                {t('common.close')}
              </Button>
              <div ref={setDetailsFooterActions} className="ml-auto flex items-center gap-2" />
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      <SourceInsightDialog
        open={Boolean(selectedInsight)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedInsight(null)
          }
        }}
        insight={selectedInsight ?? undefined}
        onDelete={async (insightId) => {
          try {
            await insightsApi.delete(insightId)
            toast.success(t('common.success'))
            setSelectedInsight(null)
            await fetchInsights()
          } catch (err) {
            console.error('Failed to delete insight:', err)
            toast.error(t('common.error'))
          }
        }}
      />

      <AlertDialog open={!!insightToDelete} onOpenChange={() => setInsightToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sources.deleteInsight')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sources.deleteInsightConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingInsight}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={handleDeleteInsight}
                disabled={deletingInsight}
                variant="destructive"
              >
                {deletingInsight ? t('common.deleting') : t('common.delete')}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareSheet
        resourceType="source"
        resourceId={source.id}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        canManage={canManageAcl(source.access_role, isAdmin)}
        accessSummary={source.access_summary}
      />
    </div>
  )
}
