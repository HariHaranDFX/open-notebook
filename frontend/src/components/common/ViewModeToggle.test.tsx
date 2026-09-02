import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ViewModeToggle } from './ViewModeToggle'

describe('ViewModeToggle', () => {
  it('announces the selected view and changes it through buttons', () => {
    const onViewModeChange = vi.fn()
    render(
      <ViewModeToggle
        viewMode="list"
        onViewModeChange={onViewModeChange}
        label="Collection view"
        listLabel="List"
        cardLabel="Cards"
      />,
    )

    expect(screen.getByRole('group', { name: 'Collection view' })).toHaveClass('h-9', 'items-center', 'p-px')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'List' })).toHaveClass('size-8')
    expect(screen.getByRole('button', { name: 'List' }).textContent).toBe('')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('title', 'List')
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveClass('size-8')
    expect(screen.getByRole('button', { name: 'Cards' }).textContent).toBe('')
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('title', 'Cards')

    fireEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(onViewModeChange).toHaveBeenCalledWith('card')
  })
})
