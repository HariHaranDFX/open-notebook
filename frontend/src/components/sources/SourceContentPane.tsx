'use client'

import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
} from 'lucide-react'

import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { EmptyState } from '@/components/common/EmptyState'
import { getSourceResourceKind, ResourceTypeIcon } from '@/components/common/ResourceTypeIcon'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { SourceDetailResponse } from '@/lib/types/api'
import { getDateLocale } from '@/lib/utils/date-locale'
import { NotebookAssociations } from './NotebookAssociations'

interface SourceContentPaneProps {
  source: SourceDetailResponse
  sourceId: string
  section: 'content' | 'details'
  externalHref: string | null
  youTubeVideoId: string | null
  copied: boolean
  isEmbedding: boolean
  isDownloadingFile: boolean
  fileAvailable: boolean | null
  canEdit: boolean
  showDetailsHeader?: boolean
  detailsVariant?: 'default' | 'sheet'
  notebookActionsContainer?: Element | null
  onEmbedContent: () => void
  onCopyUrl: () => void
  onOpenExternal: () => void
  onDownloadFile: () => void
  onRefresh: () => void
}

export function SourceContentPane({
  source,
  sourceId,
  section,
  externalHref,
  youTubeVideoId,
  copied,
  isEmbedding,
  isDownloadingFile,
  fileAvailable,
  canEdit,
  showDetailsHeader = true,
  detailsVariant = 'default',
  notebookActionsContainer,
  onEmbedContent,
  onCopyUrl,
  onOpenExternal,
  onDownloadFile,
  onRefresh,
}: SourceContentPaneProps) {
  const { t, language } = useTranslation()

  if (section === 'content') {
    const linkHeaderHref = youTubeVideoId ? null : externalHref

    return (
      <Card className="min-h-full gap-0 rounded-none border-0 py-0 shadow-none">
        {linkHeaderHref && (
          <CardHeader className="px-4 pb-2 pt-4">
            <CardTitle className="sr-only">{t('sources.content')}</CardTitle>
            <CardDescription className="flex min-w-0 items-center gap-2">
              <LinkIcon className="size-4" />
              <a
                href={linkHeaderHref}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-primary hover:underline"
              >
                {source.asset?.url}
              </a>
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className={`flex flex-1 flex-col px-4 pb-4 ${linkHeaderHref ? 'pt-2' : 'pt-4'}`}>
          {youTubeVideoId && (
            <div className="mx-auto mb-6 w-full max-w-4xl">
              <div className="aspect-video w-full overflow-hidden rounded-[var(--panel-radius)] bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${youTubeVideoId}`}
                  title={t('common.accessibility.ytVideo')}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              {externalHref && (
                <a
                  href={externalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
                >
                  <ExternalLink className="size-3" />
                  {t('sources.openOnYoutube')}
                </a>
              )}
            </div>
          )}
          {source.full_text ? (
            <div
              data-slot="source-reading-content"
              className="mx-auto min-w-0 w-full max-w-[75ch] overflow-x-hidden"
            >
              <MarkdownRenderer>{source.full_text}</MarkdownRenderer>
            </div>
          ) : (
            <EmptyState className="flex-1" icon={FileText} title={t('sources.noContent')} />
          )}
        </CardContent>
      </Card>
    )
  }

  const isSheetDetails = detailsVariant === 'sheet'
  const sourceType = source.asset?.url
    ? t('sources.type.link')
    : source.asset?.file_path
      ? t('sources.type.file')
      : t('sources.type.text')
  const hasSourceDetails = Boolean(
    source.asset?.url || source.asset?.file_path || source.topics?.length,
  )

  return (
    <div
      data-slot="source-details-inspector"
      className={isSheetDetails ? 'space-y-0' : 'px-4'}
    >
      {showDetailsHeader && (
        <div className="border-b border-border py-4">
          <h2 className="font-semibold">{t('sources.details')}</h2>
        </div>
      )}

      {isSheetDetails && (
        <div
          data-slot="source-details-summary"
          className="flex min-w-0 items-center gap-3 border-b border-border pb-5"
        >
          <ResourceTypeIcon
            kind={getSourceResourceKind(source.asset)}
            className="size-10 rounded-[var(--control-radius)] border border-border bg-muted"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {source.title || t('sources.untitledSource')}
            </p>
            <Badge variant="secondary" className="mt-1 text-xs font-normal">
              {sourceType}
            </Badge>
          </div>
        </div>
      )}

      {!source.embedded && (
        <div className="border-b border-border py-5">
          <Alert className="rounded-[var(--control-radius)]">
            <AlertCircle className="size-4" />
            <AlertTitle>{t('sources.notEmbeddedAlert')}</AlertTitle>
            <AlertDescription>
              {t('sources.notEmbeddedDesc')}
              {canEdit && (
                <div className="mt-3">
                  <Button onClick={onEmbedContent} disabled={isEmbedding} size="sm">
                    <Database className="mr-2 size-4" />
                    {isEmbedding ? t('sources.embedding') : t('sources.embedContent')}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {hasSourceDetails && (
        <section className="space-y-4 border-b border-border py-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('common.source')}
          </h3>

          {source.asset?.url && (
            <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
              <p className="text-sm font-medium text-muted-foreground">{t('common.url')}</p>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate bg-muted px-2 py-1.5 text-sm">
                  {source.asset.url}
                </code>
                <Button size="icon" variant="outline" onClick={onCopyUrl}>
                  <span className="sr-only">{t('common.copyToClipboard')}</span>
                  {copied ? <CheckCircle className="size-4" /> : <Copy className="size-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={onOpenExternal}
                  disabled={!externalHref}
                >
                  <span className="sr-only">{t('sources.viewSource')}</span>
                  <ExternalLink className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {source.asset?.file_path && (
            <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
              <p className="pt-2 text-sm font-medium text-muted-foreground">
                {t('sources.uploadedFile')}
              </p>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all bg-muted px-2 py-1.5 text-sm">
                    {source.asset.file_path}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onDownloadFile}
                    disabled={isDownloadingFile || fileAvailable === false}
                  >
                    <Download className="mr-2 size-4" />
                    {fileAvailable === false
                      ? t('sources.fileUnavailable')
                      : isDownloadingFile
                        ? t('sources.preparing')
                        : t('common.download')}
                  </Button>
                </div>
                {fileAvailable === false && (
                  <p className="text-xs text-muted-foreground">
                    {t('sources.fileUnavailableDesc')}
                  </p>
                )}
              </div>
            </div>
          )}

          {source.topics && source.topics.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
              <p className="pt-1 text-sm font-medium text-muted-foreground">
                {t('sources.topics')}
              </p>
              <div className="flex flex-wrap gap-2">
                {source.topics.map(topic => (
                  <Badge key={topic} variant="outline">{topic}</Badge>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="space-y-4 border-b border-border py-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('sources.metadata')}
          </h3>
          {!isSheetDetails && (
            <Badge variant={source.embedded ? 'default' : 'secondary'} className="text-xs">
              {source.embedded ? t('sources.embedded') : t('sources.notEmbedded')}
            </Badge>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('common.created_label')}</p>
            <p className="text-sm">
              {formatDistanceToNow(new Date(source.created), {
                addSuffix: true,
                locale: getDateLocale(language),
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(source.created).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('common.updated_label')}</p>
            <p className="text-sm">
              {formatDistanceToNow(new Date(source.updated), {
                addSuffix: true,
                locale: getDateLocale(language),
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(source.updated).toLocaleString()}
            </p>
          </div>
        </div>
      </section>

      {canEdit && (
        <div className="pt-5">
          <NotebookAssociations
            sourceId={sourceId}
            currentNotebookIds={source.notebooks || []}
            onSave={onRefresh}
            actionsContainer={notebookActionsContainer}
          />
        </div>
      )}
    </div>
  )
}
