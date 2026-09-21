'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  useDirectoryUserSearch,
  useStubEntraUser,
} from '@/lib/hooks/use-sharing'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

/**
 * WBS 4.21 — dialog for owners/admins to pick any user in the Entra
 * tenant (not just people who have already signed into the app). On
 * confirm, JIT-stubs the local `user` row and hands the local id back
 * to the caller so add-member / create-grant flow keeps working
 * unchanged.
 */
interface InviteFromDirectoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited?: (userId: string) => void
}

const DEBOUNCE_MS = 300

export function InviteFromDirectoryDialog({
  open,
  onOpenChange,
  onInvited,
}: InviteFromDirectoryDialogProps) {
  const { t } = useTranslation()
  const [rawQuery, setRawQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selectedOid, setSelectedOid] = useState<string | null>(null)
  const stub = useStubEntraUser()
  // Enabled only while the dialog is open — an empty query returns the
  // first 25 tenant users alphabetically (browse mode).
  const search = useDirectoryUserSearch(debounced, open)

  useEffect(() => {
    if (!open) {
      setRawQuery('')
      setDebounced('')
      setSelectedOid(null)
    }
  }, [open])

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(rawQuery), DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [rawQuery])

  const results = search.data ?? []

  const handleSubmit = async () => {
    if (!selectedOid) return
    try {
      const stubbed = await stub.mutateAsync({ entra_oid: selectedOid })
      onInvited?.(stubbed.id)
      onOpenChange(false)
    } catch {
      // Toast handled by the hook's onError.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sharing.inviteFromDirectory')}</DialogTitle>
          <DialogDescription>
            {t('sharing.inviteFromDirectoryDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="directory-user-search">
              {t('sharing.searchDirectory')}
            </Label>
            <Input
              id="directory-user-search"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder={t('sharing.searchDirectoryPlaceholder')}
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-[var(--control-radius)] border border-border">
            {search.isFetching ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : results.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                {t('sharing.noDirectoryResults')}
              </p>
            ) : (
              <>
                {!debounced && (
                  <p
                    className="border-b border-border/60 bg-muted/30 p-2 text-center text-xs text-muted-foreground"
                    data-testid="directory-browse-hint"
                  >
                    {t('sharing.showingTopResults', { count: results.length })}
                  </p>
                )}
              <ul
                role="radiogroup"
                aria-label={t('sharing.searchDirectory')}
              >
                {results.map((candidate) => {
                  const active = selectedOid === candidate.entra_oid
                  return (
                    <li key={candidate.entra_oid}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedOid(candidate.entra_oid)}
                        className={cn(
                          'flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left last:border-b-0',
                          active ? 'bg-accent' : 'hover:bg-muted/60'
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {candidate.display_name || candidate.email}
                          </span>
                          {candidate.display_name && candidate.email && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {candidate.email}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedOid || stub.isPending}
          >
            {stub.isPending
              ? t('common.saving')
              : t('sharing.inviteFromDirectory')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
