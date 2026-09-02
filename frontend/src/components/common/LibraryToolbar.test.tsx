import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LibraryToolbar } from './LibraryToolbar'

describe('LibraryToolbar', () => {
  it('presents search, sort direction, and view controls as one toolbar', () => {
    const onSearchChange = vi.fn()
    const onSortDirectionChange = vi.fn()
    const onViewModeChange = vi.fn()

    render(
      <LibraryToolbar
        id="research-library"
        searchValue="evidence"
        onSearchChange={onSearchChange}
        searchLabel="Search research"
        searchPlaceholder="Search..."
        sortValue="updated"
        onSortChange={vi.fn()}
        sortLabel="Sort research"
        sortOptions={[{ value: 'updated', label: 'Updated' }]}
        sortDirection="desc"
        onSortDirectionChange={onSortDirectionChange}
        sortDirectionLabel="Change sort direction"
        viewMode="list"
        onViewModeChange={onViewModeChange}
        viewModeLabel="Collection view"
        listLabel="List"
        cardLabel="Cards"
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Search research' }), {
      target: { value: 'truth' },
    })
    expect(onSearchChange).toHaveBeenCalledWith('truth')
    expect(screen.getByRole('combobox', { name: 'Sort research' })).toHaveClass(
      'bg-card',
      'dark:bg-card',
      'dark:hover:bg-card',
    )
    expect(screen.getByRole('textbox', { name: 'Search research' }).parentElement?.parentElement).toHaveClass(
      'md:basis-96',
    )
    const sortControl = screen.getByRole('combobox', { name: 'Sort research' })
    const sortWrapper = sortControl.parentElement
    const responsiveControlRow = sortWrapper?.parentElement
    expect(sortWrapper).toHaveClass(
      'md:w-48',
    )

    const sortDirection = screen.getByRole('button', { name: 'Change sort direction' })
    expect(sortDirection).toHaveClass('size-9')
    expect(sortDirection.parentElement).toHaveClass('h-9', 'items-center')
    const viewSwitcher = screen.getByRole('group', { name: 'Collection view' })
    expect(viewSwitcher).toHaveClass('h-9')
    expect(responsiveControlRow).toHaveClass('flex', 'w-full', 'min-w-0', 'items-end')
    expect(responsiveControlRow).toContainElement(sortControl)
    expect(responsiveControlRow).toContainElement(sortDirection)
    expect(responsiveControlRow).toContainElement(viewSwitcher)

    fireEvent.click(sortDirection)
    expect(onSortDirectionChange).toHaveBeenCalledWith('asc')

    fireEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(onViewModeChange).toHaveBeenCalledWith('card')
  })
})
