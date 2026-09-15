import apiClient from './client'
import type {
  CleanupPreviewResponse,
  CleanupSubmitResponse,
  SourceAssetPublic,
  SourceFilePolicyResponse,
} from '@/lib/types/api'

export type CleanupScope = 'mine' | 'all'

export const sourceFilesApi = {
  getPolicy: async (): Promise<SourceFilePolicyResponse> => {
    const response = await apiClient.get<SourceFilePolicyResponse>(
      '/source-files/policy'
    )
    return response.data
  },

  getCleanupPreview: async (
    scope: CleanupScope
  ): Promise<CleanupPreviewResponse> => {
    const response = await apiClient.get<CleanupPreviewResponse>(
      '/source-files/cleanup-preview',
      { params: { scope } }
    )
    return response.data
  },

  submitCleanup: async (scope: CleanupScope): Promise<CleanupSubmitResponse> => {
    const response = await apiClient.post<CleanupSubmitResponse>(
      '/source-files/cleanup',
      { scope }
    )
    return response.data
  },

  deleteOriginal: async (
    sourceId: string
  ): Promise<{ outcome: string; asset: SourceAssetPublic | null }> => {
    const response = await apiClient.delete<{
      outcome: string
      asset: SourceAssetPublic | null
    }>(`/sources/${sourceId}/original-file`)
    return response.data
  },
}
