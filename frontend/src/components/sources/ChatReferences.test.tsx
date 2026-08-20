import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatReferences } from './ChatReferences'
import type { ReferenceData } from '@/lib/utils/source-references'

// useTranslation is mocked globally in setup.ts (t returns the key string).
// The hover preview's data hooks live in the tooltip content, which only mounts
// on hover — so rendering the chips needs no QueryClientProvider.

const references: ReferenceData[] = [
  { number: 1, type: 'source', id: 's1' },
  { number: 2, type: 'note', id: 'n1' },
]

describe('ChatReferences', () => {
  it('renders one chip per reference with a type-and-number accessible label', () => {
    render(<ChatReferences references={references} onReferenceClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.source 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.note 2' })).toBeInTheDocument()
  })

  it('opens the clicked reference via onReferenceClick with its type and id', () => {
    const onReferenceClick = vi.fn()
    render(<ChatReferences references={references} onReferenceClick={onReferenceClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.note 2' }))

    expect(onReferenceClick).toHaveBeenCalledWith('note', 'n1')
  })

  it('renders nothing when there are no references', () => {
    const { container } = render(<ChatReferences references={[]} onReferenceClick={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('collapses a type with 2+ references into a counted group pill, leaving singletons as direct chips', () => {
    const mixed: ReferenceData[] = [
      { number: 1, type: 'source', id: 's1' },
      { number: 2, type: 'note', id: 'n1' },
      { number: 3, type: 'source', id: 's2' },
    ]
    render(<ChatReferences references={mixed} onReferenceClick={vi.fn()} />)

    // Two sources collapse into one pill labelled with the count…
    expect(screen.getByRole('button', { name: 'common.source (2)' })).toBeInTheDocument()
    // …so the individual source chips no longer appear…
    expect(screen.queryByRole('button', { name: 'common.source 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.source 3' })).not.toBeInTheDocument()
    // …while the lone note stays a direct chip.
    expect(screen.getByRole('button', { name: 'common.note 2' })).toBeInTheDocument()
  })
})
