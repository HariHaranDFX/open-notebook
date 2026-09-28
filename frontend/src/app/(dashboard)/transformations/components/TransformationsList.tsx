'use client'

import { useState } from 'react'
import { AlertTriangle, Plus, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TransformationCard } from './TransformationCard'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Transformation } from '@/lib/types/transformations'
import { TransformationEditorDialog } from './TransformationEditorDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useModels } from '@/lib/hooks/use-models'
import { isStaleModelId, knownModelIds } from '@/lib/models/stale-model'

interface TransformationsListProps {
  transformations: Transformation[] | undefined
  isLoading: boolean
  onPlayground?: (transformation: Transformation) => void
}

export function TransformationsList({ transformations, isLoading, onPlayground }: TransformationsListProps) {
  const { t } = useTranslation()
  const modelsQuery = useModels()
  const knownIds = knownModelIds(modelsQuery.data, modelsQuery.isSuccess)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTransformation, setEditingTransformation] = useState<Transformation | undefined>()

  const handleOpenEditor = (trans?: Transformation) => {
    setEditingTransformation(trans)
    setEditorOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const editorDialog = (
    <TransformationEditorDialog
      open={editorOpen}
      onOpenChange={(open) => {
        setEditorOpen(open)
        if (!open) {
          setEditingTransformation(undefined)
        }
      }}
      transformation={editingTransformation}
    />
  )

  if (!transformations || transformations.length === 0) {
    return (
      <>
        <EmptyState
          icon={Wand2}
          title={t('transformations.noTransformations')}
          description={t('transformations.createOne')}
          action={
            <Button onClick={() => handleOpenEditor()}>
              <Plus className="h-4 w-4" />
              {t('transformations.createNew')}
            </Button>
          }
        />
        {editorDialog}
      </>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">{t('transformations.listTitle')}</h2>
          <Button onClick={() => handleOpenEditor()}>
            <Plus className="h-4 w-4" />
            {t('transformations.createNew')}
          </Button>
        </div>

        {transformations.some((transformation) => isStaleModelId(transformation.model_id, knownIds)) && (
          <Alert className="border-warning/40 bg-warning-surface text-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('transformations.removedModelTitle')}</AlertTitle>
            <AlertDescription>{t('transformations.removedModel')}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {transformations.map((transformation) => (
            <TransformationCard
              key={transformation.id}
              transformation={transformation}
              modelRemoved={isStaleModelId(transformation.model_id, knownIds)}
              onPlayground={onPlayground ? () => onPlayground(transformation) : undefined}
              onEdit={() => handleOpenEditor(transformation)}
            />
          ))}
        </div>
      </div>

      {editorDialog}
    </>
  )
}
