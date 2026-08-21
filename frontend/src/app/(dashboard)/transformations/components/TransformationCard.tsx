'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Trash2, Wand2, Edit, RotateCcw } from 'lucide-react'
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
      <Card className={cn('shadow-sm', isDeleted && 'opacity-70')}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold text-foreground">
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
              <p className="truncate text-sm text-muted-foreground">{transformation.description}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('transformations.model')}: {transformation.model_id || t('transformations.systemDefault')}
              {updatedLabel ? ` • ${updatedLabel}` : ''}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onPlayground && !isDeleted && (
              <Button variant="outline" size="sm" onClick={onPlayground}>
                <Wand2 className="h-4 w-4 mr-2" />
                {t('transformations.testInPlayground')}
              </Button>
            )}
            {onEdit && canEdit && !isDeleted && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                {t('common.edit')}
              </Button>
            )}
            {canRestore && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreTransformation.mutate(transformation.id)}
                disabled={restoreTransformation.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {t('transformations.restore')}
              </Button>
            )}
            {canDelete && !isDeleted && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('common.delete')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

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
