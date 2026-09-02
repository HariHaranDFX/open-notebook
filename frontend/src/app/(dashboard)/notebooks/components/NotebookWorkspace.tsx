'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, StickyNote } from 'lucide-react'
import {
  ResearchWorkbench,
  type WorkbenchPane,
} from '@/components/workbench/ResearchWorkbench'
import { useNotebookChat } from '@/lib/hooks/use-notebook-chat'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useWorkbenchStore } from '@/lib/stores/workbench-store'
import type {
  ContextMode,
  ContextSelections,
  NoteContextMode,
} from '@/lib/types/notebook-context'
import type { NoteResponse, NotebookResponse, SourceListResponse } from '@/lib/types/api'
import {
  applyBulkNoteContext,
  applyBulkSourceContext,
  computeNoteSelections,
  computeSourceSelections,
  type NoteContextDefault,
  type SourceBulkAction,
  type SourceContextDefault,
} from '@/lib/utils/source-context'
import type { NotebookSection } from '@/lib/utils/notebook-section'
import { ChatColumn, type NotebookContextStats } from './ChatColumn'
import { NotesColumn } from './NotesColumn'
import { SourcesColumn } from './SourcesColumn'

interface NotebookWorkspaceProps {
  notebook: NotebookResponse
  sources: SourceListResponse[]
  notes: NoteResponse[]
  sourcesLoading: boolean
  notesLoading: boolean
  requestedSection: NotebookSection | null
  onRefreshSources: () => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
}

export function NotebookWorkspace({
  notebook,
  sources,
  notes,
  sourcesLoading,
  notesLoading,
  requestedSection,
  onRefreshSources,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: NotebookWorkspaceProps) {
  const { t } = useTranslation()
  const workspaceKey = `notebook:${notebook.id}`
  const setActivePane = useWorkbenchStore(state => state.setActivePane)
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {},
  })
  const [sourceContextDefault, setSourceContextDefault] = useState<SourceContextDefault>('include')
  const [noteContextDefault, setNoteContextDefault] = useState<NoteContextDefault>('include')

  useEffect(() => {
    setContextSelections(previous => ({
      ...previous,
      sources: computeSourceSelections(previous.sources, sources, sourceContextDefault),
    }))
  }, [sources, sourceContextDefault])

  useEffect(() => {
    setContextSelections(previous => ({
      ...previous,
      notes: computeNoteSelections(previous.notes, notes, noteContextDefault),
    }))
  }, [notes, noteContextDefault])

  useEffect(() => {
    if (requestedSection === 'sources') setActivePane(workspaceKey, 'evidence')
    if (requestedSection === 'notes') setActivePane(workspaceKey, 'notes')
  }, [requestedSection, setActivePane, workspaceKey])

  const chat = useNotebookChat({
    notebookId: notebook.id,
    sources,
    notes,
    contextSelections,
  })

  const contextStats = useMemo<NotebookContextStats>(() => {
    let sourcesInsights = 0
    let sourcesFull = 0
    let notesCount = 0

    for (const source of sources) {
      const mode = contextSelections.sources[source.id]
      if (mode === 'insights') sourcesInsights += 1
      if (mode === 'full') sourcesFull += 1
    }
    for (const note of notes) {
      if (contextSelections.notes[note.id] === 'full') notesCount += 1
    }

    return {
      sourcesInsights,
      sourcesFull,
      notesCount,
      tokenCount: chat.tokenCount,
      charCount: chat.charCount,
    }
  }, [chat.charCount, chat.tokenCount, contextSelections, notes, sources])

  const handleSourceContextModeChange = (sourceId: string, mode: ContextMode) => {
    setContextSelections(previous => ({
      ...previous,
      sources: { ...previous.sources, [sourceId]: mode },
    }))
  }

  const handleNoteContextModeChange = (noteId: string, mode: NoteContextMode) => {
    setContextSelections(previous => ({
      ...previous,
      notes: { ...previous.notes, [noteId]: mode },
    }))
  }

  const handleBulkSourceContext = (action: SourceBulkAction) => {
    setSourceContextDefault(action)
    setContextSelections(previous => ({
      ...previous,
      sources: applyBulkSourceContext(previous.sources, sources, action),
    }))
  }

  const handleBulkNoteContext = (action: NoteContextDefault) => {
    setNoteContextDefault(action)
    setContextSelections(previous => ({
      ...previous,
      notes: applyBulkNoteContext(previous.notes, notes, action),
    }))
  }

  const panes: WorkbenchPane[] = [
    {
      id: 'evidence',
      label: t('navigation.sources'),
      count: sources.length,
      icon: FileText,
      content: (
        <SourcesColumn
          sources={sources}
          isLoading={sourcesLoading}
          notebookId={notebook.id}
          notebookName={notebook.name}
          onRefresh={onRefreshSources}
          contextSelections={contextSelections.sources}
          onContextModeChange={handleSourceContextModeChange}
          onBulkContextModeChange={handleBulkSourceContext}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          accessRole={notebook.access_role}
        />
      ),
    },
    {
      id: 'notes',
      label: t('workbench.notes'),
      count: notes.length,
      icon: StickyNote,
      content: (
        <NotesColumn
          notes={notes}
          isLoading={notesLoading}
          notebookId={notebook.id}
          contextSelections={contextSelections.notes}
          onContextModeChange={handleNoteContextModeChange}
          onBulkContextModeChange={handleBulkNoteContext}
          accessRole={notebook.access_role}
        />
      ),
    },
  ]

  return (
    <ResearchWorkbench
      workspaceKey={workspaceKey}
      panes={panes}
      panelLabel={`${t('navigation.sources')} & ${t('workbench.notes')}`}
      chat={(
        <ChatColumn
          notebookId={notebook.id}
          chat={chat}
          contextStats={contextStats}
          isLoading={sourcesLoading || notesLoading}
        />
      )}
    />
  )
}
