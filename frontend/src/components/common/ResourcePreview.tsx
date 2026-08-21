'use client'

import { FileText, StickyNote, Lightbulb, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { useSource } from '@/lib/hooks/use-sources'
import { useNote } from '@/lib/hooks/use-notes'
import { useInsight } from '@/lib/hooks/use-insights'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toReferenceRecordId } from '@/lib/utils/source-references'
import { isForbiddenError, isNotFoundError } from '@/lib/utils/error-handler'
import type { PreviewResourceType } from '@/lib/hooks/use-resource-preview'

interface ResourcePreviewProps {
  type: PreviewResourceType
  id: string
  onClose: () => void
  // When false, the internal "Preview" header + close are omitted — for hosts
  // that already label and close the preview (e.g. the workbench pane tab).
  showHeader?: boolean
}

const TYPE_META: Record<PreviewResourceType, { Icon: typeof FileText; labelKey: string }> = {
  source: { Icon: FileText, labelKey: 'common.source' },
  note: { Icon: StickyNote, labelKey: 'common.note' },
  source_insight: { Icon: Lightbulb, labelKey: 'common.insight' },
}

/**
 * Read-only preview of a referenced source, note, or insight, shown in the
 * workbench's preview pane. Resolves the full `type:id` record before fetching,
 * fetches only the matching resource, and renders loading / content /
 * unavailable states with a close action. Never offers edits.
 */
export function ResourcePreview({ type, id, onClose, showHeader = true }: ResourcePreviewProps) {
  const { t } = useTranslation()
  const { Icon, labelKey } = TYPE_META[type]
  const recordId = toReferenceRecordId(type, id)

  // Rules of hooks: call all three, enable only the matching resource.
  const source = useSource(type === 'source' ? recordId : '', { enabled: type === 'source' })
  const note = useNote(type === 'note' ? recordId : '', { enabled: type === 'note' })
  const insight = useInsight(type === 'source_insight' ? recordId : '', { enabled: type === 'source_insight' })
  const active = type === 'source' ? source : type === 'note' ? note : insight

  let title: string | null = null
  let body = ''
  let authorship: string | null = null
  if (type === 'source' && source.data) {
    title = source.data.title
    body = source.data.full_text ?? ''
  } else if (type === 'note' && note.data) {
    title = note.data.title
    body = note.data.content ?? ''
    authorship = note.data.note_type === 'ai' ? t('common.aiGenerated') : t('common.human')
  } else if (type === 'source_insight' && insight.data) {
    title = insight.data.insight_type
    body = insight.data.content ?? ''
    authorship = t('common.aiGenerated')
  }

  const unavailableMessage = isNotFoundError(active.error)
    ? t('common.itemNotFound', { type: t(labelKey) })
    : isForbiddenError(active.error)
      ? t('apiErrors.forbidden')
      : t('common.noResults')

  return (
    <section className="flex h-full flex-col" aria-label={t('common.preview')}>
      {showHeader && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {t('common.preview')}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {active.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : active.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Icon className="size-10 opacity-50" aria-hidden="true" />
            <p className="text-sm">{unavailableMessage}</p>
          </div>
        ) : (
          <article className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5">
                <Icon className="size-3" aria-hidden="true" />
                {t(labelKey)}
              </Badge>
              {authorship && <Badge variant="outline">{authorship}</Badge>}
            </div>
            {title && (
              <h3 className="font-serif text-lg font-semibold leading-tight">{title}</h3>
            )}
            {body ? (
              <div className="min-w-0 max-w-[75ch] overflow-x-hidden text-sm">
                <MarkdownRenderer>{body}</MarkdownRenderer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
            )}
          </article>
        )}
      </div>
    </section>
  )
}
