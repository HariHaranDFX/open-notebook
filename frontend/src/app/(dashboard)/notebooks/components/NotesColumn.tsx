'use client'

import { useState } from 'react'
import { NoteResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, StickyNote, Bot, User, MoreVertical, Trash2, ListChecks } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { NoteEditorDialog } from './NoteEditorDialog'
import { getDateLocale } from '@/lib/utils/date-locale'
import { formatDistanceToNow } from 'date-fns'
import { ContextSelector } from '@/components/common/ContextSelector'
import type { NoteContextMode } from '@/lib/types/notebook-context'
import type { NoteContextDefault } from '@/lib/utils/source-context'
import { useDeleteNote } from '@/lib/hooks/use-notes'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { AccessRole } from '@/lib/types/api'
import { canEditContent } from '@/lib/utils/access-role'

interface NotesColumnProps {
  notes?: NoteResponse[]
  isLoading: boolean
  notebookId: string
  contextSelections?: Record<string, NoteContextMode>
  onContextModeChange?: (noteId: string, mode: NoteContextMode) => void
  onBulkContextModeChange?: (action: NoteContextDefault) => void
  accessRole?: AccessRole | null
}

export function NotesColumn({
  notes,
  isLoading,
  notebookId,
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange,
  accessRole,
}: NotesColumnProps) {
  const { t, language } = useTranslation()
  const canEdit = canEditContent(accessRole)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponse | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)

  const deleteNote = useDeleteNote()

  const notesLabel = t('common.notes')

  const handleDeleteClick = (noteId: string) => {
    setNoteToDelete(noteId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return

    try {
      await deleteNote.mutateAsync(noteToDelete)
      setDeleteDialogOpen(false)
      setNoteToDelete(null)
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }

  return (
    <>
        <Card className="h-full flex flex-col flex-1 gap-0 overflow-hidden rounded-none border-0 py-0 shadow-none">
          <CardHeader className="flex-shrink-0 px-4 pb-2 pt-4">
            <div className="workbench-toolbar flex items-center justify-between gap-3">
              <CardTitle className="sr-only">{notesLabel}</CardTitle>
              <div className="workbench-toolbar-actions flex items-center gap-2">
                {onBulkContextModeChange && notes && notes.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t('sources.bulkContext')}
                      >
                        <ListChecks className="h-4 w-4" />
                        {t('sources.bulkContext')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('include')}>
                        {t('sources.includeAllInContext')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onBulkContextModeChange('exclude')}>
                        {t('sources.excludeAllFromContext')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {canEdit && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingNote(null)
                      setShowAddDialog(true)
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    {t('common.writeNote')}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !notes || notes.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title={t('notebooks.noNotesYet')}
                description={t('sources.createFirstNote')}
              />
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    aria-label={note.title || (note.note_type === 'ai' ? t('common.aiGenerated') : t('common.human'))}
                    className="relative cursor-pointer rounded-[var(--surface-radius)] border p-3 card-hover group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setEditingNote(note)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        setEditingNote(note)
                      }
                    }}
                  >
                    <div className="workbench-item-header mb-2 flex items-start justify-between gap-2">
                      <div className="workbench-item-actions flex min-w-0 items-center gap-2">
                        {note.note_type === 'ai' ? (
                          <Bot className="h-4 w-4 text-primary" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {note.note_type === 'ai' ? t('common.aiGenerated') : t('common.human')}
                        </Badge>
                      </div>

                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              aria-label={t('common.actions')}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteClick(note.id)
                              }}
                              variant="destructive"
                            >
                              <Trash2 />
                              {t('notebooks.deleteNote')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {note.title && (
                      <h4 className="text-sm font-medium mb-2 break-all">{note.title}</h4>
                    )}

                    {note.content && (
                      <p className="text-sm text-muted-foreground line-clamp-3 break-all">
                        {note.content}
                      </p>
                    )}

                    <div
                      data-slot="note-card-footer"
                      className="mt-3 flex min-w-0 items-end justify-between gap-2"
                    >
                      {onContextModeChange && contextSelections?.[note.id] && (
                        <div onClick={(event) => event.stopPropagation()}>
                          <ContextSelector
                            value={contextSelections[note.id]}
                            kind="note"
                            onValueChange={(mode) => onContextModeChange(note.id, mode === 'insights' ? 'off' : mode)}
                          />
                        </div>
                      )}
                      <time
                        dateTime={note.updated}
                        title={note.updated}
                        className="ml-auto shrink-0 text-right text-xs text-muted-foreground"
                      >
                        {formatDistanceToNow(new Date(note.updated), {
                          addSuffix: true,
                          locale: getDateLocale(language),
                        })}
                      </time>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      <NoteEditorDialog
        open={showAddDialog || Boolean(editingNote)}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setEditingNote(null)
          } else {
            setShowAddDialog(true)
          }
        }}
        notebookId={notebookId}
        note={editingNote ?? undefined}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('notebooks.deleteNote')}
        description={t('notebooks.deleteNoteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteNote.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
