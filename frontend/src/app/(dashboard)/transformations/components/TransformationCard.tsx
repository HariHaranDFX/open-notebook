'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'

interface TransformationCardProps {
  transformation: Transformation
  onPlayground?: () => void
  onEdit?: () => void
}

export function TransformationCard({ transformation, onPlayground, onEdit }: TransformationCardProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
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

  return (
    <>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <Card className={cn(isDeleted && 'opacity-70')}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <CollapsibleTrigger className="flex-1 text-left">
                <div className={cn('flex items-center gap-3', isExpanded ? 'mb-2' : '')}>
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                  <div className="flex flex-col">
                    <span className="font-semibold">{transformation.name}</span>
                    {!isExpanded && transformation.description && (
                      <span className="text-sm text-muted-foreground">{transformation.description}</span>
                    )}
                  </div>
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
              </CollapsibleTrigger>

              <div className="flex items-center gap-2">
                {onPlayground && !isDeleted && (
                  <Button variant="outline" size="sm" onClick={onPlayground}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    {t('transformations.playground')}
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
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('common.title')}</p>
                <p className="text-sm font-medium">{transformation.title || t('sources.untitledSource')}</p>
              </div>

              {transformation.description && (
                <div>
                  <p className="text-sm text-muted-foreground">{t('common.description')}</p>
                  <p className="text-sm leading-6">{transformation.description}</p>
                </div>
              )}

              <div>
                <p className="text-sm text-muted-foreground">{t('transformations.systemPrompt')}</p>
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-sm font-mono">
                  {transformation.prompt}
                </pre>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
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
