'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { LoaderIcon, BookOpen, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useAddSourcesToNotebook, useRemoveSourceFromNotebook } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'

interface NotebookAssociationsProps {
  sourceId: string
  currentNotebookIds: string[]
  onSave?: () => void
  actionsContainer?: Element | null
}

export function NotebookAssociations({
  sourceId,
  currentNotebookIds,
  onSave,
  actionsContainer,
}: NotebookAssociationsProps) {
  const { t } = useTranslation()
  const [selectedNotebookIds, setSelectedNotebookIds] = useState<string[]>(currentNotebookIds)
  const [isSaving, setIsSaving] = useState(false)

  const { data: notebooks, isLoading } = useNotebooks()
  const addSources = useAddSourcesToNotebook()
  const removeFromNotebook = useRemoveSourceFromNotebook()

  // Update selected notebooks when current changes (after save)
  useEffect(() => {
    setSelectedNotebookIds(currentNotebookIds)
  }, [currentNotebookIds])

  const hasChanges = useMemo(() => {
    const current = new Set(currentNotebookIds)
    const selected = new Set(selectedNotebookIds)

    if (current.size !== selected.size) return true

    for (const id of current) {
      if (!selected.has(id)) return true
    }

    return false
  }, [currentNotebookIds, selectedNotebookIds])

  const handleToggleNotebook = (notebookId: string) => {
    setSelectedNotebookIds(prev =>
      prev.includes(notebookId)
        ? prev.filter(id => id !== notebookId)
        : [...prev, notebookId]
    )
  }

  const handleSave = async () => {
    if (!hasChanges) return

    try {
      setIsSaving(true)

      const current = new Set(currentNotebookIds)
      const selected = new Set(selectedNotebookIds)

      // Determine which notebooks to add and remove
      const toAdd = selectedNotebookIds.filter(id => !current.has(id))
      const toRemove = currentNotebookIds.filter(id => !selected.has(id))

      // Execute additions
      if (toAdd.length > 0) {
        await Promise.allSettled(
          toAdd.map(notebookId =>
            addSources.mutateAsync({
              notebookId,
              sourceIds: [sourceId],
            })
          )
        )
      }

      // Execute removals
      if (toRemove.length > 0) {
        await Promise.allSettled(
          toRemove.map(notebookId =>
            removeFromNotebook.mutateAsync({
              notebookId,
              sourceId,
            })
          )
        )
      }

      onSave?.()
    } catch (error) {
      console.error('Error saving notebook associations:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setSelectedNotebookIds(currentNotebookIds)
  }

  const activeNotebooks = notebooks?.filter(notebook => !notebook.archived) ?? []
  const pendingActions = hasChanges && (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCancel}
        disabled={isSaving}
      >
        {t('common.cancel')}
      </Button>
      <Button size="sm" onClick={handleSave} disabled={isSaving}>
        {isSaving ? (
          <>
            <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
            {t('common.saving')}...
          </>
        ) : (
          t('common.saveChanges')
        )}
      </Button>
    </div>
  )

  return (
    <section
      data-slot="notebook-associations"
      className="overflow-hidden rounded-[var(--control-radius)] border border-border bg-card text-card-foreground"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="size-4 text-primary" />
            {t('sources.manageNotebooks')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('sources.manageNotebooksDesc')}
          </p>
        </div>
        <Badge variant="secondary" className="min-w-7 tabular-nums">
          {selectedNotebookIds.length}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : activeNotebooks.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {t('sources.noNotebooksAvailable')}
        </p>
      ) : (
        <ScrollArea className="h-[min(20rem,40dvh)]">
          <div className="flex flex-col">
            {activeNotebooks.map((notebook) => {
                const isSelected = selectedNotebookIds.includes(notebook.id)
                const isCurrentlyLinked = currentNotebookIds.includes(notebook.id)

                return (
                  <div
                    key={notebook.id}
                    data-slot="notebook-association-row"
                    className={`flex items-start gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 ${
                      isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleToggleNotebook(notebook.id)}
                      aria-label={notebook.name}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className={`break-words text-sm font-semibold leading-5 ${
                          isSelected ? 'text-primary' : 'text-foreground'
                        }`}>
                          {notebook.name}
                        </h4>
                        {isCurrentlyLinked && !hasChanges && (
                          <Check className="h-4 w-4 text-green-600" />
                        )}
                      </div>
                      {notebook.description && (
                        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {notebook.description}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </ScrollArea>
      )}

      {pendingActions && !actionsContainer && (
        <div className="flex justify-end border-t border-border px-4 py-3">
          {pendingActions}
        </div>
      )}
      {pendingActions && actionsContainer && createPortal(pendingActions, actionsContainer)}
    </section>
  )
}
