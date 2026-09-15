import { useMemo } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  podcastsApi,
  EpisodeLibraryPage,
  EpisodeLibrarySortField,
  EpisodeProfileInput,
  EpisodeSummary,
  SpeakerProfileInput,
} from '@/lib/api/podcasts'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import {
  ACTIVE_EPISODE_STATUSES,
  EpisodeProfile,
  EpisodeStatusGroups,
  PodcastEpisode,
  PodcastGenerationRequest,
  groupEpisodesByStatus,
  speakerUsageMap,
} from '@/lib/types/podcasts'

const EPISODE_LIBRARY_PAGE_SIZE = 30

export interface EpisodeLibraryParams {
  query?: string
  sortBy?: EpisodeLibrarySortField
  sortOrder?: 'asc' | 'desc'
}

export function useLanguages() {
  return useQuery({
    queryKey: QUERY_KEYS.languages,
    queryFn: podcastsApi.listLanguages,
    staleTime: Infinity,
  })
}

interface EpisodeStatusCounts {
  total: number
  running: number
  completed: number
  failed: number
  pending: number
}

function hasActiveEpisodes(episodes: PodcastEpisode[]) {
  return episodes.some((episode) => {
    const status = episode.job_status ?? 'unknown'
    return ACTIVE_EPISODE_STATUSES.includes(status)
  })
}

export function usePodcastEpisodes(options?: { autoRefresh?: boolean }) {
  const { autoRefresh = true } = options ?? {}

  const query = useQuery({
    queryKey: QUERY_KEYS.podcastEpisodes,
    queryFn: podcastsApi.listEpisodes,
    refetchInterval: (current) => {
      if (!autoRefresh) {
        return false
      }

      const data = current.state.data as PodcastEpisode[] | undefined
      if (!data || data.length === 0) {
        return false
      }

      return hasActiveEpisodes(data) ? 15_000 : false
    },
  })

  const episodes = useMemo(() => query.data ?? [], [query.data])

  const statusGroups = useMemo<EpisodeStatusGroups>(
    () => groupEpisodesByStatus(episodes),
    [episodes]
  )

  const statusCounts = useMemo<EpisodeStatusCounts>(
    () => ({
      total: episodes.length,
      running: statusGroups.running.length,
      completed: statusGroups.completed.length,
      failed: statusGroups.failed.length,
      pending: statusGroups.pending.length,
    }),
    [episodes.length, statusGroups]
  )

  const active = useMemo(() => hasActiveEpisodes(episodes), [episodes])

  return {
    ...query,
    episodes,
    statusGroups,
    statusCounts,
    hasActiveEpisodes: active,
  }
}

/**
 * Cursor-paginated episode library for the /podcasts page.
 *
 * Keeps `usePodcastEpisodes` unchanged as the complete-list surface for
 * anywhere else that still needs the full set. This hook drives the page's
 * rendered list; pair it with `usePodcastEpisodesSummary` for global
 * status-count tiles that stay accurate under pagination.
 */
export function useEpisodeLibrary(params: EpisodeLibraryParams = {}) {
  const sortBy: EpisodeLibrarySortField = params.sortBy ?? 'updated'
  const sortOrder: 'asc' | 'desc' = params.sortOrder ?? 'desc'
  const normalizedQuery = params.query?.trim().toLowerCase() ?? ''

  const query = useInfiniteQuery({
    queryKey: QUERY_KEYS.podcastEpisodeLibrary({
      query: normalizedQuery,
      sortBy,
      sortOrder,
    }),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      podcastsApi.listEpisodeLibrary({
        query: normalizedQuery || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        limit: EPISODE_LIBRARY_PAGE_SIZE,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: EpisodeLibraryPage) =>
      lastPage.next_cursor ?? undefined,
  })

  const episodes = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages]
  )

  return {
    episodes,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    error: query.error,
    isError: query.isError,
    isFetchNextPageError: query.isFetchNextPageError,
    isRefetchError: query.isRefetchError,
  }
}

/**
 * Global episode status tiles + polling driver.
 *
 * Returns aggregate counts that stay accurate when the library is
 * cursor-paginated (the server computes them owner-scoped). Polls every
 * 15s while any episode is active, mirroring `usePodcastEpisodes`.
 */
export function usePodcastEpisodesSummary(options?: { autoRefresh?: boolean }) {
  const { autoRefresh = true } = options ?? {}

  return useQuery({
    queryKey: QUERY_KEYS.podcastEpisodeSummary,
    queryFn: podcastsApi.getEpisodeSummary,
    refetchInterval: (current) => {
      if (!autoRefresh) {
        return false
      }
      const data = current.state.data as EpisodeSummary | undefined
      return data?.has_active ? 15_000 : false
    },
  })
}

