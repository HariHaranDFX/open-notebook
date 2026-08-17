import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NotesColumn } from './NotesColumn'
import { SourcesColumn } from './SourcesColumn'

vi.mock('@/lib/hooks/use-sources', () => ({
  useDeleteSource: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRetrySource: () => ({ mutateAsync: vi.fn() }),
  useRemoveSourceFromNotebook: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-notes', () => ({
  useDeleteNote: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/hooks/use-modal-manager', () => ({
  useModalManager: () => ({ openModal: vi.fn() }),
}))

vi.mock('@/components/sources/SourceCard', () => ({ SourceCard: () => null }))
vi.mock('@/components/sources/AddSourceDialog', () => ({ AddSourceDialog: () => null }))
vi.mock('@/components/sources/AddExistingSourceDialog', () => ({ AddExistingSourceDialog: () => null }))
vi.mock('./NoteEditorDialog', () => ({ NoteEditorDialog: () => null }))

describe('notebook pane toolbars', () => {
  it('uses compact Add source and outlined Context actions without chevrons', () => {
    render(
      <SourcesColumn
        notebookId="notebook:research"
        isLoading={false}
        accessRole="owner"
        sources={[{
          id: 'source:evidence',
          title: 'Evidence',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
          embedded: false,
          insights_count: 0,
        }]}
        onBulkContextModeChange={vi.fn()}
      />,
    )

    const context = screen.getByRole('button', { name: 'sources.bulkContext' })
    const addSource = screen.getByRole('button', { name: 'sources.addSource' })
    expect(context).toHaveClass('border-border-strong', 'bg-card')
    expect(context.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
    expect(addSource.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
    expect(addSource.querySelector('.lucide-plus')).not.toHaveClass('mr-2')
  })

  it('uses compact Write note and outlined Context actions without chevrons', () => {
    render(
      <NotesColumn
        notebookId="notebook:research"
        isLoading={false}
        accessRole="owner"
        notes={[{
          id: 'note:thought',
          title: 'Thought',
          content: 'Grounded note',
          note_type: 'human',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        }]}
        onBulkContextModeChange={vi.fn()}
      />,
    )

    const context = screen.getByRole('button', { name: 'sources.bulkContext' })
    const writeNote = screen.getByRole('button', { name: 'common.writeNote' })
    expect(context).toHaveClass('border-border-strong', 'bg-card')
    expect(context.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
    expect(writeNote.querySelector('.lucide-plus')).not.toHaveClass('mr-2')
  })

  it('keeps note context at the lower-left and the timestamp at the lower-right', () => {
    render(
      <NotesColumn
        notebookId="notebook:research"
        isLoading={false}
        accessRole="owner"
        notes={[{
          id: 'note:thought',
          title: 'Thought',
          content: 'Grounded note',
          note_type: 'human',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-02T00:00:00Z',
        }]}
        contextSelections={{ 'note:thought': 'full' }}
        onContextModeChange={vi.fn()}
      />,
    )

    const noteCard = screen.getByText('Grounded note').parentElement as HTMLElement
    const footer = noteCard.querySelector('[data-slot="note-card-footer"]') as HTMLElement

    expect(footer).toHaveClass('justify-between')
    expect(footer).toContainElement(within(noteCard).getByRole('combobox', { name: 'common.contextModes.noteLabel' }))
    expect(footer.querySelector('time')).toHaveClass('ml-auto', 'text-right')
  })
})
