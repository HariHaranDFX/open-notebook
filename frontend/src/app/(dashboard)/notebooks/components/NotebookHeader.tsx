'use client'

import { useState } from 'react'
import { NotebookResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, Trash2, Share2 } from 'lucide-react'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { ShareDialog } from '@/components/sharing/ShareDialog'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { InlineEdit } from '@/components/common/InlineEdit'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useAuth } from '@/lib/hooks/use-auth'
import {
  canEditContent,
  canDeleteNotebook,
  canManageAcl,
} from '@/lib/utils/access-role'

interface NotebookHeaderProps {
  notebook: NotebookResponse
}

export function NotebookHeader({ notebook }: NotebookHeaderProps) {
  const { t, language } = useTranslation()
  const dfLocale = getDateLocale(language)
  const { isAdmin } = useAuth()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)

  const updateNotebook = useUpdateNotebook()
  const role = notebook.access_role
  const canEdit = canEditContent(role)
  const canDelete = canDeleteNotebook(role)
  const canShare = canManageAcl(role, isAdmin)

  const handleUpdateName = async (name: string) => {
    if (!name || name === notebook.name) return

    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { name },
    })
  }

  const handleUpdateDescription = async (description: string) => {
    if (description === notebook.description) return

    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { description: description || undefined },
    })
  }

  const handleArchiveToggle = () => {
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived },
    })
  }

  return (
    <>
      <div className="border-b pb-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              {canEdit ? (
                <InlineEdit
                  id="notebook-name"
                  name="notebook-name"
                  value={notebook.name}
                  onSave={handleUpdateName}
                  className="text-2xl font-bold"
                  inputClassName="text-2xl font-bold"
                  placeholder={t('notebooks.namePlaceholder')}
                />
              ) : (
                <h1 className="text-2xl font-bold">{notebook.name}</h1>
              )}
              {notebook.archived && (
                <Badge variant="secondary">{t('notebooks.archived')}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {canShare && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowShareDialog(true)}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  {t('sharing.share')}
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleArchiveToggle}
                >
                  {notebook.archived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4 mr-2" />
                      {t('notebooks.unarchive')}
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4 mr-2" />
                      {t('notebooks.archive')}
                    </>
                  )}
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('common.delete')}
                </Button>
              )}
            </div>
          </div>

          {canEdit ? (
            <InlineEdit
              id="notebook-description"
              name="notebook-description"
              value={notebook.description || ''}
              onSave={handleUpdateDescription}
              className="text-muted-foreground"
              inputClassName="text-muted-foreground"
              placeholder={t('notebooks.addDescription')}
              multiline
              emptyText={t('notebooks.addDescription')}
            />
          ) : (
            notebook.description && (
              <p className="text-muted-foreground">{notebook.description}</p>
            )
          )}

          <div className="text-sm text-muted-foreground">
            {t('common.created', {
              time: formatDistanceToNow(new Date(notebook.created), {
                addSuffix: true,
                locale: dfLocale,
              }),
            })}{' '}
            •
            {t('common.updated', {
              time: formatDistanceToNow(new Date(notebook.updated), {
                addSuffix: true,
                locale: dfLocale,
              }),
            })}
          </div>
        </div>
      </div>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
        redirectAfterDelete
      />

      <ShareDialog
        resourceType="notebook"
        resourceId={notebook.id}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        canManage={canShare}
      />
    </>
  )
}
