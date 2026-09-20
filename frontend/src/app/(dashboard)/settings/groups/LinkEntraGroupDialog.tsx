'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useEntraGroupSearch, useLinkEntraGroup } from '@/lib/hooks/use-sharing'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

/**
 * WBS 4.20 — admin dialog that lets the operator pick a Microsoft Entra
 * security group by name and link it into user_group. Kicks a scoped sync
 * on submit so members appear without waiting for the periodic loop.
 */
interface LinkEntraGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLinked?: (groupId: string) => void
}

const DEBOUNCE_MS = 300

export function LinkEntraGroupDialog({ open, onOpenChange, onLinked }: LinkEntraGroupDialogProps) {
  const { t } = useTranslation()
  const [rawQuery, setRawQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const link = useLinkEntraGroup()
  const search = useEntraGroupSearch(debounced)

  // Reset internal state whenever the dialog is closed.
  useEffect(() => {
    if (!open) {
      setRawQuery('')
      setDebounced('')
      setSelected(null)
    }
  }, [open])

  // Debounce the input so we don't blast Graph on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(rawQuery), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [rawQuery])

  const results = search.data ?? []

  const handleSubmit = async () => {
    if (!selected) return
    try {
      const linked = await link.mutateAsync({ entra_group_oid: selected })
      onLinked?.(linked.id)
      onOpenChange(false)
    } catch {
      // Toast handled by the hook's onError.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('groups.linkEntra')}</DialogTitle>
          <DialogDescription>{t('groups.searchEntraGroups')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entra-group-search">{t('groups.searchEntraGroups')}</Label>
            <Input
              id="entra-group-search"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={t('groups.searchEntraPlaceholder')}
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-[var(--control-radius)] border border-border">
            {search.isFetching ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : !debounced ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t('groups.searchEntraPlaceholder')}
              </p>
            ) : results.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t('groups.noEntraResults')}
              </p>
            ) : (
              <ul role="radiogroup" aria-label={t('groups.searchEntraGroups')}>
                {results.map((candidate) => {
                  const active = selected === candidate.entra_group_oid
                  return (
                    <li key={candidate.entra_group_oid}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelected(candidate.entra_group_oid)}
                        className={cn(
                          'flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left last:border-b-0',
                          active ? 'bg-accent' : 'hover:bg-muted/60'
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {candidate.display_name}
                          </span>
                          {candidate.description && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {candidate.description}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!selected || link.isPending}>
            {link.isPending ? t('common.saving') : t('groups.linkEntra')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
