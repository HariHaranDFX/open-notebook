'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { WorkspaceSkeleton } from '@/components/workbench/WorkspaceSkeleton'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotes } from '@/lib/hooks/use-notes'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getNotebookSection } from '@/lib/utils/notebook-section'
import { NotebookHeader } from '../components/NotebookHeader'
import { NotebookWorkspace } from '../components/NotebookWorkspace'

export type {
  ContextMode,
  ContextSelections,
  NoteContextMode,
} from '@/lib/types/notebook-context'

export default function NotebookPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''
  const requestedSection = getNotebookSection(searchParams.get('section'))
  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const {
    sources = [],
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId)
  const { data: notes = [], isLoading: notesLoading } = useNotes(notebookId)
  const handleBack = useCallback(() => router.push('/notebooks'), [router])

  if (notebookLoading) {
    return (
      <AppShell>
        <WorkspaceSkeleton kind="notebook" />
      </AppShell>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-4 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{t('notebooks.notFound')}</h1>
            <p className="text-muted-foreground">{t('notebooks.notFoundDesc')}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/notebooks">
              <ArrowLeft />
              {t('workbench.backToNotebooks')}
            </Link>
          </Button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-4 pt-3 lg:px-6 lg:pt-4">
          <NotebookHeader notebook={notebook} onBack={handleBack} />
        </div>
        <div data-testid="detail-workspace" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <NotebookWorkspace
            notebook={notebook}
            sources={sources}
            notes={notes}
            sourcesLoading={sourcesLoading}
            notesLoading={notesLoading}
            requestedSection={requestedSection}
            onRefreshSources={() => void refetchSources()}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={() => void fetchNextPage()}
          />
        </div>
      </div>
    </AppShell>
  )
}
