'use client'

import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import { useInsight } from '@/lib/hooks/use-insights'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ContentUnavailable } from '@/components/common/ContentUnavailable'
import { isForbiddenError, isNotFoundError } from '@/lib/utils/error-handler'
import { toReferenceRecordId } from '@/lib/utils/source-references'

interface SourceInsightDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  insight?: {
    id: string
    insight_type?: string
    content?: string
    created?: string | null
    source_id?: string
  }
  onDelete?: (insightId: string) => Promise<void>
}

export function SourceInsightDialog({ open, onOpenChange, insight, onDelete }: SourceInsightDialogProps) {
  const { t } = useTranslation()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Ensure insight ID has 'source_insight:' prefix for API calls
  const insightIdWithPrefix = insight?.id ? toReferenceRecordId('source_insight', insight.id) : ''

  const { data: fetchedInsight, isLoading, isError, error } = useInsight(insightIdWithPrefix, { enabled: open && !!insight?.id })

  // Use fetched data if available, otherwise fall back to passed-in insight.
  // On fetch error there is nothing trustworthy to show (the passed-in data
  // may reference a deleted item), so every derived field goes blank here.
  const displayInsight = isError ? undefined : (fetchedInsight ?? insight)

  const handleDelete = async () => {
    if (!insight?.id || !onDelete) return
    setIsDeleting(true)
    try {
      await onDelete(insight.id)
      onOpenChange(false)
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // Reset delete confirmation when dialog closes
  useEffect(() => {
    if (!open) {
      setShowDeleteConfirm(false)
    }
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className="flex w-full max-w-[calc(100vw-1.5rem)] flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border px-6 py-3">
          <div
            className="flex min-h-8 items-center justify-between gap-2"
            data-testid="source-insight-header-row"
          >
            <SheetTitle>{t('sources.sourceInsight')}</SheetTitle>
            {displayInsight?.insight_type && (
              <Badge variant="outline" className="text-xs uppercase">
                {displayInsight.insight_type}
              </Badge>
            )}
          </div>
        </SheetHeader>

        {showDeleteConfirm ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8">
            <p className="text-center text-muted-foreground">
              {t('sources.deleteInsightConfirm').split(/[?？]/)[0]}?<br />
              <span className="text-sm">{t('sources.deleteInsightConfirm').split(/[?？]/)[1]?.trim() || t('common.deleteForever')}</span>
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
              </div>
            ) : isError ? (
              <ContentUnavailable
                variant={isForbiddenError(error) ? 'forbidden' : isNotFoundError(error) ? 'not-found' : 'error'}
                onClose={() => onOpenChange(false)}
              />
            ) : displayInsight ? (
              <MarkdownRenderer>
                {displayInsight.content}
              </MarkdownRenderer>
            ) : (
              <p className="text-sm text-muted-foreground">{t('sources.noInsightSelected')}</p>
            )}
          </div>
        )}

        <SheetFooter className="flex-row items-center justify-between border-t border-border px-6 py-3 sm:justify-between">
          <Button
            variant="outline"
            onClick={() =>
              showDeleteConfirm ? setShowDeleteConfirm(false) : onOpenChange(false)
            }
            disabled={isDeleting}
          >
            {t('common.close')}
          </Button>
          {showDeleteConfirm ? (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? t('common.deleting') : t('common.delete')}
            </Button>
          ) : (
            onDelete && displayInsight && (
              <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                {t('common.delete')}
              </Button>
            )
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
