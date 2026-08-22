'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight, Trash2, Wand2, Edit, RotateCcw } from 'lucide-react'
import { Transformation } from '@/lib/types/transformations'
import {
  useDeleteTransformation,
  useRestoreTransformation,
} from '@/lib/hooks/use-transformations'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'

interface TransformationCardProps {
  transformation: Transformation
  onPlayground?: () => void
  onEdit?: () => void
}

export function TransformationCard({ transformation, onPlayground, onEdit }: TransformationCardProps) {
  const { t, language } = useTranslation()
  const [isPromptOpen, setIsPromptOpen] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const deleteTransformation = useDeleteTransformation()
  const restoreTransformation = useRestoreTransformation()

  const canEdit = transformation.can_edit !== false
  const canDelete = transformation.can_delete !== false
  const canRestore = Boolean(transformation.can_restore)
  const isDeleted = Boolean(transformation.deleted_at)

  const handleDelete = () => {
    deleteTransformation.mutate(transformation.id)
    setShowDeleteDialog(false)
  }

  const updatedLabel = transformation.updated
    ? t('common.updated', {
        time: formatDistanceToNow(new Date(transformation.updated), {
          addSuffix: true,
          locale: getDateLocale(language),
        }),
      })
    : null

  return (
    <>
      <Collapsible open={isPromptOpen} onOpenChange={setIsPromptOpen}>
        <div
          className={cn(
            'rounded-[var(--surface-radius)] border bg-card transition-colors hover:bg-muted/50',
            isDeleted && 'opacity-70'
          )}
        >
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {transformation.title || transformation.name}
                </span>
                {transformation.apply_default && (
                  <Badge variant="secondary">{t('common.default')}</Badge>
                )}
                {transformation.is_builtin && (
                  <Badge variant="outline">{t('transformations.builtin')}</Badge>
                )}
                {transformation.user_id && (
                  <Badge variant="outline">{t('transformations.personal')}</Badge>
                )}
                {isDeleted && (
                  <Badge variant="destructive">{t('transformations.archived')}</Badge>
                )}
              </div>
              {transformation.description && (
                <p className="truncate text-xs text-muted-foreground">
                  {transformation.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('transformations.model')}: {transformation.model_id || t('transformations.systemDefault')}
                {updatedLabel ? ` • ${updatedLabel}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={t('transformations.systemPrompt')}>
                  {isPromptOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{t('transformations.systemPrompt')}</span>
                </Button>
              </CollapsibleTrigger>
              {onPlayground && !isDeleted && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPlayground}
                  aria-label={t('transformations.testInPlayground')}
                >
                  <Wand2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('transformations.testInPlayground')}</span>
                </Button>
              )}
              {onEdit && canEdit && !isDeleted && (
                <Button variant="outline" size="sm" onClick={onEdit} aria-label={t('common.edit')}>
                  <Edit className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('common.edit')}</span>
                </Button>
              )}
              {canRestore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restoreTransformation.mutate(transformation.id)}
                  disabled={restoreTransformation.isPending}
                  aria-label={t('transformations.restore')}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('transformations.restore')}</span>
                </Button>
              )}
              {canDelete && !isDeleted && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  aria-label={t('common.delete')}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('common.delete')}</span>
                </Button>
              )}
            </div>
          </div>

          <CollapsibleContent>
            <div className="border-t px-3 pb-3 pt-2">
              <p className="text-xs text-muted-foreground">{t('transformations.systemPrompt')}</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs font-mono text-muted-foreground">
                {transformation.prompt}
              </pre>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title={t('sources.delete')}
        description={t('transformations.deleteConfirm')}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDelete}
        isLoading={deleteTransformation.isPending}
      />
    </>
  )
}
