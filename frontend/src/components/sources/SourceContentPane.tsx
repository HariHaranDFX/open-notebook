'use client'

import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Database,
  Download,
  ExternalLink,
  Link as LinkIcon,
} from 'lucide-react'

import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
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
      <Card className="gap-0 rounded-none border-0 py-0 shadow-none">
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
        <CardContent className={`px-4 pb-4 ${linkHeaderHref ? 'pt-2' : 'pt-4'}`}>
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
          <div
            data-slot="source-reading-content"
            className="mx-auto min-w-0 w-full max-w-[75ch] overflow-x-hidden"
          >
            <MarkdownRenderer>
              {source.full_text || t('sources.noContent')}
            </MarkdownRenderer>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="gap-0 rounded-none border-0 py-0 shadow-none">
        <CardHeader className="border-b border-border px-4 py-4">
          <CardTitle>{t('sources.details')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 px-4 py-4">
          {!source.embedded && (
            <Alert>
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
          )}

          <div className="space-y-4">
            {source.asset?.url && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('common.url')}</h3>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
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
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">{t('sources.uploadedFile')}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="max-w-full break-all rounded bg-muted px-2 py-1 text-sm">
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
            )}

            {source.topics && source.topics.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t('sources.topics')}</h3>
                <div className="flex flex-wrap gap-2">
                  {source.topics.map(topic => (
                    <Badge key={topic} variant="outline">{topic}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('sources.metadata')}</h3>
              <div className="flex items-center gap-2">
                <Database className="size-3.5 text-muted-foreground" />
                <Badge variant={source.embedded ? 'default' : 'secondary'} className="text-xs">
                  {source.embedded ? t('sources.embedded') : t('sources.notEmbedded')}
                </Badge>
              </div>
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
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <NotebookAssociations
          sourceId={sourceId}
          currentNotebookIds={source.notebooks || []}
          onSave={onRefresh}
        />
      )}
    </div>
  )
}
