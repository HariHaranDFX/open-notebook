import apiClient from './client'
import { getApiUrl } from '@/lib/config'
import {
  PodcastEpisode,
  EpisodeProfile,
  SpeakerProfile,
  Language,
  PodcastGenerationRequest,
  PodcastGenerationResponse,
} from '@/lib/types/podcasts'

export type EpisodeProfileInput = Omit<EpisodeProfile, 'id'>
export type SpeakerProfileInput = Omit<SpeakerProfile, 'id'>

export async function resolvePodcastAssetUrl(path?: string | null): Promise<string | undefined> {
  if (!path) {
    return undefined
  }

  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const base = await getApiUrl()

  if (path.startsWith('/')) {
    return `${base}${path}`
  }

  return `${base}/${path}`
}

export type EpisodeLibrarySortField = 'updated' | 'created' | 'episode_name'

export interface EpisodeLibraryParams {
  query?: string
  sort_by?: EpisodeLibrarySortField
  sort_order?: 'asc' | 'desc'
  limit?: number
  cursor?: string | null
}

export interface EpisodeLibraryPage {
  items: PodcastEpisode[]
  next_cursor: string | null
}

export interface EpisodeSummary {
  total: number
  running: number
  completed: number
  failed: number
  pending: number
  has_active: boolean
}

export const podcastsApi = {
  listEpisodes: async () => {
    const response = await apiClient.get<PodcastEpisode[]>('/podcasts/episodes')
    return response.data
  },

  listEpisodeLibrary: async (params: EpisodeLibraryParams = {}) => {
    const search: Record<string, string | number> = {}
    if (params.query) search.query = params.query
    if (params.sort_by) search.sort_by = params.sort_by
    if (params.sort_order) search.sort_order = params.sort_order
    if (params.limit !== undefined) search.limit = params.limit
    if (params.cursor) search.cursor = params.cursor
    const response = await apiClient.get<EpisodeLibraryPage>(
      '/podcasts/episodes/library',
      { params: search }
    )
    return response.data
  },

  getEpisodeSummary: async () => {
    const response = await apiClient.get<EpisodeSummary>(
      '/podcasts/episodes/summary'
    )
    return response.data
  },

  getEpisode: async (episodeId: string) => {
    const response = await apiClient.get<PodcastEpisode>(`/podcasts/episodes/${episodeId}`)
    return response.data
  },

  deleteEpisode: async (episodeId: string) => {
    await apiClient.delete(`/podcasts/episodes/${episodeId}`)
  },

  retryEpisode: async (episodeId: string) => {
    const response = await apiClient.post<{ job_id: string; message: string }>(
      `/podcasts/episodes/${episodeId}/retry`
    )
    return response.data
  },

  listEpisodeProfiles: async () => {
    const response = await apiClient.get<EpisodeProfile[]>('/episode-profiles')
    return response.data
  },

  createEpisodeProfile: async (payload: EpisodeProfileInput) => {
    const response = await apiClient.post<EpisodeProfile>(
      '/episode-profiles',
      payload
    )
    return response.data
  },

  updateEpisodeProfile: async (profileId: string, payload: EpisodeProfileInput) => {
    const response = await apiClient.put<EpisodeProfile>(
      `/episode-profiles/${profileId}`,
      payload
    )
    return response.data
  },

  deleteEpisodeProfile: async (profileId: string) => {
    await apiClient.delete(`/episode-profiles/${profileId}`)
  },

  duplicateEpisodeProfile: async (profileId: string) => {
    const response = await apiClient.post<EpisodeProfile>(
      `/episode-profiles/${profileId}/duplicate`
    )
    return response.data
  },

  listSpeakerProfiles: async () => {
    const response = await apiClient.get<SpeakerProfile[]>('/speaker-profiles')
    return response.data
  },

  createSpeakerProfile: async (payload: SpeakerProfileInput) => {
    const response = await apiClient.post<SpeakerProfile>(
      '/speaker-profiles',
      payload
    )
    return response.data
  },

  updateSpeakerProfile: async (profileId: string, payload: SpeakerProfileInput) => {
    const response = await apiClient.put<SpeakerProfile>(
      `/speaker-profiles/${profileId}`,
      payload
    )
    return response.data
  },

  deleteSpeakerProfile: async (profileId: string) => {
    await apiClient.delete(`/speaker-profiles/${profileId}`)
  },

  duplicateSpeakerProfile: async (profileId: string) => {
    const response = await apiClient.post<SpeakerProfile>(
      `/speaker-profiles/${profileId}/duplicate`
    )
    return response.data
  },

  generatePodcast: async (payload: PodcastGenerationRequest) => {
    const response = await apiClient.post<PodcastGenerationResponse>(
      '/podcasts/generate',
      payload
    )
    return response.data
  },

  listLanguages: async () => {
    const response = await apiClient.get<Language[]>('/languages')
    return response.data
  },
}
