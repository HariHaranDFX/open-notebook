import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AddExistingSourceDialog } from './AddExistingSourceDialog'

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
})
