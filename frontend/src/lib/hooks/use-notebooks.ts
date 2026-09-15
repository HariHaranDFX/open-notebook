import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { notebooksApi, type NotebookSortField } from '@/lib/api/notebooks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { CreateNotebookRequest, UpdateNotebookRequest } from '@/lib/types/api'

const NOTEBOOK_LIBRARY_PAGE_SIZE = 30

export interface NotebookLibraryParams {
  archived: boolean
  query: string
  sortBy: NotebookSortField
  sortOrder: 'asc' | 'desc'
}

export function useNotebooks(archived?: boolean, orderBy = 'updated desc') {
  return useQuery({
    queryKey: [...QUERY_KEYS.notebooks, { archived, orderBy }],
    queryFn: () => notebooksApi.list({ archived, order_by: orderBy }),
  })
}

export function useNotebookLibrary(params: NotebookLibraryParams) {
  const query = useInfiniteQuery({
    // archived/sortBy/sortOrder/query are in the key so changing any of them
    // starts a fresh query with no cursor (per plan Global Constraints).
    queryKey: QUERY_KEYS.notebookLibrary(params),
    queryFn: async ({ pageParam }) => {
      const request: Parameters<typeof notebooksApi.listLibrary>[0] = {
        archived: params.archived,
        query: params.query,
        sort_by: params.sortBy,
        sort_order: params.sortOrder,
        limit: NOTEBOOK_LIBRARY_PAGE_SIZE,
      }
      // Only include cursor once one exists — the first page must not send it.
      if (pageParam) request.cursor = pageParam
      return notebooksApi.listLibrary(request)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.next_cursor ?? undefined,
  })

  const notebooks = useMemo(
    () => query.data?.pages.flatMap(page => page.items) ?? [],
    [query.data?.pages],
  )

  return {
    notebooks,
    isLoading: query.isLoading,
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

export function useNotebook(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.notebook(id),
    queryFn: () => notebooksApi.get(id),
    enabled: !!id,
  })
}

export function useCreateNotebook() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: CreateNotebookRequest) => notebooksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks })
      toast({
        title: t('common.success'),
        description: t('notebooks.createSuccess'),
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

export function useUpdateNotebook() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateNotebookRequest }) =>
      notebooksApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebook(id) })
      toast({
        title: t('common.success'),
        description: t('notebooks.updateSuccess'),
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

export function useNotebookDeletePreview(id: string, enabled: boolean = false) {
  return useQuery({
    queryKey: [...QUERY_KEYS.notebook(id), 'delete-preview'],
    queryFn: () => notebooksApi.deletePreview(id),
    enabled: !!id && enabled,
  })
}

export function useDeleteNotebook() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({
      id,
      deleteExclusiveSources = false,
    }: {
      id: string
      deleteExclusiveSources?: boolean
    }) => notebooksApi.delete(id, deleteExclusiveSources),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks })
      // Also invalidate sources since some may have been deleted
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      toast({
        title: t('common.success'),
        description: t('notebooks.deleteSuccess'),
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
