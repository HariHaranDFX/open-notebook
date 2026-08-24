'use client'

import { useState } from 'react'
import { PageFrame } from '@/components/layout/PageFrame'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import {
  useGroups, useCreateGroup, useDeleteGroup, useGroupMembers,
  useAddGroupMember, useRemoveGroupMember, useUsers,
} from '@/lib/hooks/use-sharing'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Plus, Users, X, MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

export default function GroupsPage() {
  const { t } = useTranslation()
  const { data: groups, isLoading } = useGroups()
  const { data: users } = useUsers()
  const createGroup = useCreateGroup()
  const deleteGroup = useDeleteGroup()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [memberUserId, setMemberUserId] = useState('')
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null)

  const { data: members, isLoading: membersLoading } = useGroupMembers(selectedGroupId ?? '', !!selectedGroupId)
  const addMember = useAddGroupMember(selectedGroupId ?? '')
  const removeMember = useRemoveGroupMember(selectedGroupId ?? '')

  const selectedGroup = groups?.find((g) => g.id === selectedGroupId) ?? null
  const memberIds = new Set(members?.map((m) => m.user_id) ?? [])
  const availableUsers = users?.filter((u) => !memberIds.has(u.id)) ?? []
  const memberCount = members?.length ?? selectedGroup?.member_count ?? 0

  const handleCreate = async () => {
    if (!name.trim()) return
    const group = await createGroup.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    })
    setName('')
    setDescription('')
    setCreateOpen(false)
    setSelectedGroupId(group.id)
  }

  return (
    <>
      <PageFrame width="content" className="flex min-h-full flex-col">
        <PageHeader eyebrow={t('navigation.settings')} title={t('groups.title')} description={t('groups.description')} />

        {isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--surface-radius)] border border-border md:flex-row">
            {/* Groups list */}
            <div className="flex shrink-0 flex-col border-b border-border md:w-64 md:border-b-0 md:border-r">
              <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3.5">
                <span className="text-sm font-medium text-muted-foreground">
                  {t('groups.groupCount', { count: groups?.length ?? 0 })}
                </span>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  {t('groups.create')}
                </Button>
              </div>
              {!groups?.length ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center md:py-0">
                  <Users className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('groups.noGroups')}</p>
                </div>
              ) : (
                <ul className="max-h-[38vh] flex-1 space-y-1 overflow-y-auto p-2 md:max-h-none">
                  {groups.map((group) => {
                    const active = selectedGroupId === group.id
                    return (
                      <li key={group.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedGroupId(group.id)}
                          aria-current={active ? 'true' : undefined}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-[var(--control-radius)] border px-2.5 py-2 text-left transition-colors',
                            active ? 'border-primary bg-accent' : 'border-transparent hover:bg-muted/60'
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-[var(--control-radius)]',
                              active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            )}
                          >
                            <Users className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate text-sm font-medium', active && 'text-accent-foreground')}>
                              {group.name}
                            </span>
                            {group.description && (
                              <span className={cn('block truncate text-xs text-muted-foreground', active && 'text-accent-foreground/75')}>
                                {group.description}
                              </span>
                            )}
                          </span>
                          <span className={cn('shrink-0 text-xs tabular-nums text-muted-foreground', active && 'text-accent-foreground/80')}>
                            {group.member_count}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Selected group detail */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {!selectedGroup ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                  <Users className="size-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{t('groups.selectGroupHint')}</p>
                </div>
              ) : (
                <>
                  <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-[15px] font-medium">{selectedGroup.name}</h2>
                      <p className="text-[13px] text-muted-foreground">{t('groups.memberCount', { count: memberCount })}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" aria-label={t('common.actions')}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onSelect={() => setGroupToDelete(selectedGroup.id)}>
                          <Trash2 className="size-4" />
                          {t('groups.deleteConfirm')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {membersLoading ? (
                      <div className="flex justify-center py-8">
                        <LoadingSpinner />
                      </div>
                    ) : !members?.length ? (
                      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                        <p className="text-sm text-muted-foreground">{t('groups.noMembers')}</p>
                      </div>
                    ) : (
                      <ul>
                        {members.map((m) => {
                          const label = m.display_name || m.email
                          return (
                            <li key={m.user_id} className="group flex items-center gap-3 rounded-[var(--control-radius)] px-2 py-2 hover:bg-muted/50">
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                                {initials(label)}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{m.display_name || m.email}</span>
                                {m.display_name && m.email && (
                                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                                )}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`${t('groups.removeMember')} ${label}`}
                                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                onClick={() => removeMember.mutate(m.user_id)}
                              >
                                <X className="size-4" />
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>

                  <div className="flex gap-2 border-t border-border px-4 py-3">
                    <Select value={memberUserId || undefined} onValueChange={setMemberUserId}>
                      <SelectTrigger className="flex-1">
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
                      variant="outline"
                      onClick={() => {
                        if (!memberUserId) return
                        addMember.mutate(memberUserId, { onSuccess: () => setMemberUserId('') })
                      }}
                      disabled={!memberUserId || addMember.isPending}
                    >
                      {t('groups.addMember')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </PageFrame>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('groups.create')}</DialogTitle>
            <DialogDescription>{t('groups.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="group-name">{t('groups.name')}</Label>
              <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('groups.namePlaceholder')} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-desc">{t('groups.descriptionLabel')}</Label>
              <Input id="group-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || createGroup.isPending}>
              {createGroup.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
