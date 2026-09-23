import apiClient from './client'
import type { SharePointBatch, SharePointDrive, SharePointImportRequest, SharePointItem, SharePointSite, SharePointStatus } from '@/lib/types/api'

const base = '/connectors/sharepoint'

export const sharepointApi = {
  status: async () => (await apiClient.get<SharePointStatus>(`${base}/status`)).data,
  connect: async () => (await apiClient.post<{ authorization_url: string }>(`${base}/connect`)).data,
  sites: async (query: string) => (await apiClient.get<SharePointSite[]>(`${base}/sites`, { params: { query } })).data,
  drives: async (siteId: string) => (await apiClient.get<SharePointDrive[]>(`${base}/sites/${encodeURIComponent(siteId)}/drives`)).data,
  children: async (driveId: string, itemId?: string) => (await apiClient.get<SharePointItem[]>(`${base}/drives/${encodeURIComponent(driveId)}/children`, { params: { item_id: itemId } })).data,
  import: async (request: SharePointImportRequest) => (await apiClient.post<{ batch_id: string }>(`${base}/import`, request)).data,
  batch: async (batchId: string) => (await apiClient.get<SharePointBatch>(`${base}/batches/${encodeURIComponent(batchId)}`)).data,
}
