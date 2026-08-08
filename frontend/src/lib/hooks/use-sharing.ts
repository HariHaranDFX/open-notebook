import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  sharingApi,
  type GrantCreate,
  type GrantRole,
  type GroupCreate,
  type ResourceType,
} from '@/lib/api/sharing'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.users,
    queryFn: () => sharingApi.listUsers(),
    enabled,
  })
}

export function useGroups(enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.groups,
    queryFn: () => sharingApi.listGroups(),
    enabled,
    retry: false,
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: GroupCreate) => sharingApi.createGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groups })
      toast({
        title: t('common.success'),
        description: t('groups.createSuccess'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteGroup() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => sharingApi.deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groups })
      toast({
        title: t('common.success'),
        description: t('groups.deleteSuccess'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useGroupMembers(groupId: string, enabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.groupMembers(groupId),
    queryFn: () => sharingApi.listMembers(groupId),
    enabled: !!groupId && enabled,
  })
}

export function useAddGroupMember(groupId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (userId: string) => sharingApi.addMember(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groupMembers(groupId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groups })
      toast({
        title: t('common.success'),
        description: t('groups.memberAdded'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useRemoveGroupMember(groupId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (userId: string) => sharingApi.removeMember(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groupMembers(groupId) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groups })
      toast({
        title: t('common.success'),
        description: t('groups.memberRemoved'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useGrants(
  resourceType: ResourceType,
  resourceId: string,
  enabled = true
) {
  return useQuery({
    queryKey: QUERY_KEYS.grants(resourceType, resourceId),
    queryFn: () => sharingApi.listGrants(resourceType, resourceId),
    enabled: !!resourceId && enabled,
  })
}

export function useCreateGrant(resourceType: ResourceType, resourceId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: GrantCreate) =>
      sharingApi.createGrant(resourceType, resourceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.grants(resourceType, resourceId),
      })
      toast({
        title: t('common.success'),
        description: t('sharing.grantAdded'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateGrant(resourceType: ResourceType, resourceId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ grantId, role }: { grantId: string; role: GrantRole }) =>
      sharingApi.updateGrant(resourceType, resourceId, grantId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.grants(resourceType, resourceId),
      })
      toast({
        title: t('common.success'),
        description: t('sharing.grantUpdated'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteGrant(resourceType: ResourceType, resourceId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (grantId: string) =>
      sharingApi.deleteGrant(resourceType, resourceId, grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.grants(resourceType, resourceId),
      })
      toast({
        title: t('common.success'),
        description: t('sharing.grantRevoked'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}