export function usePodcastEpisode(episodeId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.podcastEpisode(episodeId),
    queryFn: () => podcastsApi.getEpisode(episodeId),
    enabled: !!episodeId,
  })
}

export function useRetryPodcastEpisode() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (episodeId: string) => podcastsApi.retryEpisode(episodeId),
    onSuccess: async (_data, episodeId) => {
      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisode(episodeId) })
      toast({
        title: t('podcasts.retryStarted'),
        description: t('podcasts.retryStartedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToRetry'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useDeletePodcastEpisode() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (episodeId: string) => podcastsApi.deleteEpisode(episodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.episodeDeleted'),
        description: t('podcasts.episodeDeletedDesc'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToDeleteEpisode'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useEpisodeProfiles() {
  const query = useQuery({
    queryKey: QUERY_KEYS.episodeProfiles,
    queryFn: podcastsApi.listEpisodeProfiles,
  })

  return {
    ...query,
    episodeProfiles: query.data ?? [],
  }
}

export function useCreateEpisodeProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (payload: EpisodeProfileInput) =>
      podcastsApi.createEpisodeProfile(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.profileCreated'),
        description: t('podcasts.profileCreatedDesc', { name: data.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToCreateProfile'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateEpisodeProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({
      profileId,
      payload,
    }: {
      profileId: string
      payload: EpisodeProfileInput
    }) => podcastsApi.updateEpisodeProfile(profileId, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.profileUpdated'),
        description: t('podcasts.profileUpdatedDesc', { name: data.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToUpdateProfile'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteEpisodeProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ profileId }: { profileId: string; name: string }) =>
      podcastsApi.deleteEpisodeProfile(profileId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.profileDeleted'),
        description: t('podcasts.profileDeletedDesc', { name: variables.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToDeleteProfile'),
        description: getApiErrorMessage(error, (key) => t(key), 'podcasts.failedToDeleteProfileDesc'),
        variant: 'destructive',
      })
    },
  })
}

export function useDuplicateEpisodeProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (profileId: string) =>
      podcastsApi.duplicateEpisodeProfile(profileId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.profileDuplicated'),
        description: t('podcasts.profileDuplicatedDesc', { name: data.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToDuplicateProfile'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useSpeakerProfiles(episodeProfiles?: EpisodeProfile[]) {
  const query = useQuery({
    queryKey: QUERY_KEYS.speakerProfiles,
    queryFn: podcastsApi.listSpeakerProfiles,
  })

  const speakerProfiles = useMemo(() => query.data ?? [], [query.data])

  const usage = useMemo(
    () => speakerUsageMap(speakerProfiles, episodeProfiles),
    [speakerProfiles, episodeProfiles]
  )

  return {
    ...query,
    speakerProfiles,
    usage,
  }
}

export function useCreateSpeakerProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (payload: SpeakerProfileInput) =>
      podcastsApi.createSpeakerProfile(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.speakerProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.speakerCreated'),
        description: t('podcasts.speakerCreatedDesc', { name: data.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToCreateSpeaker'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateSpeakerProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({
      profileId,
      payload,
    }: {
      profileId: string
      payload: SpeakerProfileInput
    }) => podcastsApi.updateSpeakerProfile(profileId, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.speakerProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.speakerUpdated'),
        description: t('podcasts.speakerUpdatedDesc', { name: data.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToUpdateSpeaker'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteSpeakerProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ profileId }: { profileId: string; name: string }) =>
      podcastsApi.deleteSpeakerProfile(profileId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.speakerProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.episodeProfiles })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.speakerDeleted'),
        description: t('podcasts.speakerDeletedDesc', { name: variables.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToDeleteSpeaker'),
        description: getApiErrorMessage(error, (key) => t(key), 'podcasts.failedToDeleteSpeakerDesc'),
        variant: 'destructive',
      })
    },
  })
}

export function useDuplicateSpeakerProfile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (profileId: string) =>
      podcastsApi.duplicateSpeakerProfile(profileId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.speakerProfiles })
      toast({
        title: t('podcasts.speakerDuplicated'),
        description: t('podcasts.speakerDuplicatedDesc', { name: data.name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToDuplicateSpeaker'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      })
    },
  })
}

export function useGeneratePodcast() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (payload: PodcastGenerationRequest) =>
      podcastsApi.generatePodcast(payload),
    onSuccess: async (response) => {
      // Immediately refetch to show the new episode
      await queryClient.refetchQueries({ queryKey: QUERY_KEYS.podcastEpisodes })
      toast({
        title: t('podcasts.generationStarted'),
        description: t('podcasts.generationStartedDesc', { name: response.episode_name }),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('podcasts.failedToStartGeneration'),
        description: getApiErrorMessage(error, (key) => t(key), 'podcasts.tryAgainMoment'),
        variant: 'destructive',
      })
    },
  })
}
