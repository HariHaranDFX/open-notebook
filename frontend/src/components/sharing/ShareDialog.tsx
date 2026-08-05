'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
import type { GrantRole, PrincipalType, ResourceType } from '@/lib/api/sharing'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useAuth } from '@/lib/hooks/use-auth'
import { Trash2 } from 'lucide-react'

interface ShareDialogProps {
  resourceType: ResourceType
  resourceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canManage: boolean
}

export function ShareDialog({
  resourceType,
  resourceId,
  open,
  onOpenChange,
  canManage,
}: ShareDialogProps) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [principalType, setPrincipalType] = useState<PrincipalType>('user')
  const [principalId, setPrincipalId] = useState('')
  const [role, setRole] = useState<GrantRole>('viewer')

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sharing.title')}</DialogTitle>
          <DialogDescription>{t('sharing.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">{t('sharing.grants')}</Label>
            {isLoading ? (
              <div className="flex justify-center py-4">
                <LoadingSpinner />
              </div>
            ) : !grants?.length ? (
              <p className="text-sm text-muted-foreground">{t('sharing.noGrants')}</p>
            ) : (
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {grants.map((grant) => (
                  <li
                    key={grant.id}
                    className="flex items-center gap-2 justify-between rounded border px-3 py-2"
                  >
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
                      onValueChange={(value) =>
                        updateGrant.mutate({
                          grantId: grant.id,
                          role: value as GrantRole,
                        })
                      }
                    >
                      <SelectTrigger className="w-28">
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
                      onClick={() => deleteGrant.mutate(grant.id)}
                      aria-label={t('sharing.revoke')}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 border-t pt-4">
            <Label>{t('sharing.principalType')}</Label>
            {showGroups && (
              <Select
                value={principalType}
                onValueChange={(value) => {
                  setPrincipalType(value as PrincipalType)
                  setPrincipalId('')
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t('sharing.user')}</SelectItem>
                  <SelectItem value="group">{t('sharing.group')}</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={principalId || undefined} onValueChange={setPrincipalId}>
              <SelectTrigger>
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
                <SelectTrigger className="w-32">
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
                {t('sharing.add')}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
