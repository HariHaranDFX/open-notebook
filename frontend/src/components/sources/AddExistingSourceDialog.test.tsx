import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddExistingSourceDialog } from './AddExistingSourceDialog'
import { searchApi } from '@/lib/api/search'

const mocks = vi.hoisted(() => ({
  listSources: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/hooks/use-sources', () => ({
  useSources: () => ({ data: [] }),
  useAddSourcesToNotebook: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: { list: mocks.listSources },
}))

vi.mock('@/lib/api/search', () => ({
  searchApi: { search: vi.fn() },
}))

describe('AddExistingSourceDialog', () => {
  it('uses a divided, close-free sheet with the cancel action aligned left', async () => {
    const onOpenChange = vi.fn()

    render(
      <AddExistingSourceDialog
        open
        onOpenChange={onOpenChange}
        notebookId="notebook-1"
      />
    )
    await waitFor(() => expect(mocks.listSources).toHaveBeenCalledTimes(1))

    const sheet = screen.getByRole('dialog', { name: 'sources.addExistingTitle' })
    const header = sheet.querySelector('[data-slot="sheet-header"]')
    const cancelButton = within(sheet).getByRole('button', { name: 'common.cancel' })
    const footer = cancelButton.closest('[data-slot="sheet-footer"]')

    expect(sheet.querySelector('.lucide-x')).not.toBeInTheDocument()
    expect(sheet).toHaveClass('gap-0', 'overflow-hidden', 'p-0')
    expect(header).toHaveClass('gap-1', 'border-b', 'py-2.5')
    expect(footer).toHaveClass(
      'flex-row',
      'justify-between',
      'border-t',
      'sm:justify-between'
    )
    expect(cancelButton.nextElementSibling).toBe(
      within(sheet).getByRole('button', { name: 'common.addSelected' })
    )

    fireEvent.click(cancelButton)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('dedupes search results by parent_id (upstream #1345)', async () => {
    // A single source that matches by title, chunk, and insight would appear
    // 3 times before the fix. Only one row per parent_id must be shown.
    mocks.listSources.mockClear()
    vi.mocked(searchApi.search).mockResolvedValue({
      results: [
        { id: 'source:a', title: 'Doc A', parent_id: 'source:a', final_score: 0.9, created: '', updated: '' },
        { id: 'source_embedding:x', title: 'Doc A', parent_id: 'source:a', final_score: 0.8, created: '', updated: '' },
        { id: 'source_insight:i', title: 'Doc A insight', parent_id: 'source:a', final_score: 0.7, created: '', updated: '' },
        { id: 'source:b', title: 'Doc B', parent_id: 'source:b', final_score: 0.6, created: '', updated: '' },
      ],
      total_count: 4,
      search_type: 'text',
    })

    render(
      <AddExistingSourceDialog
        open
        onOpenChange={vi.fn()}
        notebookId="notebook-1"
      />
    )

    const searchInput = await screen.findByRole('textbox')
    fireEvent.change(searchInput, { target: { value: 'doc' } })

    await waitFor(() => expect(searchApi.search).toHaveBeenCalled())
    await waitFor(() => {
      // Two unique parent_ids -> two rows, not four. queryAllByText finds
      // both the title matched by chunk (Doc A) and the insight title (Doc A
      // insight); the dedupe means only the first row's title shows.
      const rowsA = screen.queryAllByText('Doc A')
      const rowsB = screen.queryAllByText('Doc B')
      expect(rowsA).toHaveLength(1)
      expect(rowsB).toHaveLength(1)
    })
  })
})
