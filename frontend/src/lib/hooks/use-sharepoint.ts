import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sharepointApi } from '@/lib/api/sharepoint'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useTranslation } from './use-translation'
import type { SharePointBatch } from '@/lib/types/api'

export const SHAREPOINT_QUERY_KEYS = {
  status: ['sharepoint', 'status'] as const,
  sites: (query: string) => ['sharepoint', 'sites', query] as const,
  drives: (siteId: string) => ['sharepoint', 'drives', siteId] as const,
  children: (driveId: string, itemId?: string) => ['sharepoint', 'children', driveId, itemId] as const,
  batch: (batchId: string) => ['sharepoint', 'batch', batchId] as const,
}

export const isSharePointBatchTerminal = (status?: SharePointBatch['status']) =>
  status === 'completed' || status === 'partial' || status === 'failed'

export function useSharePointStatus() {
  return useQuery({ queryKey: SHAREPOINT_QUERY_KEYS.status, queryFn: sharepointApi.status, retry: false, staleTime: 0, refetchOnWindowFocus: true })
}

export function useConnectSharePoint() {
  const { t } = useTranslation()
  return useMutation({ mutationFn: sharepointApi.connect, retry: false, onError: () => toast.error(t('sharepoint.requestFailed')) })
}

export function useSharePointSites(query: string, enabled: boolean) {
  return useQuery({ queryKey: SHAREPOINT_QUERY_KEYS.sites(query), queryFn: () => sharepointApi.sites(query), enabled, retry: false })
}

export function useSharePointDrives(siteId: string, enabled: boolean) {
  return useQuery({ queryKey: SHAREPOINT_QUERY_KEYS.drives(siteId), queryFn: () => sharepointApi.drives(siteId), enabled: enabled && !!siteId, retry: false })
}

export function useSharePointChildren(driveId: string, itemId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: SHAREPOINT_QUERY_KEYS.children(driveId, itemId), queryFn: () => sharepointApi.children(driveId, itemId), enabled: enabled && !!driveId, retry: false })
}

export function useImportSharePoint() {
  const { t } = useTranslation()
  const client = useQueryClient()
  return useMutation({
    mutationFn: sharepointApi.import,
    retry: false,
    onSuccess: () => toast.success(t('sharepoint.pending')),
    onError: () => {
      toast.error(t('sharepoint.requestFailed'))
      void client.invalidateQueries({ queryKey: SHAREPOINT_QUERY_KEYS.status })
    },
  })
}

export function useSharePointBatch(batchId: string | null, notebookIds: string[]) {
  const client = useQueryClient()
  const notified = useRef<string | null>(null)
  const query = useQuery({
    queryKey: SHAREPOINT_QUERY_KEYS.batch(batchId ?? ''),
    queryFn: () => sharepointApi.batch(batchId ?? ''),
    enabled: !!batchId,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => !batchId || query.state.error || isSharePointBatchTerminal(query.state.data?.status) ? false : 2000,
  })
  useEffect(() => {
    if (!batchId || !isSharePointBatchTerminal(query.data?.status) || notified.current === batchId) return
    notified.current = batchId
    void client.invalidateQueries({ queryKey: ['sources'] })
    for (const id of notebookIds) void client.invalidateQueries({ queryKey: QUERY_KEYS.notebook(id) })
  }, [batchId, query.data?.status, client, notebookIds])
  return query
}
