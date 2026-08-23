'use client'

import { useState } from 'react'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useGroups,
  useCreateGroup,
  useDeleteGroup,
  useGroupMembers,
  useAddGroupMember,
  useRemoveGroupMember,
  useUsers,
} from '@/lib/hooks/use-sharing'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Plus, Trash2 } from 'lucide-react'

export default function GroupsPage() {
  const { t } = useTranslation()
  const { data: groups, isLoading } = useGroups()
  const { data: users } = useUsers()
  const createGroup = useCreateGroup()
  const deleteGroup = useDeleteGroup()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [memberUserId, setMemberUserId] = useState('')
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null)

  const { data: members, isLoading: membersLoading } = useGroupMembers(
    selectedGroupId ?? '',
    !!selectedGroupId
  )
  const addMember = useAddGroupMember(selectedGroupId ?? '')
  const removeMember = useRemoveGroupMember(selectedGroupId ?? '')

  const handleCreate = async () => {
    if (!name.trim()) return
    const group = await createGroup.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    })
    setName('')
    setDescription('')
    setSelectedGroupId(group.id)
  }

  const memberIds = new Set(members?.map((m) => m.user_id) ?? [])
  const availableUsers = users?.filter((u) => !memberIds.has(u.id)) ?? []

  return (
    <>
      <PageFrame width="reading">
        <PageHeader
          eyebrow={t('navigation.settings')}
          title={t('groups.title')}
          description={t('groups.description')}
        />

        <div className="space-y-6">
          <div className="space-y-3 rounded-[var(--surface-radius)] border p-4">
            <h2 className="font-medium">{t('groups.create')}</h2>
            <div className="space-y-2">
              <Label htmlFor="group-name">{t('groups.name')}</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('groups.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-desc">{t('groups.descriptionLabel')}</Label>
              <Input
                id="group-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || createGroup.isPending}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('groups.create')}
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : !groups?.length ? (
            <p className="text-muted-foreground">{t('groups.noGroups')}</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <ul className="space-y-2">
                {groups.map((group) => (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`w-full rounded-[var(--surface-radius)] border px-3 py-2 text-left ${
                        selectedGroupId === group.id
                          ? 'border-primary bg-accent'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{group.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {group.member_count}
                        </span>
                      </div>
                      {group.description && (
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {group.description}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {selectedGroupId && (
                <div className="space-y-3 rounded-[var(--surface-radius)] border p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-medium">{t('groups.members')}</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setGroupToDelete(selectedGroupId)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {t('common.delete')}
                    </Button>
                  </div>

                  {membersLoading ? (
                    <LoadingSpinner />
                  ) : (
                    <ul className="space-y-2 max-h-56 overflow-y-auto">
                      {(members ?? []).map((m) => (
                        <li
                          key={m.user_id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="truncate">
                            {m.display_name || m.email}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMember.mutate(m.user_id)}
                          >
                            {t('groups.removeMember')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2 pt-2 border-t">
                    <Select
                      value={memberUserId || undefined}
                      onValueChange={setMemberUserId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('groups.selectUser')} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.display_name || u.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => {
                        if (!memberUserId) return
                        addMember.mutate(memberUserId, {
                          onSuccess: () => setMemberUserId(''),
                        })
                      }}
                      disabled={!memberUserId || addMember.isPending}
                    >
                      {t('groups.addMember')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </PageFrame>

      <ConfirmDialog
        open={!!groupToDelete}
        onOpenChange={(open) => !open && setGroupToDelete(null)}
        title={t('groups.deleteConfirm')}
        description={t('groups.deleteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={async () => {
          if (!groupToDelete) return
          await deleteGroup.mutateAsync(groupToDelete)
          if (selectedGroupId === groupToDelete) setSelectedGroupId(null)
          setGroupToDelete(null)
        }}
        isLoading={deleteGroup.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
