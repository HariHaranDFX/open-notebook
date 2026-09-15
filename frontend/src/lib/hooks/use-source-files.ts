import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { sourceFilesApi, type CleanupScope } from '@/lib/api/source-files'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

const POLICY_KEY = ['source-files', 'policy'] as const
const preview = (scope: CleanupScope) => ['source-files', 'preview', scope] as const

export function useSourceFilePolicy() {
  return useQuery({
    queryKey: POLICY_KEY,
    queryFn: sourceFilesApi.getPolicy,
    staleTime: 60_000,
  })
}

export function useCleanupPreview(scope: CleanupScope, enabled = true) {
  return useQuery({
    queryKey: preview(scope),
    queryFn: () => sourceFilesApi.getCleanupPreview(scope),
    enabled,
  })
}

export function useSubmitCleanup() {
  const client = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (scope: CleanupScope) => sourceFilesApi.submitCleanup(scope),
    onSuccess: (_, scope) => {
      // Refresh preview + source lists after the worker starts.
      client.invalidateQueries({ queryKey: preview(scope) })
      client.invalidateQueries({ queryKey: QUERY_KEYS.sources() })
      toast({ title: t('sources.cleanupStarted'), description: t('sources.cleanupStartedDesc') })
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

export function useDeleteOriginalFile() {
  const client = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (sourceId: string) => sourceFilesApi.deleteOriginal(sourceId),
    onSuccess: (_, sourceId) => {
      client.invalidateQueries({ queryKey: QUERY_KEYS.source(sourceId) })
      client.invalidateQueries({ queryKey: QUERY_KEYS.sources() })
      toast({
        title: t('sources.originalDeleted'),
        description: t('sources.originalDeletedDesc'),
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
