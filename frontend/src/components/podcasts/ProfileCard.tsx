'use client'

import * as React from 'react'
import { AlertTriangle, ChevronRight, Copy, Edit3, MoreVertical, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/lib/hooks/use-translation'

/**
 * Shared shell for the podcast episode- and speaker-profile cards so both
 * stay visually uniform: a flat bordered surface, an identical header
 * (name + optional setup badge + description on the left, Edit and an
 * overflow menu on the right), and a body slot for the profile-specific
 * metadata chips and disclosures.
 */

interface ProfileCardProps {
  name: string
  description?: string | null
  setupRequired?: boolean
  onEdit: () => void
  onDuplicate: () => void
  duplicating?: boolean
  onDelete: () => void
  deleting?: boolean
  /** Speaker profiles in use can't be deleted; the confirm still opens to explain why. */
  deleteDisabled?: boolean
  deleteDisabledHint?: string
  deleteTitle: string
  deleteDescription: string
  children?: React.ReactNode
}

export function ProfileCard({
  name,
  description,
  setupRequired,
  onEdit,
  onDuplicate,
  duplicating,
  onDelete,
  deleting,
  deleteDisabled,
  deleteDisabledHint,
  deleteTitle,
  deleteDescription,
  children,
}: ProfileCardProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3 rounded-[var(--surface-radius)] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-foreground">{name}</h3>
            {setupRequired ? (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning-surface text-warning text-xs"
              >
                <AlertTriangle className="h-3 w-3" />
                {t('podcasts.setupRequired')}
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {description || t('podcasts.noDescription')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit3 className="h-4 w-4" /> {t('podcasts.edit')}
          </Button>
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.actions')}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={onDuplicate} disabled={duplicating}>
                  <Copy className="h-4 w-4" />
                  {t('podcasts.duplicate')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem variant="destructive">
                    <Trash2 className="h-4 w-4" />
                    {t('podcasts.delete')}
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
                <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
                {deleteDisabled && deleteDisabledHint ? (
                  <p className="mt-2 text-sm text-warning">{deleteDisabledHint}</p>
                ) : null}
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} disabled={deleteDisabled || deleting}>
                  {deleting ? t('podcasts.deleting') : t('podcasts.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {children}
    </div>
  )
}

interface MetaChipProps {
  icon?: React.ComponentType<{ className?: string }>
  label?: string
  value: React.ReactNode
  tone?: 'default' | 'accent' | 'warning'
}

/** One quiet spec chip: optional icon + optional muted label + a bold value. */
export function MetaChip({ icon: Icon, label, value, tone = 'default' }: MetaChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--surface-radius)] border px-2.5 py-1 text-xs',
        tone === 'accent' ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      {label ? <span className="text-muted-foreground">{label}</span> : null}
      <span
        className={cn(
          'font-medium',
          tone === 'warning' ? 'text-warning' : tone === 'accent' ? 'text-primary' : 'text-foreground'
        )}
      >
        {value}
      </span>
    </span>
  )
}

/** A collapsed-by-default section for the verbose text (briefing, voice details). */
export function ProfileDisclosure({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border pt-3">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}
