'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Clock
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { BaseChatSession } from '@/lib/types/api'
import { useModels } from '@/lib/hooks/use-models'

interface SessionManagerProps {
  sessions: BaseChatSession[]
  currentSessionId: string | null
  onCreateSession: (title: string) => void
  onSelectSession: (sessionId: string) => void
  onUpdateSession: (sessionId: string, title: string) => void
  onDeleteSession: (sessionId: string) => void
  loadingSessions: boolean
}

export function SessionManager({
  sessions,
  currentSessionId,
  onCreateSession,
  onSelectSession,
  onUpdateSession,
  onDeleteSession,
  loadingSessions
}: SessionManagerProps) {
  const { t, language } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data: models } = useModels()

  // Helper to get model name from ID
  const customModelLabel = t('common.customModel')
  const getModelName = useMemo(() => {
    return (modelId: string) => {
      const model = models?.find(m => m.id === modelId)
      return model?.name || customModelLabel
    }
  }, [models, customModelLabel])

  const handleCreateSession = () => {
    if (newSessionTitle.trim()) {
      onCreateSession(newSessionTitle.trim())
      setNewSessionTitle('')
      setIsCreating(false)
    }
  }

  const handleStartEdit = (session: BaseChatSession) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onUpdateSession(editingId, editTitle.trim())
      setEditingId(null)
      setEditTitle('')
    }
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
  }

  const handleDeleteConfirm = () => {
    if (deleteConfirmId) {
      onDeleteSession(deleteConfirmId)
      setDeleteConfirmId(null)
    }
  }

  return (
    <>
      <Card className="flex h-full flex-col gap-0 rounded-none border-0 py-0">
        <CardHeader className="grid-rows-1 items-center border-b border-border px-4 py-3 [.border-b]:pb-3">
          <CardTitle className="flex items-center gap-1">
            <MessageSquare className="size-5" />
            {t('chat.sessions')}
          </CardTitle>
          <CardAction className="row-span-1 row-start-1 self-center">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t('common.create')}
              onClick={() => setIsCreating(true)}
            >
              <Plus />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-0">
          <ScrollArea className="h-full px-4">
            <div className="flex min-h-full flex-col py-4" data-testid="session-scroll-content">
            {isCreating && (
              <div className="mb-3 rounded-[var(--surface-radius)] border p-3">
                <Input
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  aria-label={t('chat.sessionTitlePlaceholder')}
                  placeholder={t('chat.sessionTitlePlaceholder')}
                  className="mb-2"
                  autoFocus
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') handleCreateSession()
                  }}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateSession}>
                    {t('common.create')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsCreating(false)
                      setNewSessionTitle('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}

            {loadingSessions ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('common.loading')}
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">{t('chat.noSessions')}</p>
                <p className="text-xs mt-2">{t('chat.createToStart')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`cursor-pointer rounded-[var(--surface-radius)] border p-3 transition-colors ${
                      currentSessionId === session.id
                        ? 'bg-primary/10 border-primary'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {editingId === session.id ? (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editTitle}
                          aria-label={t('chat.sessionTitlePlaceholder')}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="sm" aria-label={t('common.save')} onClick={handleSaveEdit}>
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={t('common.cancel')}
                            onClick={handleCancelEdit}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between mb-1">
                          <h4 className="font-medium text-sm">
                            {session.title}
                          </h4>
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-primary hover:bg-primary/10 hover:text-primary"
                              aria-label={t('common.edit')}
                              onClick={() => handleStartEdit(session)}
                            >
                              <Edit2 />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={t('common.delete')}
                              onClick={() => setDeleteConfirmId(session.id)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(session.created), {
                            addSuffix: true,
                            locale: getDateLocale(language)
                          })}
                        </div>
                        {session.message_count != null && session.message_count > 0 && (
                          <Badge variant="secondary" className="mt-2 text-xs">
                            {t('chat.messagesCount', { count: session.message_count })}
                          </Badge>
                        )}
                        {session.model_override && (
                          <Badge variant="outline" className="mt-2 ml-2 text-xs">
                            {getModelName(session.model_override)}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.deleteSession')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chat.deleteSessionDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
