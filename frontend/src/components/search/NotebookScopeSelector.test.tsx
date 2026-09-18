/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { NotebookScopeSelector } from './NotebookScopeSelector'
import { useNotebooks } from '@/lib/hooks/use-notebooks'

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: vi.fn(),
}))

const notebooks = [
  {
    id: 'notebook:a',
    name: 'Alpha',
    description: 'first notebook',
    created: '',
    updated: '',
    archived: false,
  },
  {
    id: 'notebook:b',
    name: 'Beta',
    description: '',
    created: '',
    updated: '',
    archived: false,
  },
]

beforeEach(() => {
  vi.mocked(useNotebooks).mockReturnValue({ data: notebooks, isLoading: false } as any)
})

describe('NotebookScopeSelector', () => {
  it('shows "All notebooks" when nothing is selected and hides Clear', () => {
    render(<NotebookScopeSelector selectedIds={[]} onChange={vi.fn()} />)

    expect(screen.getByText('searchPage.scopeAllNotebooks')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'searchPage.scopeClear' })
    ).not.toBeInTheDocument()
  })

  it('shows a selected count and Clear when any notebook is picked', () => {
    render(
      <NotebookScopeSelector selectedIds={['notebook:a']} onChange={vi.fn()} />
    )

    // scopeNotebooksSelected renders the count via i18n interpolation; the
    // test i18n mock returns the raw key so we only assert the key is used.
    expect(screen.getByText('searchPage.scopeNotebooksSelected')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'searchPage.scopeClear' })
    ).toBeInTheDocument()
  })

  it('Clear calls onChange with an empty array', () => {
    const onChange = vi.fn()
    render(
      <NotebookScopeSelector selectedIds={['notebook:a']} onChange={onChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'searchPage.scopeClear' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('renders notebook items inside the collapsible when expanded', () => {
    render(<NotebookScopeSelector selectedIds={[]} onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /searchPage.scopeNotebooks/ }))

    // CheckboxList renders one entry per notebook; both titles must be present.
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })
})
