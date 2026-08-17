'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Archive,
  ArchiveRestore,
  FileText,
  MoreVertical,
  Share2,
  StickyNote,
  Trash2,
} from 'lucide-react'

import { ShareDialog } from '@/components/sharing/ShareDialog'
import { ResourceTypeIcon } from '@/components/common/ResourceTypeIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/hooks/use-auth'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { NotebookResponse } from '@/lib/types/api'
import {
  canDeleteNotebook,
  canEditContent,
  canManageAcl,
} from '@/lib/utils/access-role'
import type { LibraryViewMode } from '@/lib/stores/library-view-store'
import { cn } from '@/lib/utils'
import { getNotebookSectionHref } from '@/lib/utils/notebook-section'
import { formatCompactRelativeTime } from '@/lib/utils/relative-time'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'

interface NotebookRowProps {
  notebook: NotebookResponse
  viewMode?: LibraryViewMode
}

export function NotebookRow({ notebook, viewMode = 'list' }: NotebookRowProps) {
  const { t, language } = useTranslation()
  const { isAdmin } = useAuth()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const updateNotebook = useUpdateNotebook()
  const role = notebook.access_role
  const canEdit = canEditContent(role)
  const canDelete = canDeleteNotebook(role)
  const canShare = canManageAcl(role, isAdmin)
  const hasActions = canEdit || canDelete || canShare
  const identityBadges = (
    <>
      {notebook.archived && (
        <Badge variant="secondary">{t('notebooks.archived')}</Badge>
      )}
      {role && (
        <Badge variant="outline">{t(`sharing.${role}`)}</Badge>
      )}
    </>
  )

  const handleArchiveToggle = () => {
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived },
    })
  }

  return (
    <>
      <article
        data-view-mode={viewMode}
        className={cn(
          'group relative grid min-w-0 bg-card transition-colors duration-[var(--motion-standard)] hover:bg-secondary/60',
          viewMode === 'card'
            ? 'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-3 rounded-[var(--surface-radius)] border border-border p-3'
            : 'grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 border-b border-border px-2 py-2 last:border-b-0 sm:px-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-3',
        )}
      >
        <div className="col-start-1 row-start-1 min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <ResourceTypeIcon kind="notebook" />
            <Link
              href={`/notebooks/${encodeURIComponent(notebook.id)}`}
              title={notebook.name}
              className="min-w-0 flex-1 truncate rounded-sm font-semibold leading-snug text-foreground outline-none transition-colors after:absolute after:inset-0 after:rounded-[var(--surface-radius)] after:content-[''] group-hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
            >
              {notebook.name}
            </Link>
          </div>
          {notebook.description && (
            <p title={notebook.description} className="mt-0.5 max-w-3xl truncate pl-8 text-sm text-muted-foreground">
              {notebook.description}
            </p>
          )}
        </div>

        <div
          data-testid={viewMode === 'card' ? 'notebook-card-metadata' : undefined}
          className={cn(
            'flex flex-wrap items-center gap-y-1.5 text-sm text-muted-foreground',
            viewMode === 'card'
              ? 'col-span-2 row-start-2 self-end gap-x-4 border-t border-border pt-3'
              : 'col-span-2 row-start-2 gap-x-2 pl-8 md:col-span-1 md:row-start-auto md:gap-x-4 md:pl-0',
          )}
        >
          {identityBadges}
          <Badge
            asChild
            variant="outline"
            className="relative z-10 gap-1 px-2 text-muted-foreground tabular-nums hover:border-primary/60 hover:text-primary"
          >
            <Link
              href={getNotebookSectionHref(notebook.id, 'sources')}
              aria-label={`${t('navigation.sources')}: ${notebook.source_count}`}
              title={t('navigation.sources')}
            >
              <FileText />
              <span>{notebook.source_count}</span>
            </Link>
          </Badge>
          <Badge
            asChild
            variant="outline"
            className="relative z-10 gap-1 px-2 text-muted-foreground tabular-nums hover:border-primary/60 hover:text-primary"
          >
            <Link
              href={getNotebookSectionHref(notebook.id, 'notes')}
              aria-label={`${t('common.notes')}: ${notebook.note_count}`}
              title={t('common.notes')}
            >
              <StickyNote />
              <span>{notebook.note_count}</span>
            </Link>
          </Badge>
          <time
            dateTime={notebook.updated}
            title={notebook.updated}
            className={cn('ml-auto text-xs', viewMode === 'card' && 'self-end')}
          >
            {formatCompactRelativeTime(notebook.updated, language)}
          </time>
        </div>

        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t('common.actions')}
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'relative z-10 justify-self-end',
                  'col-start-2 row-start-1 self-start',
                  viewMode === 'list' && 'md:col-start-auto md:row-start-auto md:self-auto',
                )}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canShare && (
                <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                  <Share2 />
                  {t('sharing.share')}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onClick={handleArchiveToggle}>
                  {notebook.archived ? <ArchiveRestore /> : <Archive />}
                  {notebook.archived ? t('notebooks.unarchive') : t('notebooks.archive')}
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
      </article>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
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
