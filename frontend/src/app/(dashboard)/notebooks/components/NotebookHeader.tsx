'use client'

import { useState } from 'react'
import { NotebookResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, ArrowLeft, MoreVertical, Trash2, Share2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DetailHeader, DetailHeaderActions } from '@/components/workbench/DetailHeader'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { ShareSheet } from '@/components/sharing/ShareSheet'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { InlineEdit } from '@/components/common/InlineEdit'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useAuth } from '@/lib/hooks/use-auth'
import {
  canEditContent,
  canDeleteNotebook,
  canManageAcl,
} from '@/lib/utils/access-role'

interface NotebookHeaderProps {
  notebook: NotebookResponse
  onBack: () => void
}

export function NotebookHeader({ notebook, onBack }: NotebookHeaderProps) {
  const { t, language } = useTranslation()
  const dfLocale = getDateLocale(language)
  const { isAdmin } = useAuth()
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
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
      <DetailHeader
        className="border-b-0 pb-3"
      >
        <div
          data-slot="detail-header-layout"
          className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
        >
          <div className="min-w-0 space-y-1">
            <div className="min-w-0">
              {canEdit ? (
                <InlineEdit
                  id="notebook-name"
                  name="notebook-name"
                  value={notebook.name}
                  onSave={handleUpdateName}
                  className="font-serif text-[1.375rem] font-semibold leading-tight"
                  inputClassName="font-serif text-[1.375rem] font-semibold leading-tight"
                  placeholder={t('notebooks.namePlaceholder')}
                />
              ) : (
                <h1 className="font-serif text-[1.375rem] font-semibold leading-tight">{notebook.name}</h1>
              )}
            </div>
            {canEdit ? (
              <InlineEdit
                id="notebook-description"
                name="notebook-description"
                value={notebook.description || ''}
                onSave={handleUpdateDescription}
                className="text-sm leading-5 text-muted-foreground"
                inputClassName="text-sm leading-5 text-muted-foreground"
                placeholder={t('notebooks.addDescription')}
                multiline
                emptyText={t('notebooks.addDescription')}
              />
            ) : (
              notebook.description && (
                <p className="text-sm leading-5 text-muted-foreground">{notebook.description}</p>
              )
            )}
          </div>

          <DetailHeaderActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBack}
              aria-label={t('workbench.backToNotebooks')}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden md:inline">{t('workbench.backToNotebooks')}</span>
            </Button>
            {canShare && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowShareDialog(true)}
                aria-label={t('sharing.share')}
              >
                <Share2 className="h-4 w-4" />
                <span className="hidden md:inline">{t('sharing.share')}</span>
              </Button>
            )}
            {(canEdit || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={t('common.actions')}
                    title={t('common.actions')}
                  >
                    <MoreVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onClick={() => setShowArchiveDialog(true)}>
                      {notebook.archived ? <ArchiveRestore /> : <Archive />}
                      {notebook.archived
                        ? t('notebooks.unarchive')
                        : t('notebooks.archive')}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDialog(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 />
                      {t('common.delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </DetailHeaderActions>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            {role && <Badge variant="secondary">{t(`sharing.${role}`)}</Badge>}
            {notebook.archived && <Badge variant="secondary">{t('notebooks.archived')}</Badge>}
            <Badge variant="secondary" className="font-normal">
              {t('common.created', {
              time: formatDistanceToNow(new Date(notebook.created), {
                addSuffix: true,
                locale: dfLocale,
              }),
              })}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {t('common.updated', {
              time: formatDistanceToNow(new Date(notebook.updated), {
                addSuffix: true,
                locale: dfLocale,
              }),
              })}
            </Badge>
          </div>
        </div>
      </DetailHeader>

      <ConfirmDialog
        open={showArchiveDialog}
        onOpenChange={setShowArchiveDialog}
        title={t(notebook.archived
          ? 'notebooks.unarchiveConfirmTitle'
          : 'notebooks.archiveConfirmTitle')}
        description={t(notebook.archived
          ? 'notebooks.unarchiveConfirmDescription'
          : 'notebooks.archiveConfirmDescription', { name: notebook.name })}
        confirmText={t(notebook.archived ? 'notebooks.unarchive' : 'notebooks.archive')}
        onConfirm={handleArchiveToggle}
        isLoading={updateNotebook.isPending}
      />
      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
        redirectAfterDelete
      />

      <ShareSheet
        resourceType="notebook"
        resourceId={notebook.id}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        canManage={canShare}
        accessSummary={notebook.access_summary}
      />
    </>
  )
}
