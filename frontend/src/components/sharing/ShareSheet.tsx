'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  useUsers,
  useGroups,
  useGrants,
  useCreateGrant,
  useUpdateGrant,
  useDeleteGrant,
} from '@/lib/hooks/use-sharing'
import type { GrantResponse, GrantRole, PrincipalType, ResourceType } from '@/lib/api/sharing'
import type { AccessSummary } from '@/lib/types/api'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useAuth } from '@/lib/hooks/use-auth'
import { describeAccess } from '@/lib/utils/access-role'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { Trash2 } from 'lucide-react'

interface ShareSheetProps {
  resourceType: ResourceType
  resourceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canManage: boolean
  accessSummary?: AccessSummary | null
}

export function ShareSheet({
  resourceType,
  resourceId,
  open,
  onOpenChange,
  canManage,
  accessSummary,
}: ShareSheetProps) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [principalType, setPrincipalType] = useState<PrincipalType>('user')
  const [principalId, setPrincipalId] = useState('')
  const [role, setRole] = useState<GrantRole>('viewer')
  const [grantPendingRevoke, setGrantPendingRevoke] = useState<GrantResponse | null>(null)

  const { data: grants, isLoading } = useGrants(
    resourceType,
    resourceId,
    open && canManage
  )
  const { data: users } = useUsers(open && canManage)
  // Groups list is admin-only on the API; owners share with users.
  const { data: groups, isSuccess: groupsLoaded } = useGroups(
    open && canManage && isAdmin
  )

  const createGrant = useCreateGrant(resourceType, resourceId)
  const updateGrant = useUpdateGrant(resourceType, resourceId)
  const deleteGrant = useDeleteGrant(resourceType, resourceId)

  if (!canManage) return null

  const showGroups = isAdmin && groupsLoaded
  const effectiveType: PrincipalType = showGroups ? principalType : 'user'
  const resourceLabel = t(resourceType === 'notebook' ? 'common.notebook' : 'common.source')
  const accessDescription = describeAccess(accessSummary, t)

  const handleAdd = async () => {
    if (!principalId) return
    await createGrant.mutateAsync({
      principal_type: effectiveType,
      principal_id: principalId,
      role,
    })
    setPrincipalId('')
    setRole('viewer')
  }

  // Radix's AlertDialogAction closes the dialog on click unless the event's
  // default is prevented - we need to stay open on failure so the inline
  // error below renders next to the action that failed (see
  // SourceDetailContent's insight-delete confirmation for the same pattern).
  const handleConfirmRevoke = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault()
    if (!grantPendingRevoke) return
    try {
      await deleteGrant.mutateAsync(grantPendingRevoke.id)
      setGrantPendingRevoke(null)
    } catch {
      // Inline error renders from deleteGrant.isError below.
    }
  }

  // A grant mutation in flight must not be interrupted by an Escape press,
  // an overlay click, or the Done button - all three route through this
  // Sheet's onOpenChange with `next === false`. Opening is never blocked.
  const isMutating = createGrant.isPending || updateGrant.isPending || deleteGrant.isPending
  const handleSheetOpenChange = (next: boolean) => {
    if (!next && isMutating) return
    onOpenChange(next)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="flex w-[min(440px,calc(100vw-24px))] flex-col gap-0 p-0">
          <div className="border-b border-border px-5 py-4">
            <SheetTitle className="text-lg font-semibold">{t('sharing.title')}</SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {t('sharing.description')}
            </SheetDescription>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
            {accessSummary && (
              <section
                data-testid="share-sheet-access"
                aria-labelledby="share-sheet-access-heading"
                className="space-y-2"
              >
                <Label id="share-sheet-access-heading">{t('sharing.yourAccess')}</Label>
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--surface-radius)] border border-border bg-muted/30 px-3 py-2.5">
                  <Badge variant="secondary">{t(`sharing.${accessSummary.role}`)}</Badge>
                  {accessSummary.origin !== 'owner' && (
                    <span className="text-sm text-muted-foreground">{accessDescription}</span>
                  )}
                </div>
              </section>
            )}

            <section aria-labelledby="share-sheet-grants-heading" className="space-y-2">
              <Label id="share-sheet-grants-heading">{t('sharing.grants')}</Label>
              {isLoading ? (
                <div className="flex justify-center py-4">
                  <LoadingSpinner />
                </div>
              ) : !grants?.length ? (
                <p className="text-sm text-muted-foreground">{t('sharing.noGrants')}</p>
              ) : (
                <ul className="space-y-2">
                  {grants.map((grant) => {
                    const isUpdatingThisGrant =
                      updateGrant.isPending && updateGrant.variables?.grantId === grant.id
                    const updateFailed =
                      updateGrant.isError && updateGrant.variables?.grantId === grant.id

                    return (
                      <li
                        key={grant.id}
                        data-testid={`share-sheet-grant-${grant.id}`}
                        className="rounded-[var(--surface-radius)] border border-border px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">
                              {grant.principal_label || grant.principal_id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {grant.principal_type === 'group'
                                ? t('sharing.group')
                                : t('sharing.user')}
                            </p>
                          </div>
                          <Select
                            value={grant.role}
                            disabled={isUpdatingThisGrant}
                            onValueChange={(value) =>
                              updateGrant.mutate({
                                grantId: grant.id,
                                role: value as GrantRole,
                              })
                            }
                          >
                            <SelectTrigger className="w-28" aria-label={t('sharing.roleLabel')}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">{t('sharing.viewer')}</SelectItem>
                              <SelectItem value="editor">{t('sharing.editor')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setGrantPendingRevoke(grant)}
                            aria-label={t('sharing.revoke')}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        {updateFailed && (
                          <p
                            role="alert"
                            aria-live="assertive"
                            className="mt-1.5 text-xs text-destructive"
                          >
                            {getApiErrorMessage(updateGrant.error, t)}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="share-sheet-add-heading"
              className="space-y-3 border-t border-border pt-4"
              data-testid="share-sheet-add"
            >
              <Label id="share-sheet-add-heading">{t('sharing.principalType')}</Label>
              {showGroups && (
                <Select
                  value={principalType}
                  onValueChange={(value) => {
                    setPrincipalType(value as PrincipalType)
                    setPrincipalId('')
                  }}
                >
                  <SelectTrigger aria-label={t('sharing.principalType')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">{t('sharing.user')}</SelectItem>
                    <SelectItem value="group">{t('sharing.group')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={principalId || undefined} onValueChange={setPrincipalId}>
                <SelectTrigger
                  aria-label={
                    effectiveType === 'group' ? t('sharing.selectGroup') : t('sharing.selectUser')
                  }
                >
                  <SelectValue
                    placeholder={
                      effectiveType === 'group'
                        ? t('sharing.selectGroup')
                        : t('sharing.selectUser')
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {effectiveType === 'group'
                    ? groups?.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))
                    : users?.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.display_name || u.email}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Select value={role} onValueChange={(v) => setRole(v as GrantRole)}>
                  <SelectTrigger className="w-32" aria-label={t('sharing.roleLabel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">{t('sharing.viewer')}</SelectItem>
                    <SelectItem value="editor">{t('sharing.editor')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAdd}
                  disabled={!principalId || createGrant.isPending}
                  className="flex-1"
                >
                  {createGrant.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                  {t('sharing.add')}
                </Button>
              </div>
              {createGrant.isError && (
                <p role="alert" aria-live="assertive" className="text-xs text-destructive">
                  {getApiErrorMessage(createGrant.error, t)}
                </p>
              )}
            </section>
          </div>

          <div className="border-t border-border px-5 py-4">
            <Button
              variant="outline"
              onClick={() => handleSheetOpenChange(false)}
              disabled={isMutating}
            >
              {t('common.done')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!grantPendingRevoke}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleteGrant.isPending) setGrantPendingRevoke(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('sharing.revokeConfirmTitle', {
                resource: resourceLabel,
                principal:
                  grantPendingRevoke?.principal_label || grantPendingRevoke?.principal_id || '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('sharing.revokeConfirmDescription', {
                role: grantPendingRevoke ? t(`sharing.${grantPendingRevoke.role}`) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteGrant.isError && deleteGrant.variables === grantPendingRevoke?.id && (
            <p role="alert" aria-live="assertive" className="text-sm text-destructive">
              {getApiErrorMessage(deleteGrant.error, t)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteGrant.isPending}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={handleConfirmRevoke}
                disabled={deleteGrant.isPending}
              >
                {deleteGrant.isPending && <LoadingSpinner size="sm" className="mr-2" />}
                {t('sharing.revoke')}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
